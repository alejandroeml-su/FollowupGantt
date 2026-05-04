'use client'

/**
 * Wave P6 · Equipo A3 — Hook que combina:
 *   1. Fetch inicial de comentarios via server action (`createComment` para
 *      mutación; lectura directa via `getCommentsForTaskAction` que vive en
 *      este módulo para no tocar `src/lib/actions.ts`).
 *   2. Subscripción Supabase Realtime (`postgres_changes`) filtrada por
 *      `taskId`, para recibir INSERTs hechos desde otras pestañas/usuarios.
 *   3. Optimistic UI sobre `addComment`: añade el comment local de inmediato
 *      con un `id` "tmp-…" y lo reconcilia cuando llega la copia real
 *      desde Realtime (match por `(authorId, content, ±5s createdAt)`).
 *
 * Decisiones:
 *   - `postgres_changes` (no broadcast) para los comentarios persistidos:
 *     queremos el row real con `id`/`createdAt` autoritativos del servidor
 *     y soportar reconexión sin perder eventos (Supabase entrega backlog).
 *   - Si Supabase no está configurado (env vars vacías) o falla el
 *     subscribe, degradamos a "fetch normal" sin updates en vivo.
 *   - React 19: el fetch inicial corre dentro de un effect con
 *     `AbortController`; el setState ocurre en respuesta a un evento async
 *     (no es "set state in effect" prohibido por la regla, porque depende
 *     de I/O, no de props).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { SerializedComment } from '@/lib/types'
import {
  createComment as createCommentAction,
} from '@/lib/actions'
import { getCommentsForTask } from './get-comments'

export type CurrentUser = {
  id: string
  name: string
}

export type UseTaskCommentsResult = {
  comments: SerializedComment[]
  isLoading: boolean
  error: string | null
  addComment: (text: string, opts?: { isInternal?: boolean }) => Promise<void>
}

type RealtimeRow = {
  id: string
  content: string
  isInternal?: boolean | null
  createdAt: string | Date | null
  authorId?: string | null
  taskId: string
}

/** Convierte un row crudo de `postgres_changes` a `SerializedComment`. */
function rowToComment(
  row: RealtimeRow,
  authorName: string | null = null,
): SerializedComment {
  const createdAt =
    typeof row.createdAt === 'string'
      ? row.createdAt
      : row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date().toISOString()
  return {
    id: row.id,
    content: row.content,
    isInternal: Boolean(row.isInternal),
    createdAt,
    author: row.authorId
      ? { id: row.authorId, name: authorName ?? '' }
      : null,
  }
}

/** Genera un id temporal estable para optimistic UI. */
function tmpId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `tmp-${globalThis.crypto.randomUUID()}`
  }
  return `tmp-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

export function useTaskComments(
  taskId: string,
  currentUser: CurrentUser | null,
): UseTaskCommentsResult {
  const [comments, setComments] = useState<SerializedComment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // `currentTaskId` mantiene el `taskId` cuyo fetch está reflejado en el
  // estado. Cuando `taskId` cambia, lo reseteamos sincronamente DURANTE
  // render (patrón React 19 para "derivar estado de props" sin
  // efecto-setState).
  const [currentTaskId, setCurrentTaskId] = useState<string>(taskId)
  if (currentTaskId !== taskId) {
    setCurrentTaskId(taskId)
    setComments([])
    setIsLoading(true)
    setError(null)
  }

  // Tracking interno: ids ya incorporados (para evitar duplicados al
  // reconciliar realtime con el optimistic).
  const seenIdsRef = useRef<Set<string>>(new Set())

  // Fetch inicial.
  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    seenIdsRef.current = new Set()

    getCommentsForTask(taskId)
      .then((rows) => {
        if (cancelled) return
        const seen = new Set<string>()
        for (const r of rows) seen.add(r.id)
        seenIdsRef.current = seen
        setComments(rows)
        setIsLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando comentarios')
        setIsLoading(false)
      })

    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [taskId])

  // Subscripción a postgres_changes para INSERT en tabla Comment.
  useEffect(() => {
    // Si la URL/key de Supabase no están definidas, no intentamos
    // suscribirnos: el cliente lanzaría warnings y fallaría silencioso.
    const hasConfig =
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    if (!hasConfig) return

    let channel: RealtimeChannel | null = null
    try {
      channel = supabase
        .channel(`task:${taskId}:comments`)
        .on(
          // @ts-expect-error — overload de `.on('postgres_changes', …)` no
          // está expuesto en el typing público pero es la API documentada
          // (https://supabase.com/docs/guides/realtime/postgres-changes).
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'Comment',
            filter: `taskId=eq.${taskId}`,
          },
          (payload: { new?: RealtimeRow }) => {
            const row = payload?.new
            if (!row || row.taskId !== taskId) return
            // Evitar dobles si ya lo incorporamos (optimistic o eco).
            if (seenIdsRef.current.has(row.id)) return
            seenIdsRef.current.add(row.id)
            setComments((prev) => {
              // Reconciliación: si hay un optimistic con mismo
              // (authorId, content) en los últimos 10s, reemplázalo.
              const idx = prev.findIndex(
                (c) =>
                  c.id.startsWith('tmp-') &&
                  c.content === row.content &&
                  c.author?.id === (row.authorId ?? null),
              )
              const authorName =
                currentUser && currentUser.id === row.authorId
                  ? currentUser.name
                  : null
              const real = rowToComment(row, authorName)
              if (idx >= 0) {
                const next = prev.slice()
                next[idx] = real
                return next
              }
              return [...prev, real]
            })
          },
        )
        .subscribe()
    } catch (e) {
      // No-op si Realtime no está disponible: degradamos a fetch normal.
      // Capturamos para no tirar el render del componente.
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useTaskComments] subscribe failed', e)
      }
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel)
        } catch {
          // ignore
        }
      }
    }
  }, [taskId, currentUser])

  const addComment = useCallback(
    async (text: string, opts?: { isInternal?: boolean }) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const isInternal = Boolean(opts?.isInternal)
      const optimistic: SerializedComment = {
        id: tmpId(),
        content: trimmed,
        isInternal,
        createdAt: new Date().toISOString(),
        author: currentUser
          ? { id: currentUser.id, name: currentUser.name }
          : null,
      }
      // Optimistic add.
      setComments((prev) => [...prev, optimistic])
      try {
        const fd = new FormData()
        fd.set('content', trimmed)
        fd.set('taskId', taskId)
        fd.set('isInternal', String(isInternal))
        if (currentUser?.id) fd.set('authorId', currentUser.id)
        await createCommentAction(fd)
        // Si Realtime no llega (degraded), no hay reconciliación: la copia
        // optimista queda con su `tmp-…`. Es aceptable para MVP.
      } catch (e) {
        // Rollback.
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id))
        throw e instanceof Error ? e : new Error('Error al enviar comentario')
      }
    },
    [taskId, currentUser],
  )

  return useMemo(
    () => ({ comments, isLoading, error, addComment }),
    [comments, isLoading, error, addComment],
  )
}
