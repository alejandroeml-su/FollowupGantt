'use client'

/**
 * Wave P6 · Equipo B3 — `useTaskEditLock`.
 *
 * Hook compuesto que combina `useEditPresence` + `useVersionCheck` para el
 * surface "Editar tarea" (TaskDrawerContent). Encapsula:
 *
 *   - Canal de presence: `task:<id>:edit` → "Ana está editando…".
 *   - Detección de conflicto de versión sobre la tabla `tasks` filtrando por
 *     `id=eq.<taskId>`. Cuando llega un UPDATE remoto cuyo `updatedAt` es
 *     más nuevo que el `currentVersion` cargado por el caller, marca
 *     `hasConflict=true`.
 *
 * El hook degrada a no-op cuando `taskId` es null (modo create) o cuando
 * Supabase Realtime no está configurado: `editingUsers=[]`,
 * `isLockedByOther=false`, `hasConflict=false`. La UI puede llamarlo
 * incondicionalmente sin guards adicionales.
 *
 * Convenciones:
 *   - `currentUser` opcional: si es `null`/`undefined`, devolvemos un
 *     resultado degradado (sin presence ni heartbeat). Esto permite a los
 *     callers sin sesión (ej. tests, SSR) usarlo sin romper.
 *   - El hook no llama server actions: el caller decide qué hacer cuando
 *     `hasConflict` es true (típicamente: abrir `<ConflictDialog>` antes de
 *     guardar). La acción "overwrite" simplemente vuelve a invocar el save
 *     existente; la BD es last-write-wins.
 */

import { useCallback, useState } from 'react'
import { useEditPresence } from '@/lib/realtime-locks/use-edit-presence'
import { useVersionCheck } from '@/lib/realtime-locks/use-version-check'
import type {
  EditingUser,
  EditPresenceState,
  VersionCheckState,
} from '@/lib/realtime-locks/types'

export type UseTaskEditLockOptions = {
  /** Id de la tarea editada. `null` deshabilita el lock (modo create). */
  taskId: string | null
  /** Identidad del usuario activo. `null`/`undefined` ⇒ degrada a no-op. */
  currentUser: EditingUser | null | undefined
  /** ISO `updatedAt` de la tarea ya cargada por el caller. */
  currentVersion: string | null
  /** Callback cuando llega UPDATE remoto de otro autor. */
  onConflict?: (remoteVersion: string, remoteAuthorId: string | null) => void
}

export type UseTaskEditLockResult = Pick<
  EditPresenceState,
  | 'editingUsers'
  | 'isLockedByOther'
  | 'isCurrentUserEditing'
  | 'startEditing'
  | 'stopEditing'
  | 'forceOverride'
  | 'isRealtimeAvailable'
> &
  Pick<VersionCheckState, 'hasConflict' | 'remoteVersion' | 'remoteAuthorId'> & {
    /** Cierra el ConflictDialog y limpia `hasConflict`. */
    dismissConflict: () => void
    /**
     * `true` cuando la página debe permitir edición ignorando el lock ajeno
     * (post-`forceOverride`). El caller actualiza esto manualmente o lo
     * deriva de `isCurrentUserEditing`.
     */
    overrideTaken: boolean
  }

const ANON_USER: EditingUser = {
  id: '__anon__',
  name: 'Anónimo',
}

/**
 * @see `UseTaskEditLockOptions`
 *
 * @example
 *   const lock = useTaskEditLock({
 *     taskId: task.id,
 *     currentUser: { id: me.id, name: me.name },
 *     currentVersion: task.updatedAt,
 *   })
 */
export function useTaskEditLock(
  opts: UseTaskEditLockOptions,
): UseTaskEditLockResult {
  const { taskId, currentUser, currentVersion, onConflict } = opts

  // Cuando no hay user, usamos un sentinel para que el hook de presence
  // siga sin romper. El canal recibirá un id estable pero sin nombre real.
  // Como `currentUser` es `null`, la UI consumidora debería pasar
  // `editingUsers=[]` y omitir banner — pero degradar internamente es más
  // robusto que lanzar.
  const effectiveUser = currentUser ?? ANON_USER

  // Si el caller pasa `null` taskId (modo create), pasamos un canal vacío
  // y `useEditPresence` se comporta como no-op (sin canal).
  const channelName = taskId ? `task:${taskId}:edit` : ''

  const presence = useEditPresence(channelName, effectiveUser)
  const version = useVersionCheck('task', taskId, currentVersion, {
    currentUserId: currentUser?.id ?? null,
    onRemoteUpdate: onConflict,
  })

  const [overrideTaken, setOverrideTaken] = useState(false)

  const dismissConflict = useCallback(() => {
    version.acknowledge()
  }, [version])

  // Wrapping de `forceOverride` para registrar localmente el override.
  // Esto permite a la UI saber que el banner se quedó pero el form ya está
  // editable de nuevo.
  const forceOverride = useCallback(() => {
    setOverrideTaken(true)
    presence.forceOverride()
  }, [presence])

  // Si el usuario libera explícitamente, volvemos a respetar el lock ajeno.
  const stopEditing = useCallback(() => {
    setOverrideTaken(false)
    presence.stopEditing()
  }, [presence])

  // Sin currentUser real, la UI no debería habilitar lock — devolvemos
  // arrays vacíos para que el banner desaparezca aunque el canal tenga peers.
  if (!currentUser) {
    return {
      editingUsers: [],
      isLockedByOther: false,
      isCurrentUserEditing: false,
      startEditing: () => {
        /* no-op sin user */
      },
      stopEditing: () => {
        /* no-op sin user */
      },
      forceOverride: () => {
        /* no-op sin user */
      },
      isRealtimeAvailable: false,
      hasConflict: false,
      remoteVersion: null,
      remoteAuthorId: null,
      dismissConflict,
      overrideTaken: false,
    }
  }

  return {
    editingUsers: presence.editingUsers,
    isLockedByOther: presence.isLockedByOther && !overrideTaken,
    isCurrentUserEditing: presence.isCurrentUserEditing,
    startEditing: presence.startEditing,
    stopEditing,
    forceOverride,
    isRealtimeAvailable: presence.isRealtimeAvailable,
    hasConflict: version.hasConflict,
    remoteVersion: version.remoteVersion,
    remoteAuthorId: version.remoteAuthorId,
    dismissConflict,
    overrideTaken,
  }
}
