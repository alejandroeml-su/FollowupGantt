'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Save,
  Loader2,
  Copy,
  Trash2,
  Pencil,
  ArrowUpToLine,
  ArrowDownToLine,
} from 'lucide-react'
import {
  createElement,
  deleteElements,
  groupElements,
  setElementData,
  setElementsLocked,
  ungroupGroup,
  updateWhiteboardElements,
} from '@/lib/actions/whiteboards'
import { toast } from '@/components/interactions/Toaster'
import {
  BRUSH_PRESETS,
  computeFreehandBounds,
  defaultDataFor,
  defaultGeometry,
  makeFreehandData,
} from '@/lib/whiteboards/factories'
import { exportElementsToPng, downloadDataUrl } from '@/lib/whiteboards/export-png'
import {
  exportElementsToPdf,
  exportElementsToHighResPng,
  downloadPdf,
} from '@/lib/whiteboards/export-pdf'
import type { ExportKind } from './WhiteboardToolbar'
import type { WhiteboardElement } from '@/lib/whiteboards/types'
import { WhiteboardCanvas } from './WhiteboardCanvas'
import { WhiteboardToolbar, type ToolId, toolToElementType } from './WhiteboardToolbar'
import { SoftLockProvider } from '@/components/realtime-locks/SoftLockProvider'
import { EditingByBanner } from '@/components/realtime-locks/EditingByBanner'
import { ConflictDialog } from '@/components/realtime-locks/ConflictDialog'
import { useWhiteboardEditLock } from '@/components/realtime-locks/useWhiteboardEditLock'
import { usePresence } from '@/lib/realtime/use-presence'
import PresenceAvatars from '@/components/realtime/PresenceAvatars'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'

type Props = {
  whiteboard: {
    id: string
    title: string
    description: string | null
    projectName: string | null
    /**
     * ISO `updatedAt` del whiteboard top-level. Wave P6 · B3 lo usa para
     * detectar conflictos via `useVersionCheck`. Opcional para no romper
     * callers existentes; si falta, conflict detection queda inactivo.
     */
    updatedAt?: string | null
  }
  initialElements: WhiteboardElement[]
  /**
   * Wave P6 — Identidad del usuario activo (combina B1 presence + B3 lock).
   * Llega drilled desde el RSC `app/whiteboards/[id]/page.tsx`. Si null,
   * presence + edit lock + conflict detection se desactivan graceful.
   */
  currentUser?: CurrentUserPresence | null
}

const AUTOSAVE_DEBOUNCE_MS = 500

