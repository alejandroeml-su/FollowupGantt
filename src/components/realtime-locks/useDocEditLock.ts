'use client'

/**
 * Wave P6 · Equipo B3 — `useDocEditLock`.
 *
 * Equivalente a `useTaskEditLock` para el surface "Editar documento"
 * (`DocEditor`). Canal `doc:<id>:edit`, tabla `docs`.
 *
 * Particularidad: el DocEditor usa autosave debounced (1s). Eso significa
 * que:
 *   - Mientras el usuario tipea, el `currentVersion` que pasamos puede ir
 *     "atrás" del último save propio. El hook `useVersionCheck` ya filtra
 *     updates cuyo autor coincide con `currentUserId` para evitar conflictos
 *     espurios; sin embargo, conviene que el caller actualice el
 *     `currentVersion` cuando recibe un save propio exitoso.
 *   - `isLockedByOther` no debería bloquear el textarea físicamente: el
 *     usuario puede seguir escribiendo, pero se le advierte vía banner que
 *     puede haber conflicto. La decisión final de envolver con
 *     `<SoftLockProvider>` queda en manos del caller.
 */

import { useCallback, useState } from 'react'
import { useEditPresence } from '@/lib/realtime-locks/use-edit-presence'
import { useVersionCheck } from '@/lib/realtime-locks/use-version-check'
import type {
  EditingUser,
  EditPresenceState,
  VersionCheckState,
} from '@/lib/realtime-locks/types'

export type UseDocEditLockOptions = {
  docId: string | null
  currentUser: EditingUser | null | undefined
  currentVersion: string | null
  onConflict?: (remoteVersion: string, remoteAuthorId: string | null) => void
}

export type UseDocEditLockResult = Pick<
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
    dismissConflict: () => void
    overrideTaken: boolean
  }

const ANON_USER: EditingUser = {
  id: '__anon__',
  name: 'Anónimo',
}

export function useDocEditLock(
  opts: UseDocEditLockOptions,
): UseDocEditLockResult {
  const { docId, currentUser, currentVersion, onConflict } = opts
  const effectiveUser = currentUser ?? ANON_USER
  const channelName = docId ? `doc:${docId}:edit` : ''

  const presence = useEditPresence(channelName, effectiveUser)
  const version = useVersionCheck('doc', docId, currentVersion, {
    currentUserId: currentUser?.id ?? null,
    onRemoteUpdate: onConflict,
  })

  const [overrideTaken, setOverrideTaken] = useState(false)

  const dismissConflict = useCallback(() => {
    version.acknowledge()
  }, [version])

  const forceOverride = useCallback(() => {
    setOverrideTaken(true)
    presence.forceOverride()
  }, [presence])

  const stopEditing = useCallback(() => {
    setOverrideTaken(false)
    presence.stopEditing()
  }, [presence])

  if (!currentUser) {
    return {
      editingUsers: [],
      isLockedByOther: false,
      isCurrentUserEditing: false,
      startEditing: () => {},
      stopEditing: () => {},
      forceOverride: () => {},
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
