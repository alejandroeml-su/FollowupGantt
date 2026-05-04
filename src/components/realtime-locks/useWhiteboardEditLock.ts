'use client'

/**
 * Wave P6 · Equipo B3 — `useWhiteboardEditLock`.
 *
 * Equivalente a `useTaskEditLock` pero para el surface "Editar pizarra"
 * (`WhiteboardEditor`). Canal `whiteboard:<id>:edit`, tabla `whiteboards`.
 *
 * Notas específicas del whiteboard:
 *   - Las pizarras se autosalvan por elemento; el `currentVersion` aquí se
 *     refiere al `updatedAt` de la fila `whiteboard` (top-level), no al de
 *     cada elemento. La detección de conflicto se dispara cuando el server
 *     "toca" `updatedAt` del padre tras una mutación.
 *   - `isLockedByOther` no congela el canvas físicamente — el caller decide
 *     si quiere envolver con `<SoftLockProvider>` (recomendado: solo el
 *     toolbar y el header, no el viewport, para que el usuario pueda mirar).
 */

import { useCallback, useState } from 'react'
import { useEditPresence } from '@/lib/realtime-locks/use-edit-presence'
import { useVersionCheck } from '@/lib/realtime-locks/use-version-check'
import type {
  EditingUser,
  EditPresenceState,
  VersionCheckState,
} from '@/lib/realtime-locks/types'

export type UseWhiteboardEditLockOptions = {
  whiteboardId: string | null
  currentUser: EditingUser | null | undefined
  currentVersion: string | null
  onConflict?: (remoteVersion: string, remoteAuthorId: string | null) => void
}

export type UseWhiteboardEditLockResult = Pick<
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

export function useWhiteboardEditLock(
  opts: UseWhiteboardEditLockOptions,
): UseWhiteboardEditLockResult {
  const { whiteboardId, currentUser, currentVersion, onConflict } = opts
  const effectiveUser = currentUser ?? ANON_USER
  const channelName = whiteboardId ? `whiteboard:${whiteboardId}:edit` : ''

  const presence = useEditPresence(channelName, effectiveUser)
  const version = useVersionCheck('whiteboard', whiteboardId, currentVersion, {
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