export function WhiteboardEditor({
  whiteboard,
  initialElements,
  currentUser,
}: Props) {
  const [elements, setElements] = useState<WhiteboardElement[]>(initialElements)
  // Wave P6 · Equipo B1 — Presence wiring. Si no hay sesión, pasamos
  // identity null y `usePresence` queda en no-op (lista vacía).
  const presence = usePresence(
    currentUser ? `whiteboard:${whiteboard.id}` : null,
    currentUser
      ? {
          userId: currentUser.userId,
          name: currentUser.name,
          avatarUrl: currentUser.avatarUrl,
        }
      : null,
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // HU-12 (2026-05-14) — Multi-selección. `selectedId` se preserva
  // como "primary" (la última seleccionada — gobierna inline edit y
  // context menu). `selectedIds` es el set completo. Cuando hay solo
  // uno, ambos son consistentes; si `selectedIds.size > 1`, el toolbar
  // muestra acciones de grupo (Agrupar/Bloquear/Eliminar todo).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<ToolId | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [panMode, setPanMode] = useState(false)
  const [savingState, setSavingState] = useState<'idle' | 'pending' | 'saving' | 'error'>('idle')
  const [contextMenu, setContextMenu] = useState<{
    elementId: string
    x: number
    y: number
  } | null>(null)

  // Wave P6 · B3 — Edit lock + conflict detection.
  // `useWhiteboardEditLock` espera EditingUser `{ id, name }`; `currentUser`
  // entrega CurrentUserPresence `{ userId, name }`. Mapeamos.
  const resolvedLockUser = useMemo(
    () => (currentUser ? { id: currentUser.userId, name: currentUser.name } : null),
    [currentUser],
  )
  const lock = useWhiteboardEditLock({
    whiteboardId: whiteboard.id,
    currentUser: resolvedLockUser,
    currentVersion: whiteboard.updatedAt ?? null,
  })

  // Lifecycle: marcar editing al montar; liberar al desmontar.
  useEffect(() => {
    if (!resolvedLockUser) return
    lock.startEditing()
    return () => {
      lock.stopEditing()
    }
    // Sólo dependemos del id de la entidad y del usuario. Re-suscribir el
    // lock por cada render rompería el heartbeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whiteboard.id, resolvedLockUser?.id])

  // Resolución del conflicto: el editor autosalva por elemento. El caller
  // tiene tres salidas:
  //   - 'overwrite': descartamos el flag; los próximos autosaves siguen
  //     y la BD queda last-write-wins.
  //   - 'accept_remote': recargamos la página para descartar cambios
  //     locales y traer el estado remoto fresco.
  //   - 'cancel': cierra el dialog; el flag persiste.
  const handleResolveConflict = useCallback(
    (action: 'overwrite' | 'accept_remote' | 'cancel') => {
      if (action === 'overwrite') {
        lock.dismissConflict()
      } else if (action === 'accept_remote') {
        lock.dismissConflict()
        if (typeof window !== 'undefined') window.location.reload()
      }
    },
    [lock],
  )

  const pendingPatches = useRef<
    Map<
      string,
      {
        x?: number
        y?: number
        width?: number
        height?: number
        zIndex?: number
      }
    >
  >(new Map())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Ref para que el listener global de teclado pueda invocar el handler
  // de borrado actualizado sin necesidad de re-suscribirse a cada cambio
  // de `selectedId`/`elements`. Cumple la regla "no useEffect→setState".
  const deleteSelectedRef = useRef<() => void>(() => {})

  const flushPatches = useCallback(async () => {
    if (pendingPatches.current.size === 0) return
    const batch = Array.from(pendingPatches.current.entries()).map(([id, p]) => ({ id, ...p }))
    pendingPatches.current.clear()
    setSavingState('saving')
    try {
      await updateWhiteboardElements(whiteboard.id, batch)
      setSavingState('idle')
    } catch (err) {
      setSavingState('error')
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    }
  }, [whiteboard.id])

  const scheduleAutosave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSavingState('pending')
    saveTimer.current = setTimeout(() => {
      void flushPatches()
    }, AUTOSAVE_DEBOUNCE_MS)
  }, [flushPatches])

  const handleMove = useCallback(
    (id: string, next: { x: number; y: number }) => {
      setElements((prev) => prev.map((el) => (el.id === id ? { ...el, x: next.x, y: next.y } : el)))
      const existing = pendingPatches.current.get(id) ?? {}
      pendingPatches.current.set(id, { ...existing, x: next.x, y: next.y })
      scheduleAutosave()
    },
    [scheduleAutosave],
  )

  const handleCanvasClick = useCallback(
    async (worldPoint: { x: number; y: number }) => {
      if (!activeTool) {
        setSelectedId(null)
        return
      }
      // HU-03 — FREEHAND no se inserta por click; se captura por
      // gesture en el canvas y se persiste vía `handleDrawingCommit`.
      if (activeTool.kind === 'FREEHAND') return
      const type = toolToElementType(activeTool)
      const geom = defaultGeometry(type)
      const data = activeTool.kind === 'SHAPE'
        ? { ...defaultDataFor(type), variant: activeTool.variant }
        : defaultDataFor(type)
      try {
        const created = await createElement({
          whiteboardId: whiteboard.id,
          type,
          x: worldPoint.x - geom.width / 2,
          y: worldPoint.y - geom.height / 2,
          width: geom.width,
          height: geom.height,
          rotation: 0,
          data,
        })
        // El server devuelve el elemento Prisma con `data` Json; normalizamos.
        const newEl: WhiteboardElement = {
          id: created.id,
          whiteboardId: created.whiteboardId,
          type: created.type,
          x: created.x,
          y: created.y,
          width: created.width,
          height: created.height,
          rotation: created.rotation,
          zIndex: created.zIndex,
          data: created.data as WhiteboardElement['data'],
        }
        setElements((prev) => [...prev, newEl])
        setSelectedId(newEl.id)
        // Tras insertar volvemos al modo "Seleccionar" — UX típica de Miro.
        setActiveTool(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al insertar elemento')
      }
    },
    [activeTool, whiteboard.id],
  )

  // HU-03 (2026-05-14) — Trazo libre commit. El canvas devuelve los puntos
  // en coordenadas mundo. Calculamos el bbox y persistimos el elemento.
  // No reseteamos `activeTool` al terminar (a diferencia de los otros
  // tools) para permitir trazos consecutivos sin re-seleccionar el pincel.
  const handleDrawingCommit = useCallback(
    async (points: { x: number; y: number }[]) => {
      if (!activeTool || activeTool.kind !== 'FREEHAND') return
      if (points.length < 2) return
      const preset = BRUSH_PRESETS[activeTool.brush]
      const bounds = computeFreehandBounds(points)
      const data = makeFreehandData(activeTool.brush, preset.color, preset.width, points)
      try {
        const created = await createElement({
          whiteboardId: whiteboard.id,
          type: 'FREEHAND',
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          rotation: 0,
          data,
        })
        const newEl: WhiteboardElement = {
          id: created.id,
          whiteboardId: created.whiteboardId,
          type: created.type,
          x: created.x,
          y: created.y,
          width: created.width,
          height: created.height,
          rotation: created.rotation,
          zIndex: created.zIndex,
          data: created.data as WhiteboardElement['data'],
        }
        setElements((prev) => [...prev, newEl])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar trazo')
      }
    },
    [activeTool, whiteboard.id],
  )

  const handleDeleteSelected = useCallback(async () => {
    // HU-12 — borra TODO el set seleccionado (incluye el primary).
    const ids = new Set<string>(selectedIds)
    if (selectedId) ids.add(selectedId)
    if (ids.size === 0) return
    const idsArr = Array.from(ids)
    const previous = elements
    setElements((prev) => prev.filter((el) => !ids.has(el.id)))
    setSelectedId(null)
    setSelectedIds(new Set())
    try {
      await deleteElements(whiteboard.id, idsArr)
    } catch (err) {
      setElements(previous)
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
    }
  }, [elements, selectedId, selectedIds, whiteboard.id])

  // HU-12 (2026-05-14) — Group, Ungroup, Lock/Unlock.
  const handleGroupSelected = useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length < 2) {
      toast.error('Selecciona al menos 2 elementos para agrupar')
      return
    }
    try {
      const { groupId } = await groupElements(whiteboard.id, ids)
      setElements((prev) =>
        prev.map((el) => (ids.includes(el.id) ? { ...el, groupId } : el)),
      )
      toast.success(`${ids.length} elementos agrupados`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al agrupar')
    }
  }, [selectedIds, whiteboard.id])

  const handleUngroupSelected = useCallback(async () => {
    // Toma el primer groupId presente en la selección (si hay varios
    // grupos, los desagrupa por separado en futuras iteraciones; aquí
    // hacemos solo el de la selección activa).
    const primary = elements.find((e) => selectedIds.has(e.id) && e.groupId)
    if (!primary?.groupId) {
      toast.error('Los elementos seleccionados no están agrupados')
      return
    }
    const gid = primary.groupId
    try {
      await ungroupGroup(whiteboard.id, gid)
      setElements((prev) =>
        prev.map((el) => (el.groupId === gid ? { ...el, groupId: null } : el)),
      )
      toast.success('Grupo deshecho')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al desagrupar')
    }
  }, [elements, selectedIds, whiteboard.id])

  const handleToggleLockSelected = useCallback(async () => {
    const ids = new Set<string>(selectedIds)
    if (selectedId) ids.add(selectedId)
    if (ids.size === 0) return
    const idsArr = Array.from(ids)
    // Si TODOS están locked → desbloquear. Si alguno NO lo está → bloquear todos.
    const allLocked = idsArr.every(
      (id) => elements.find((e) => e.id === id)?.locked === true,
    )
    const nextLocked = !allLocked
    try {
      await setElementsLocked(whiteboard.id, idsArr, nextLocked)
      setElements((prev) =>
        prev.map((el) => (ids.has(el.id) ? { ...el, locked: nextLocked } : el)),
      )
      toast.success(nextLocked ? 'Bloqueado' : 'Desbloqueado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al cambiar bloqueo')
    }
  }, [elements, selectedId, selectedIds, whiteboard.id])

  // Actualiza el payload `data` JSON del elemento (texto, color, etc.).
  // Optimista: actualiza UI primero, luego persiste. Si falla, rollback.
  const handleUpdateData = useCallback(
    async (id: string, patch: Record<string, unknown>) => {
      const target = elements.find((el) => el.id === id)
      if (!target) return
      const previous = elements
      const merged = {
        ...(target.data as Record<string, unknown>),
        ...patch,
      }
      setElements((prev) =>
        prev.map((el) =>
          el.id === id
            ? { ...el, data: merged as WhiteboardElement['data'] }
            : el,
        ),
      )
      try {
        await setElementData(id, merged)
      } catch (err) {
        setElements(previous)
        toast.error(err instanceof Error ? err.message : 'Error al guardar')
      }
    },
    [elements],
  )

  // Duplica el elemento seleccionado con offset diagonal de +20px.
  const handleDuplicateSelected = useCallback(async () => {
    if (!selectedId) return
    const target = elements.find((el) => el.id === selectedId)
    if (!target) return
    try {
      const created = await createElement({
        whiteboardId: whiteboard.id,
        type: target.type,
        x: target.x + 20,
        y: target.y + 20,
        width: target.width,
        height: target.height,
        rotation: target.rotation,
        data: target.data,
      })
      const newEl: WhiteboardElement = {
        id: created.id,
        whiteboardId: created.whiteboardId,
        type: created.type,
        x: created.x,
        y: created.y,
        width: created.width,
        height: created.height,
        rotation: created.rotation,
        zIndex: created.zIndex,
        data: created.data as WhiteboardElement['data'],
      }
      setElements((prev) => [...prev, newEl])
      setSelectedId(newEl.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al duplicar')
    }
  }, [elements, selectedId, whiteboard.id])

  // Cambia el orden Z para llevar al frente o enviar al fondo.
  const handleChangeZ = useCallback(
    async (id: string, direction: 'front' | 'back') => {
      const others = elements.filter((el) => el.id !== id)
      const target = elements.find((el) => el.id === id)
      if (!target) return
      // Si no hay otros elementos, usamos 1/-1 como anclas. Con seed 0 el
      // reduce devolvía 0 aunque todos los zIndex fueran positivos, lo que
      // dejaba elementos enviados al fondo "delante" de los demás.
      const maxZ =
        others.length > 0
          ? others.reduce((m, e) => Math.max(m, e.zIndex), -Infinity)
          : 0
      const minZ =
        others.length > 0
          ? others.reduce((m, e) => Math.min(m, e.zIndex), Infinity)
          : 0
      const nextZ = direction === 'front' ? maxZ + 1 : minZ - 1
      setElements((prev) =>
        prev.map((el) => (el.id === id ? { ...el, zIndex: nextZ } : el)),
      )
      pendingPatches.current.set(id, {
        ...(pendingPatches.current.get(id) ?? {}),
        zIndex: nextZ,
      })
      scheduleAutosave()
    },
    [elements, scheduleAutosave],
  )

  // Mantén la ref apuntando al handler vigente. Esto deja al listener
  // global de teclado independiente del ciclo de render: lo registramos
  // una sola vez (efecto vacío) y leemos `deleteSelectedRef.current`
  // dentro del callback nativo. Evita re-suscripciones costosas.
  useEffect(() => {
    deleteSelectedRef.current = () => {
      void handleDeleteSelected()
    }
  }, [handleDeleteSelected])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        setPanMode(true)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedRef.current()
      } else if (e.key === 'Escape') {
        setActiveTool(null)
        setSelectedId(null)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setPanMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  const handleExportPng = useCallback(() => {
    try {
      const dataUrl = exportElementsToPng(elements)
      const safe = whiteboard.title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'pizarra'
      downloadDataUrl(dataUrl, `${safe}.png`)
      toast.success('PNG exportado')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al exportar')
    }
  }, [elements, whiteboard.title])

  // HU-13 (2026-05-14) — Export extendido (PDF + hi-res + selección).
  const handleExport = useCallback(
    (kind: ExportKind) => {
      const safe =
        whiteboard.title.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'pizarra'
      try {
        if (kind === 'png') {
          const url = exportElementsToPng(elements)
          downloadDataUrl(url, `${safe}.png`)
          toast.success('PNG exportado')
          return
        }
        if (kind === 'png-hires') {
          const url = exportElementsToHighResPng(elements)
          downloadDataUrl(url, `${safe}-hires.png`)
          toast.success('PNG en alta resolución exportado')
          return
        }
        if (kind === 'pdf') {
          const pdf = exportElementsToPdf(elements, { title: whiteboard.title })
          downloadPdf(pdf, `${safe}.pdf`)
          toast.success('PDF exportado')
          return
        }
        if (kind === 'pdf-selection') {
          if (!selectedId) {
            toast.error('Selecciona un elemento primero')
            return
          }
          const pdf = exportElementsToPdf(elements, {
            title: `${whiteboard.title} (selección)`,
            selectedIds: [selectedId],
          })
          downloadPdf(pdf, `${safe}-seleccion.pdf`)
          toast.success('PDF (selección) exportado')
          return
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al exportar')
      }
    },
    [elements, whiteboard.title, selectedId],
  )

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/whiteboards"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
            aria-label="Volver a pizarras"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-foreground">{whiteboard.title}</h1>
            {whiteboard.projectName && (
              <p className="truncate text-xs text-muted-foreground">{whiteboard.projectName}</p>
            )}
          </div>
        </div>
        <SaveIndicator state={savingState} />
      </header>

      {/* Wave P6 · B3 — banner de presencia (lock). null si nadie más edita. */}
      <div className="px-4 pt-2">
        <EditingByBanner
          editingUsers={lock.editingUsers}
          isLockedByOther={lock.isLockedByOther}
          onForceOverride={lock.forceOverride}
        />
      </div>
      {/* SoftLockProvider en modo `unwrap` — sólo proporciona contexto, no
          envuelve con div para no romper el flexbox del shell. La toolbar y
          el canvas reciben `aria-disabled` directamente cuando está locked. */}
      <SoftLockProvider isLocked={lock.isLockedByOther} unwrap>
        <div
          className={
            lock.isLockedByOther
              ? 'flex flex-1 flex-col pointer-events-none select-none opacity-70'
              : 'flex flex-1 flex-col'
          }
          data-testid="whiteboard-editor-region"
          data-locked={lock.isLockedByOther ? 'true' : 'false'}
          aria-disabled={lock.isLockedByOther || undefined}
        >
          <div className="flex items-center justify-center gap-4 border-b border-border bg-subtle/30 px-4 py-2">
            <WhiteboardToolbar
              activeTool={activeTool}
              onSelectTool={setActiveTool}
              snapEnabled={snapEnabled}
              onToggleSnap={setSnapEnabled}
              onExportPng={handleExportPng}
              onExport={handleExport}
              hasSelection={selectedId !== null}
            />
            {presence.users.length > 0 ? (
              <div
                className="flex items-center"
                data-testid="whiteboard-toolbar-presence"
              >
                <PresenceAvatars users={presence.users} max={5} />
              </div>
            ) : null}
          </div>

          <div className="relative flex-1 overflow-hidden">
            <WhiteboardCanvas
              elements={elements}
              selectedId={selectedId}
              editingId={editingId}
              selectedIds={selectedIds}
              onSelect={(id, additive) => {
                setContextMenu(null)
                if (id !== editingId) setEditingId(null)
                if (id === null) {
                  // Deselección total (sin shift).
                  setSelectedId(null)
                  setSelectedIds(new Set())
                  return
                }
                // HU-12 — Click en elemento con groupId selecciona TODOS
                // los miembros del grupo automáticamente (UX tipo Miro).
                const clicked = elements.find((e) => e.id === id)
                const groupMates = clicked?.groupId
                  ? elements.filter((e) => e.groupId === clicked.groupId).map((e) => e.id)
                  : [id]
                if (additive) {
                  // Shift+click → toggle del elemento (o todo el grupo).
                  setSelectedIds((prev) => {
                    const next = new Set(prev)
                    const allInSet = groupMates.every((g) => next.has(g))
                    if (allInSet) {
                      for (const g of groupMates) next.delete(g)
                    } else {
                      for (const g of groupMates) next.add(g)
                    }
                    return next
                  })
                  setSelectedId(id)
                } else {
                  setSelectedIds(new Set(groupMates))
                  setSelectedId(id)
                }
              }}
              onMove={handleMove}
              onCanvasClick={(world) => {
                setContextMenu(null)
                setEditingId(null)
                void handleCanvasClick(world)
              }}
              onStartEdit={(id) => {
                setSelectedId(id)
                setEditingId(id)
                setContextMenu(null)
              }}
              onCommitEdit={(id, text) => {
                void handleUpdateData(id, { text })
                setEditingId(null)
              }}
              onContextMenu={(id, screen) => {
                setSelectedId(id)
                setContextMenu({ elementId: id, x: screen.x, y: screen.y })
              }}
              snapEnabled={snapEnabled}
              panMode={panMode}
              drawingMode={
                activeTool?.kind === 'FREEHAND'
                  ? { active: true, brush: activeTool.brush }
                  : undefined
              }
              onDrawingCommit={(points) => {
                void handleDrawingCommit(points)
              }}
            />

            {/* HU-12 — Multi-selection toolbar. Aparece cuando hay 2+
                seleccionados. Muestra Agrupar/Desagrupar (según si los
                elementos comparten groupId), Bloquear/Desbloquear, y
                Eliminar todo. Reemplaza al SelectedElementToolbar cuando
                la selección es múltiple. */}
            {selectedIds.size > 1 && !editingId && !contextMenu && (
              <MultiSelectionToolbar
                count={selectedIds.size}
                hasGroup={(() => {
                  const ids = Array.from(selectedIds)
                  const groups = new Set(
                    ids
                      .map((id) => elements.find((e) => e.id === id)?.groupId)
                      .filter(Boolean) as string[],
                  )
                  return groups.size === 1
                })()}
                allLocked={Array.from(selectedIds).every(
                  (id) => elements.find((e) => e.id === id)?.locked === true,
                )}
                onGroup={() => void handleGroupSelected()}
                onUngroup={() => void handleUngroupSelected()}
                onToggleLock={() => void handleToggleLockSelected()}
                onDeleteAll={() => void handleDeleteSelected()}
              />
            )}

            {selectedId && selectedIds.size <= 1 && !editingId && !contextMenu && (
              <SelectedElementToolbar
                element={elements.find((e) => e.id === selectedId)}
                onChangeColor={(color) => {
                  if (!selectedId) return
                  void handleUpdateData(selectedId, { color, fill: color })
                }}
                onDuplicate={() => void handleDuplicateSelected()}
                onBringToFront={() => void handleChangeZ(selectedId, 'front')}
                onSendToBack={() => void handleChangeZ(selectedId, 'back')}
                onEdit={() => setEditingId(selectedId)}
                onDelete={() => void handleDeleteSelected()}
                onToggleLock={() => void handleToggleLockSelected()}
              />
            )}

            {contextMenu && (
              <ContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                onClose={() => setContextMenu(null)}
                onEdit={() => {
                  setEditingId(contextMenu.elementId)
                  setContextMenu(null)
                }}
                onDuplicate={() => {
                  void handleDuplicateSelected()
                  setContextMenu(null)
                }}
                onBringToFront={() => {
                  void handleChangeZ(contextMenu.elementId, 'front')
                  setContextMenu(null)
                }}
                onSendToBack={() => {
                  void handleChangeZ(contextMenu.elementId, 'back')
                  setContextMenu(null)
                }}
                onDelete={() => {
                  void handleDeleteSelected()
                  setContextMenu(null)
                }}
              />
            )}
          </div>
        </div>
      </SoftLockProvider>

      {/* Wave P6 · B3 — ConflictDialog. Aparece en cuanto llega un UPDATE
          remoto más nuevo. Las pizarras autosalvan, así que mostramos esto
          como aviso post-hoc para que el usuario decida si seguir o
          recargar. */}
      <ConflictDialog
        open={lock.hasConflict}
        onOpenChange={(next) => {
          if (!next) lock.dismissConflict()
        }}
        fieldLabel="Pizarra"
        localValue={whiteboard.title}
        remoteValue={
          lock.remoteVersion
            ? `Versión remota guardada el ${lock.remoteVersion}`
            : 'Versión remota desconocida'
        }
        remoteAuthor={lock.remoteAuthorId ?? null}
        onResolve={handleResolveConflict}
      />
    </div>
  )
}

const COLOR_PALETTE = [
  '#fde68a', // amarillo (sticky default)
  '#fca5a5', // rojo claro
  '#86efac', // verde claro
  '#93c5fd', // azul claro
  '#c4b5fd', // morado claro
  '#fbcfe8', // rosa claro
  '#fed7aa', // naranja claro
  '#e5e7eb', // gris claro
]

function SelectedElementToolbar({
  element,
  onChangeColor,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  onEdit,
  onDelete,
  onToggleLock,
}: {
  element: WhiteboardElement | undefined
  onChangeColor: (hex: string) => void
  onDuplicate: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleLock?: () => void
}) {
  if (!element) return null
  const showColor = element.type === 'STICKY' || element.type === 'SHAPE'
  const showEdit =
    element.type === 'STICKY' ||
    element.type === 'TEXT' ||
    element.type === 'SHAPE'
  return (
    <div
      role="toolbar"
      aria-label="Acciones sobre elemento seleccionado"
      className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/95 px-2 py-1.5 shadow-xl backdrop-blur"
    >
      {showColor && (
        <>
          <div className="flex items-center gap-1 px-1">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChangeColor(c)}
                title={`Color ${c}`}
                aria-label={`Cambiar color a ${c}`}
                style={{ backgroundColor: c }}
                className="h-5 w-5 rounded-full border border-border ring-offset-1 hover:ring-2 hover:ring-primary"
              />
            ))}
          </div>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        </>
      )}
      {showEdit && (
        <button
          type="button"
          onClick={onEdit}
          title="Editar texto (doble click también)"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onDuplicate}
        title="Duplicar"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Copy className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onBringToFront}
        title="Traer al frente"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <ArrowUpToLine className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onSendToBack}
        title="Enviar al fondo"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <ArrowDownToLine className="h-4 w-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      {onToggleLock && (
        <button
          type="button"
          onClick={onToggleLock}
          title={element.locked ? 'Desbloquear' : 'Bloquear'}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          {element.locked ? '🔓' : '🔒'}
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        title="Eliminar"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/15 hover:text-rose-400"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

