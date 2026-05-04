'use client'

/**
 * Wave P6 · Equipo A5 — `useVersionCheck`.
 *
 * Detecta conflictos de **last-write-wins** mediante `postgres_changes`:
 *
 *   1. Suscribimos UPDATE de la tabla relevante con filtro `id=eq.<entityId>`.
 *   2. Cuando llega un payload con `updatedAt > currentVersion`, marcamos
 *      `hasConflict=true` y exponemos `remoteVersion` para que el caller pueda
 *      ofrecer "Ver cambios | Sobrescribir".
 *   3. Si el `updatedAt` remoto coincide con la última versión que el caller
 *      acaba de guardar (post-save propio), invocamos `onSelfUpdate` para que
 *      la UI actualice su `currentVersion` sin marcar conflicto.
 *
 * El hook degrada a no-op si no hay Supabase Realtime configurado.
 *
 * ### Convención de tabla
 *   El mapeo `entityType` → `table` se hace internamente para no exponer el
 *   nombre físico al caller. Los nombres siguen el `@@map` de Prisma:
 *
 *     task        → tasks
 *     whiteboard  → whiteboards
 *     doc         → docs
 *     goal        → goals
 *     sprint      → sprints
 *
 *   Si en el futuro algún `@@map` cambia, ajustar `TABLE_BY_ENTITY` aquí.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type {
  VersionCheckEntityType,
  VersionCheckState,
} from './types'

type RealtimeClientLike = {
  channel(name: string, opts?: Record<string, unknown>): RealtimeChannel
  removeChannel(channel: RealtimeChannel): unknown
}

const TABLE_BY_ENTITY: Record<VersionCheckEntityType, string> = {
  task: 'tasks',
  whiteboard: 'whiteboards',
  doc: 'docs',
  goal: 'goals',
  sprint: 'sprints',
}

function isRealtimeConfigured(): boolean {
  if (typeof process === 'undefined') return false
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  return typeof url === 'string' && url.length > 0
}

type UseVersionCheckOptions = {
  /** Identidad del usuario actual — usado para detectar updates "propios". */
  currentUserId?: string | null
  /**
   * Callback opcional invocado cuando el UPDATE remoto fue iniciado por el
   * usuario actual (post-save propio): el caller puede actualizar su
   * `currentVersion` para no disparar conflictos espurios.
   */
  onSelfUpdate?: (newVersion: string) => void
  /**
   * Callback opcional invocado cuando el UPDATE remoto viene de otro usuario.
   * Útil para logging / analytics. Diferente de `hasConflict` (que es estado
   * derivado del propio hook).
   */
  onRemoteUpdate?: (newVersion: string, authorId: string | null) => void
}

/**
 * @param entityType   discrimina la tabla a observar.
 * @param entityId     UUID/string de la fila.
 * @param currentVersion ISO string del `updatedAt` cargado por el caller.
 *                       Pasar `null` deshabilita el chequeo.
 * @param options      callbacks y currentUserId.
 * @param injectedClient (sólo tests) cliente Realtime mockeable.
 */
export function useVersionCheck(
  entityType: VersionCheckEntityType,
  entityId: string | null,
  currentVersion: string | null,
  options: UseVersionCheckOptions = {},
  injectedClient?: RealtimeClientLike,
): VersionCheckState {
  const { currentUserId, onSelfUpdate, onRemoteUpdate } = options
  const [hasConflict, setHasConflict] = useState(false)
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null)
  const [remoteAuthorId, setRemoteAuthorId] = useState<string | null>(null)

  // Mantenemos `currentVersion` accesible al callback estable de la suscripción
  // (evita re-suscribir cada vez que el caller actualiza su versión local).
  const currentVersionRef = useRef<string | null>(currentVersion)
  const userIdRef = useRef<string | null | undefined>(currentUserId)
  const onSelfUpdateRef = useRef<typeof onSelfUpdate>(onSelfUpdate)
  const onRemoteUpdateRef = useRef<typeof onRemoteUpdate>(onRemoteUpdate)

  useEffect(() => {
    currentVersionRef.current = currentVersion
  }, [currentVersion])
  useEffect(() => {
    userIdRef.current = currentUserId
  }, [currentUserId])
  useEffect(() => {
    onSelfUpdateRef.current = onSelfUpdate
  }, [onSelfUpdate])
  useEffect(() => {
    onRemoteUpdateRef.current = onRemoteUpdate
  }, [onRemoteUpdate])

  useEffect(() => {
    if (!entityId) return
    const client: RealtimeClientLike | undefined =
      injectedClient ??
      (isRealtimeConfigured()
        ? (supabase as unknown as RealtimeClientLike)
        : undefined)
    if (!client) return

    const table = TABLE_BY_ENTITY[entityType]
    const channelName = `${entityType}:${entityId}:version`
    const channel = client.channel(channelName)

    channel.on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table,
        filter: `id=eq.${entityId}`,
      },
      (payload: { new?: Record<string, unknown> }) => {
        const row = payload.new
        if (!row) return
        const updatedAt =
          typeof row.updatedAt === 'string'
            ? row.updatedAt
            : typeof row.updated_at === 'string'
              ? (row.updated_at as string)
              : null
        if (!updatedAt) return
        const authorId =
          typeof row.updatedById === 'string'
            ? row.updatedById
            : typeof row.updated_by_id === 'string'
              ? (row.updated_by_id as string)
              : null

        const localVersion = currentVersionRef.current
        // Update propio: el caller decide si aceptarlo (típicamente sí).
        if (authorId && userIdRef.current && authorId === userIdRef.current) {
          currentVersionRef.current = updatedAt
          setRemoteVersion(updatedAt)
          setRemoteAuthorId(authorId)
          onSelfUpdateRef.current?.(updatedAt)
          return
        }
        // Sin localVersion no podemos comparar: marcamos remote y listo.
        if (!localVersion) {
          setRemoteVersion(updatedAt)
          setRemoteAuthorId(authorId)
          onRemoteUpdateRef.current?.(updatedAt, authorId)
          return
        }
        if (new Date(updatedAt).getTime() > new Date(localVersion).getTime()) {
          setRemoteVersion(updatedAt)
          setRemoteAuthorId(authorId)
          setHasConflict(true)
          onRemoteUpdateRef.current?.(updatedAt, authorId)
        }
      },
    )

    channel.subscribe()

    return () => {
      try {
        client.removeChannel(channel)
      } catch {
        /* no-op */
      }
    }
  }, [entityType, entityId, injectedClient])

  const acknowledge = useCallback(() => {
    setHasConflict(false)
    if (remoteVersion) {
      currentVersionRef.current = remoteVersion
    }
  }, [remoteVersion])

  return {
    hasConflict,
    remoteVersion,
    remoteAuthorId,
    acknowledge,
  }
}
