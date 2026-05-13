'use client'

/**
 * Sprint 5 — Capa delgada que envuelve `<TaskForm mode='edit' />` para el
 * panel lateral de detalle de tarea (`TaskDrawer`). Toda la lógica del
 * formulario vive en `task-form/TaskForm.tsx` (single source of truth).
 *
 * Responsabilidades de esta capa (drawer-only):
 *  - Componer la fila superior con breadcrumbs (TaskBreadcrumbs) + botones
 *    Editar / Guardar — que se inyectan al `TaskForm` vía `renderHeaderLeft`
 *    y `renderHeaderActions` para mantener una sola fila visual igual que
 *    antes del Sprint 5.
 *  - Forwardear `task` + catálogos al `TaskForm`.
 *  - Wave P6 · B3: integrar presence + soft lock + conflict dialog
 *    montando `<SoftLockProvider>`, `<EditingByBanner>` y
 *    `<ConflictDialog>` sin tocar la lógica de save del `TaskForm`.
 */

import { useEffect, useMemo } from 'react'
import type { SerializedTask } from '@/lib/types'
import { TaskBreadcrumbs } from './TaskDrawer'
import {
  TaskForm,
  TaskFormHeaderActions,
} from './task-form/TaskForm'
import { TaskTimeTrackingSection } from '@/components/time-tracking/TaskTimeTrackingSection'
import { TaskCustomFieldsSection } from '@/components/custom-fields/TaskCustomFieldsSection'
import { TaskGoalsSection } from '@/components/goals/TaskGoalsSection'
import { TaskDocsSection } from '@/components/docs/TaskDocsSection'
import { TaskChecklistSection } from '@/components/tasks/TaskChecklistSection'
import { AttachmentList } from '@/components/attachments/AttachmentList'
import { TaskAuditHistorySection } from '@/components/tasks/TaskAuditHistorySection'
import { TaskInsightsSection } from '@/components/tasks/TaskInsightsSection'
import { TaskRisksSection } from '@/components/tasks/TaskRisksSection'
import { AITaskRefineMenu } from '@/components/tasks/AITaskRefineMenu'
import { SoftLockProvider } from '@/components/realtime-locks/SoftLockProvider'
import { EditingByBanner } from '@/components/realtime-locks/EditingByBanner'
import { ConflictDialog } from '@/components/realtime-locks/ConflictDialog'
import { useTaskEditLock } from '@/components/realtime-locks/useTaskEditLock'
import { usePresence } from '@/lib/realtime/use-presence'
import PresenceIndicator from '@/components/realtime/PresenceIndicator'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { TaskCommentsRealtime } from '@/components/comments/TaskCommentsRealtime'

type Props = {
  task: SerializedTask
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  allTasks?: SerializedTask[]
  /**
   * Wave P6 — Identidad del usuario activo. Combina B1 (presence) + B3
   * (edit locks). Opcional para no romper callers existentes (Kanban,
   * Gantt, Calendar, List, Table, GanttListMobile). Sin él se renderiza
   * el drawer pero sin presence/locks/conflict detection (degradación).
   *
   * Tipo `CurrentUserPresence` (de A1/B1) tiene `{ userId, name, avatarUrl? }`.
   * El hook `useTaskEditLock` consume `{ id, name }`, así que mapeamos.
   */
  currentUser?: CurrentUserPresence | null
}