/**
 * HU-12 (2026-05-14) — Toolbar de multi-selección. Aparece cuando hay
 * 2+ elementos seleccionados. Permite Agrupar/Desagrupar, Bloquear,
 * y Eliminar todo.
 */
function MultiSelectionToolbar({
  count,
  hasGroup,
  allLocked,
  onGroup,
  onUngroup,
  onToggleLock,
  onDeleteAll,
}: {
  count: number
  hasGroup: boolean
  allLocked: boolean
  onGroup: () => void
  onUngroup: () => void
  onToggleLock: () => void
  onDeleteAll: () => void
}) {
  return (
    <div
      role="toolbar"
      aria-label="Acciones sobre selección múltiple"
      className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/95 px-2 py-1.5 shadow-xl backdrop-blur"
    >
      <span className="px-2 text-xs font-semibold text-foreground">
        {count} seleccionados
      </span>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      {hasGroup ? (
        <button
          type="button"
          onClick={onUngroup}
          title="Desagrupar"
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Desagrupar
        </button>
      ) : (
        <button
          type="button"
          onClick={onGroup}
          title="Agrupar (los elementos se moverán juntos)"
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          Agrupar
        </button>
      )}
      <button
        type="button"
        onClick={onToggleLock}
        title={allLocked ? 'Desbloquear' : 'Bloquear'}
        className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        {allLocked ? '🔓 Desbloquear' : '🔒 Bloquear'}
      </button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <button
        type="button"
        onClick={onDeleteAll}
        title="Eliminar todos"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/15 hover:text-rose-400"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function ContextMenu({
  x,
  y,
  onClose,
  onEdit,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  onDelete,
}: {
  x: number
  y: number
  onClose: () => void
  onEdit: () => void
  onDuplicate: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onDelete: () => void
}) {
  // Cierra al hacer click fuera o presionar Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = () => onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  return (
    <div
      role="menu"
      aria-label="Menú contextual del elemento"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute z-40 min-w-[180px] overflow-hidden rounded-lg border border-border bg-card shadow-xl"
    >
      <ContextMenuItem icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
        Editar texto
      </ContextMenuItem>
      <ContextMenuItem icon={<Copy className="h-4 w-4" />} onClick={onDuplicate}>
        Duplicar
      </ContextMenuItem>
      <ContextMenuItem
        icon={<ArrowUpToLine className="h-4 w-4" />}
        onClick={onBringToFront}
      >
        Traer al frente
      </ContextMenuItem>
      <ContextMenuItem
        icon={<ArrowDownToLine className="h-4 w-4" />}
        onClick={onSendToBack}
      >
        Enviar al fondo
      </ContextMenuItem>
      <div className="h-px bg-border" />
      <ContextMenuItem
        icon={<Trash2 className="h-4 w-4" />}
        onClick={onDelete}
        danger
      >
        Eliminar
      </ContextMenuItem>
    </div>
  )
}

function ContextMenuItem({
  icon,
  onClick,
  children,
  danger,
}: {
  icon: React.ReactNode
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs ${
        danger
          ? 'text-rose-400 hover:bg-rose-500/15'
          : 'text-foreground hover:bg-secondary'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function SaveIndicator({
  state,
}: {
  state: 'idle' | 'pending' | 'saving' | 'error'
}) {
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Guardando…
      </span>
    )
  }
  if (state === 'pending') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-400" aria-live="polite">
        <Save className="h-3.5 w-3.5" />
        Cambios pendientes
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="text-xs text-red-400" role="alert">
        Error al guardar
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
      <Save className="h-3.5 w-3.5" />
      Guardado
    </span>
  )
}
