'use client'

/**
 * R4 · US-7.2 Chat View — Hook que sincroniza un canal de chat en vivo.
 *
 * Compone tres canales Supabase Realtime:
 *
 *   1. `postgres_changes` sobre `ChatMessage` filtrado por `channelId`
 *      para INSERT (mensajes nuevos) + UPDATE (edición/soft-delete).
 *      Esto se prefiere sobre broadcast para los rows persistidos: el
 *      cliente recibe el `id`/`createdAt` autoritativos del servidor y
 *      Supabase reentrega backlog tras reconexión.
 *
 *   2. `postgres_changes` sobre `ChatMessageReaction` filtrado por
 *      `messageId IN (visibles)` — en MVP usamos broadcast (más simple)
 *      porque las reacciones son baratas de recalcular.
 *
 *   3. `broadcast` para typing-indicator efímero (no persiste).
 *
 * Si las env vars `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * no están configuradas, el hook degrada a fetch normal (sin vivo).
 *
 * Patrones copiados de `useTaskComments`:
 *   - `seenIdsRef` para reconciliación con optimistic UI sin duplicar.
 *   - Purga de channels stale antes de re-suscribir (evitar
 *     "cannot add postgres_changes callbacks after subscribe()").
 *   - `cancelled` flag + `AbortController` en el fetch inicial.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { SerializedChatMessage } from '@/lib/actions/chat'
import {
  listMessages,
  sendMessage as sendMessageAction,
  addReaction as addReactionAction,
  editMessage as editMessageAction,
  deleteMessage as deleteMessageAction,
} from '@/lib/actions/chat'

export type ChatCurrentUser = {
  id: string
  name: string
}

export type UseChatChannelResult = {
  messages: SerializedChatMessage[]
  isLoading: boolean
  error: string | null
  /** Envío con optimistic UI: el mensaje aparece de inmediato. */
  sendMessage: (
    content: string,
    opts?: { parentMessageId?: string | null },
  ) => Promise<void>
  /** Toggle de reacción en un mensaje. */
  toggleReaction: (messageId: string, emoji: string) => Promise<void>
  /** Editar contenido de un mensaje (sólo si el caller es el autor). */
  editMessage: (messageId: string, content: string) => Promise<void>
  /** Soft-delete de un mensaje. */
  deleteMessage: (messageId: string) => Promise<void>
}

/** Row crudo entregado por Supabase Realtime para INSERT/UPDATE. */
type RealtimeMessageRow = {
  id: string
  channelId: string
  authorId: string | null
  content: string
  parentMessageId: string | null
  createdAt: string | null
  editedAt: string | null
  deletedAt: string | null
}

/** Inserta o reemplaza una fila optimista por la copia "real" del server. */
function rowToMessage(
  row: RealtimeMessageRow,
  authorName: string | null = null,
): SerializedChatMessage {
  const createdAt = row.createdAt
    ? typeof row.createdAt === 'string'
      ? row.createdAt
      : new Date(row.createdAt).toISOString()
    : new Date().toISOString()
  return {
    id: row.id,
    channelId: row.channelId,
    content: row.content,
    parentMessageId: row.parentMessageId,
    createdAt,
    editedAt: row.editedAt ?? null,
    deletedAt: row.deletedAt ?? null,
    author: row.authorId
      ? { id: row.authorId, name: authorName ?? '' }
      : null,
    reactions: [],
    mentionedUserIds: [],
  }
}