/**
 * Drawer principal de tarea. Compone:
 *   - `<TaskForm mode='edit'/>` (single source of truth de detalle, tabs).
 *   - `<TaskCustomFieldsSection/>` (Ola P1 · Equipo 3) — sólo si la tarea
 *     tiene `projectId`. Renderiza inputs por cada `CustomFieldDef` del
 *     proyecto y autosalva on-blur. Ubicado después del form para no
 *     interferir con la navegación de tabs (los CF aplican a todas las
 *     tabs, conceptualmente "metadatos del proyecto").
 *   - `<EditingByBanner/>` (Wave P6 · B3) arriba del cuerpo cuando hay
 *     otros peers editando; cubre presencia visible + botón "Forzar".
 *   - `<SoftLockProvider/>` envolviendo el form para deshabilitarlo en
 *     modo solo lectura mientras alguien más edita y el usuario actual
 *     no ha forzado override.
 *   - `<ConflictDialog/>` (Wave P6 · B3) que aparece automáticamente
 *     cuando llega un UPDATE remoto más nuevo. Sin tocar el save del
 *     `TaskForm`: si el usuario elige "overwrite" usamos el save normal
 *     (la BD es last-write-wins); si elige "accept_remote" emitimos un
 *     `router.refresh()` para recargar la entidad.
 */