function tmpId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `tmp-${globalThis.crypto.randomUUID()}`
  }
  return `tmp-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

export function useChatChannel(
  channelId: string | null,
  currentUser: ChatCurrentUser | null,
): UseChatChannelResult {
  const [messages, setMessages] = useState<SerializedChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(Boolean(channelId))
  const [error, setError] = useState<string | null>(null)

  // Reset al cambiar de canal (patrón "deriva estado de props" React 19).
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(
    channelId,
  )
  if (currentChannelId !== channelId) {
    setCurrentChannelId(channelId)
    setMessages([])
    setIsLoading(Boolean(channelId))
    setError(null)
  }

  const seenIdsRef = useRef<Set<string>>(new Set())

  // Fetch inicial.
  useEffect(() => {
    if (!channelId) return
    const ctrl = new AbortController()
    let cancelled = false
    seenIdsRef.current = new Set()

    listMessages({ channelId })
      .then((rows) => {
        if (cancelled) return
        const seen = new Set<string>()
        for (const r of rows) seen.add(r.id)
        seenIdsRef.current = seen
        setMessages(rows)
        setIsLoading(false)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Error cargando mensajes')
        setIsLoading(false)
      })

    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [channelId])

  // Subscripción postgres_changes (INSERT + UPDATE).
  useEffect(() => {
    if (!channelId) return
    const hasConfig =
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    if (!hasConfig) return

    let channel: RealtimeChannel | null = null
    try {
      const channelName = `chat:${channelId}:messages`
      // Purga channels stale del mismo topic (ver `useTaskComments`).
      const getChannelsFn = (
        supabase as unknown as { getChannels?: () => RealtimeChannel[] }
      ).getChannels
      if (typeof getChannelsFn === 'function') {
        const stale = getChannelsFn
          .call(supabase)
          .find((c) => c.topic === `realtime:${channelName}`)
        if (stale) {
          try {
            supabase.removeChannel(stale)
          } catch {
            /* no-op */
          }
        }
      }

      channel = supabase
        .channel(channelName)
        .on(
          // @ts-expect-error — overload de postgres_changes no expuesto.
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'ChatMessage',
            filter: `channelId=eq.${channelId}`,
          },
          (payload: { new?: RealtimeMessageRow }) => {
            const row = payload?.new
            if (!row || row.channelId !== channelId) return
            if (seenIdsRef.current.has(row.id)) return
            seenIdsRef.current.add(row.id)
            setMessages((prev) => {
              // Reconciliación optimistic: si hay un tmp- del mismo
              // (authorId, content), reemplázalo.
              const idx = prev.findIndex(
                (m) =>
                  m.id.startsWith('tmp-') &&
                  m.content === row.content &&
                  m.author?.id === (row.authorId ?? null),
              )
              const authorName =
                currentUser && currentUser.id === row.authorId
                  ? currentUser.name
                  : null
              const real = rowToMessage(row, authorName)
              if (idx >= 0) {
                const next = prev.slice()
                next[idx] = real
                return next
              }
              return [...prev, real]
            })
          },
        )
        .on(
          // @ts-expect-error — overload no expuesto.
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'ChatMessage',
            filter: `channelId=eq.${channelId}`,
          },
          (payload: { new?: RealtimeMessageRow }) => {
            const row = payload?.new
            if (!row || row.channelId !== channelId) return
            setMessages((prev) =>
              prev.map((m) =>
                m.id === row.id
                  ? {
                      ...m,
                      content: row.content,
                      editedAt: row.editedAt ?? m.editedAt,
                      deletedAt: row.deletedAt ?? m.deletedAt,
                    }
                  : m,
              ),
            )
          },
        )
        .subscribe()
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[useChatChannel] subscribe failed', e)
      }
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel)
        } catch {
          /* no-op */
        }
      }
    }
  }, [channelId, currentUser])

  const sendMessage = useCallback(
    async (
      content: string,
      opts?: { parentMessageId?: string | null },
    ): Promise<void> => {
      if (!channelId) return
      const trimmed = content.trim()
      if (!trimmed) return
      const optimistic: SerializedChatMessage = {
        id: tmpId(),
        channelId,
        content: trimmed,
        parentMessageId: opts?.parentMessageId ?? null,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
        author: currentUser
          ? { id: currentUser.id, name: currentUser.name }
          : null,
        reactions: [],
        mentionedUserIds: [],
      }
      setMessages((prev) => [...prev, optimistic])
      try {
        await sendMessageAction({
          channelId,
          content: trimmed,
          parentMessageId: opts?.parentMessageId ?? null,
        })
      } catch (e) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        throw e instanceof Error
          ? e
          : new Error('Error al enviar mensaje')
      }
    },
    [channelId, currentUser],
  )

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string): Promise<void> => {
      // Optimistic: actualizamos el set de userIds de la pastilla
      // correspondiente. Si el caller ya estaba en el set lo sacamos,
      // si no estaba lo agregamos.
      const me = currentUser?.id
      if (!me) return
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m
          const existing = m.reactions.find((r) => r.emoji === emoji)
          if (existing) {
            const has = existing.userIds.includes(me)
            const nextUsers = has
              ? existing.userIds.filter((u) => u !== me)
              : [...existing.userIds, me]
            if (nextUsers.length === 0) {
              return {
                ...m,
                reactions: m.reactions.filter((r) => r.emoji !== emoji),
              }
            }
            return {
              ...m,
              reactions: m.reactions.map((r) =>
                r.emoji === emoji ? { ...r, userIds: nextUsers } : r,
              ),
            }
          }
          return {
            ...m,
            reactions: [...m.reactions, { emoji, userIds: [me] }],
          }
        }),
      )
      try {
        await addReactionAction({ messageId, emoji })
      } catch (e) {
        // Rollback simple: re-aplicamos toggle inverso.
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m
            const existing = m.reactions.find((r) => r.emoji === emoji)
            if (!existing) return m
            const has = existing.userIds.includes(me)
            const nextUsers = has
              ? existing.userIds.filter((u) => u !== me)
              : [...existing.userIds, me]
            if (nextUsers.length === 0) {
              return {
                ...m,
                reactions: m.reactions.filter((r) => r.emoji !== emoji),
              }
            }
            return {
              ...m,
              reactions: m.reactions.map((r) =>
                r.emoji === emoji ? { ...r, userIds: nextUsers } : r,
              ),
            }
          }),
        )
        throw e instanceof Error ? e : new Error('Error al reaccionar')
      }
    },
    [currentUser],
  )

  const editMessage = useCallback(
    async (messageId: string, content: string): Promise<void> => {
      const trimmed = content.trim()
      if (!trimmed) return
      const before = messages.find((m) => m.id === messageId)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, content: trimmed, editedAt: new Date().toISOString() }
            : m,
        ),
      )
      try {
        await editMessageAction({ messageId, content: trimmed })
      } catch (e) {
        if (before) {
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? before : m)),
          )
        }
        throw e instanceof Error ? e : new Error('Error al editar mensaje')
      }
    },
    [messages],
  )

  const deleteMessage = useCallback(
    async (messageId: string): Promise<void> => {
      const before = messages.find((m) => m.id === messageId)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, deletedAt: new Date().toISOString() }
            : m,
        ),
      )
      try {
        await deleteMessageAction({ messageId })
      } catch (e) {
        if (before) {
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? before : m)),
          )
        }
        throw e instanceof Error ? e : new Error('Error al eliminar mensaje')
      }
    },
    [messages],
  )

  return useMemo(
    () => ({
      messages,
      isLoading,
      error,
      sendMessage,
      toggleReaction,
      editMessage,
      deleteMessage,
    }),
    [
      messages,
      isLoading,
      error,
      sendMessage,
      toggleReaction,
      editMessage,
      deleteMessage,
    ],
  )
}