export function TaskDrawerContent({
  task,
  projects,
  users,
  allTasks = [],
  currentUser,
}: Props) {
  // Resolver currentUser con la misma convención que el resto del módulo
  // (sin sesión real, fallback a `users[0]` mapeado al shape Presence).
  // El hook `useTaskEditLock` espera `{id, name}`; B1/A1 entregan
  // `{userId, name, avatarUrl?}`. Adaptamos en cada uso.
  const resolvedPresenceUser = useMemo<CurrentUserPresence | null>(
    () =>
      currentUser ??
      (users[0] ? { userId: users[0].id, name: users[0].name } : null),
    [currentUser, users],
  )

  const resolvedLockUser = useMemo(
    () =>
      resolvedPresenceUser
        ? { id: resolvedPresenceUser.userId, name: resolvedPresenceUser.name }
        : null,
    [resolvedPresenceUser],
  )

  // Wave P6 · B1 — Mini indicador de presence en el header del drawer.
  // Si `resolvedPresenceUser` es null, channel=null → no-op silencioso.
  const presence = usePresence(
    resolvedPresenceUser ? `task:${task.id}` : null,
    resolvedPresenceUser
      ? {
          userId: resolvedPresenceUser.userId,
          name: resolvedPresenceUser.name,
          avatarUrl: resolvedPresenceUser.avatarUrl,
        }
      : null,
  )

  const lock = useTaskEditLock({
    taskId: task.id,
    currentUser: resolvedLockUser,
    currentVersion: task.updatedAt ?? null,
  })

  // Lifecycle: al montar el drawer iniciamos editing; al desmontar liberamos.
  // `startEditing`/`stopEditing` son idempotentes — basta una vez por mount.
  useEffect(() => {
    if (!resolvedLockUser) return
    lock.startEditing()
    return () => {
      lock.stopEditing()
    }
    // Sólo re-correr si cambia la tarea o el usuario; no depender del lock
    // entero para evitar suscripciones duplicadas con cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, resolvedLockUser?.id])

  // Estado del ConflictDialog. La fuente de verdad es `lock.hasConflict`;
  // el `dismissConflict` del hook lo limpia. No usamos `useEffect→setState`
  // (regla react-hooks/set-state-in-effect): el `open` deriva sólo del flag
  // del hook, así no se necesita un toggle local.
  const conflictOpen = lock.hasConflict

  // Resolución del conflicto: el TaskForm tiene su propio save y no lo
  // tocamos. Nuestras opciones son:
  //   - 'overwrite': cerramos el dialog y dejamos que el usuario continúe
  //     editando. La próxima vez que pulse Guardar, su versión sobrescribe
  //     (la BD es last-write-wins).
  //   - 'accept_remote': forzamos un refresh duro de la página para que
  //     el server component recargue la tarea con el `updatedAt` remoto.
  //   - 'cancel': simplemente cierra; el flag `hasConflict` se queda hasta
  //     que el usuario decida.
  const handleResolve = (action: 'overwrite' | 'accept_remote' | 'cancel') => {
    if (action === 'overwrite') {
      lock.dismissConflict()
    } else if (action === 'accept_remote') {
      lock.dismissConflict()
      // Refresh suave: en lugar de importar el router (que requiere el
      // hook `useRouter` y obliga al componente a estar bajo `app/`), usamos
      // `location.reload()`. Es suficiente para "abandonar cambios locales y
      // recargar la entidad" según la convención del módulo. Comprobamos
      // window por SSR.
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    } else {
      // 'cancel': nada — el usuario cerró el dialog pero el flag persistirá
      // hasta que tome una decisión (próximo evento o resolución manual).
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Banner de presencia. Si no hay otros peers editando, no renderiza
          nada (componente devuelve null). Lo ponemos fuera del SoftLock
          para que el botón "Forzar edición" siga clickeable. */}
      {/* Wave P6 · B1 — Mini indicador de presence (otros usuarios viendo). */}
      {presence.users.length > 0 ? (
        <div
          className="flex items-center justify-end px-6 pt-3"
          data-testid="task-drawer-presence"
        >
          <PresenceIndicator count={presence.users.length} label="viendo" />
        </div>
      ) : null}
      <div className="px-4 pt-3" data-testid="task-drawer-edit-presence">
        <EditingByBanner
          editingUsers={lock.editingUsers}
          isLockedByOther={lock.isLockedByOther}
          onForceOverride={lock.forceOverride}
        />
      </div>

      <SoftLockProvider isLocked={lock.isLockedByOther} unwrap>
        <div
          data-testid="task-drawer-form-region"
          data-locked={lock.isLockedByOther ? 'true' : 'false'}
          className={
            lock.isLockedByOther
              ? 'pointer-events-none select-none opacity-70'
              : undefined
          }
          aria-disabled={lock.isLockedByOther || undefined}
        >
          <TaskForm
            mode="edit"
            task={task}
            projects={projects}
            users={users}
            allTasks={allTasks}
            layout="drawer"
            hideFooter
            renderHeaderLeft={() => (
              <TaskBreadcrumbs
                segments={[
                  ...(task.project ? [{ label: task.project.name }] : []),
                  { label: `Tarea #${task.mnemonic || task.id.substring(0, 6)}` },
                ]}
              />
            )}
            renderHeaderActions={(ctx) => (
              <>
                {/* Wave P7 · Equipo P7-5 — Refinamiento IA: dropdown con
                    5 acciones (mejorar descripción / checklist / tags /
                    duplicados / categoría). Cada acción abre un dialog
                    de preview con opción "Editar antes de aplicar". */}
                <AITaskRefineMenu
                  taskId={task.id}
                  currentTask={{
                    title: task.title,
                    description: task.description,
                    type: task.type,
                    priority: task.priority,
                    tags: task.tags ?? [],
                  }}
                />
                <TaskFormHeaderActions ctx={ctx} />
              </>
            )}
          />
          {/*
           * Ola P1 · Equipo 4 — Sección de Time Tracking. Mientras no haya
           * sesión real, usamos como currentUserId al primer user (mismo
           * patrón que CalendarBoardClient). El userNames aplana la lista
           * de users a un mapa para mostrar autores en la lista.
           */}
          {users[0] ? (
            <div className="border-t border-border bg-card/40 px-6 py-4">
              <TaskTimeTrackingSection
                taskId={task.id}
                currentUserId={task.assigneeId ?? users[0].id}
                userNames={Object.fromEntries(users.map((u) => [u.id, u.name]))}
              />
            </div>
          ) : null}
          {task.projectId && (
            <div className="border-t border-border bg-card/40 px-6 py-4">
              <TaskCustomFieldsSection
                taskId={task.id}
                projectId={task.projectId}
              />
            </div>
          )}
          {/*
           * Ola P2 · Equipo P2-4 — Sección de OKRs. Lista los KRs vinculados
           * a la tarea con el goal padre, ciclo y progreso. Read-only en MVP:
           * los vínculos se gestionan desde /goals.
           */}
          <div className="border-t border-border bg-card/40 px-6 py-4">
            <TaskGoalsSection taskId={task.id} />
          </div>
          {/*
           * Ola P2 · Equipo P2-5 — Sección de Docs vinculados. Lista los
           * documentos asociados a la tarea con atajo para crear uno nuevo
           * pre-vinculado. La edición completa vive en /docs.
           */}
          <div className="border-t border-border bg-card/40 px-6 py-4">
            <TaskDocsSection taskId={task.id} />
          </div>
          {/*
           * Wave C-debt-1 · Equipo C-DEBT-1 — Sección de Checklists relacional.
           * Reemplaza el hack P7-5 que anexaba el checklist sugerido por IA
           * a `description` como markdown. Ahora cada task puede tener N
           * checklists con items toggleables, reordenables y borrables.
           */}
          <div className="border-t border-border bg-card/40 px-6 py-4">
            <TaskChecklistSection taskId={task.id} />
          </div>
          {/*
           * Wave P8 · Equipo P8-4 — Lista de adjuntos con upload real a
           * Supabase Storage. Drag-drop multi-file, preview de imágenes/PDFs
           * inline, signed URLs con TTL 1h.
           */}
          <div className="border-t border-border bg-card/40 px-6 py-4">
            <AttachmentList taskId={task.id} />
          </div>
          {/*
           * Equipo D2 — Auditoría: últimos eventos del entityType "task" para
           * `task.id`. Collapsible (default cerrado), carga lazy on-open.
           */}
          <div className="border-t border-border bg-card/40 px-6 py-4">
            <TaskAuditHistorySection taskId={task.id} limit={10} />
          </div>
          {/*
           * Equipo D2 — Insights AI (Ola P5): muestra los `TaskInsight`
           * activos. Permite descartar y recalcular (a nivel proyecto).
           */}
          <div className="border-t border-border bg-card/40 px-6 py-4">
            <TaskInsightsSection
              taskId={task.id}
              projectId={task.projectId ?? null}
            />
          </div>
          {/*
           * 2026-05-13 — Sección de Riesgos: lista los `Risk` con
           * `taskId=task.id`, permite agregar nuevos (matriz 5×5) y avanzar
           * estado (Abierto → Mitigando → Cerrado). También se alimenta de
           * los riesgos promovidos automáticamente por la IA cuando el
           * usuario aplica una sugerencia de "Mejorar descripción".
           */}
          <div className="border-t border-border bg-card/40 px-6 py-4">
            <TaskRisksSection
              taskId={task.id}
              projectId={task.projectId ?? null}
            />
          </div>
        </div>
      </SoftLockProvider>

      {/*
       * Wave P6 · B3 — ConflictDialog. Se abre cuando llega un UPDATE
       * remoto cuyo `updatedAt` es más nuevo que el cargado por SSR. Como
       * el TaskForm hace su propio save y no podemos bloquearlo desde aquí
       * sin tocar su lógica, mostramos el dialog en cuanto se detecta el
       * conflicto: así el usuario decide ANTES de pulsar Guardar.
       */}
      <ConflictDialog
        open={conflictOpen}
        onOpenChange={(next) => {
          if (!next) lock.dismissConflict()
        }}
        fieldLabel="Tarea"
        localValue={task.title}
        remoteValue={
          lock.remoteVersion
            ? `Versión remota guardada el ${lock.remoteVersion}`
            : 'Versión remota desconocida'
        }
        remoteAuthor={lock.remoteAuthorId ?? null}
        onResolve={handleResolve}
      />

      {/*
       * Wave P6 · Equipo A3 — Comentarios en vivo (Supabase Realtime).
       * INSERTs propagados via `postgres_changes`; typing via `broadcast`.
       * Si Realtime no está configurado, degrada a fetch normal.
       */}
      <div className="border-t border-border bg-card/40 px-6 py-4">
        <TaskCommentsRealtime
          taskId={task.id}
          currentUser={users[0] ?? null}
          mentionableUsers={users.map((u) => ({
            id: u.id,
            name: u.name,
          }))}
        />
      </div>
    </div>
  )
}
