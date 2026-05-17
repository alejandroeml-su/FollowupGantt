'use client'

/**
 * R4 · US-7.2 Chat View — Cliente principal de la vista Chat.
 *
 * Composición:
 *   - Sidebar izquierda con la lista de canales del proyecto.
 *   - Área central con los mensajes del canal seleccionado + composer.
 *   - Presence: muestra "N personas en este canal" (Supabase Realtime
 *     Presence). El módulo `use-presence.ts` ya está implementado y se
 *     usa también en `/docs` y `/whiteboards`.
 *   - Buscador inline (substring) para mensajes pasados del proyecto.
 *
 * Estructura del estado:
 *   - `channels`: lista cargada server-side y pasada como prop inicial.
 *   - `activeChannelId`: id del canal seleccionado (por defecto el primero).
 *   - `useChatChannel` hace el resto (fetch + realtime + mutaciones).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Hash,
  Plus,
  Search,
  Users,
  CornerDownRight,
  Reply as ReplyIcon,
  Pencil,
  Trash2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { createChannel, searchMessages } from '@/lib/actions/chat'
import {
  ALLOWED_REACTION_EMOJIS,
  type SerializedChatChannel,
  type SerializedChatMessage,
} from '@/lib/chat/shared'
import { useChatChannel } from '@/lib/realtime/use-chat-channel'
import { usePresence } from '@/lib/realtime/use-presence'
import type { PresenceIdentity } from '@/lib/realtime/types'
import { ChatComposer } from './ChatComposer'
import type { MentionUser } from '@/components/mentions/MentionTextarea'

export type ChatClientProps = {
  projectId: string
  projectName: string
  initialChannels: SerializedChatChannel[]
  currentUser: { id: string; name: string } | null
  mentionableUsers?: MentionUser[]
}

function formatRelative(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (Number.isNaN(diff)) return ''
  if (diff < 5) return 'ahora'
  if (diff < 60) return `hace ${diff}s`
  const m = Math.floor(diff / 60)
  if (m < 60) return `hace ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `hace ${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `hace ${days}d`
  return d.toLocaleDateString('es-MX')
}

/** Detecta URLs simples y devuelve segmentos para render. */
function linkify(content: string): Array<{ type: 'text' | 'link'; value: string }> {
  const segments: Array<{ type: 'text' | 'link'; value: string }> = []
  const re = /(https?:\/\/[^\s]+)/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: 'text', value: content.slice(lastIndex, m.index) })
    }
    segments.push({ type: 'link', value: m[1] })
    lastIndex = re.lastIndex
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', value: content.slice(lastIndex) })
  }
  return segments
}

function renderContent(content: string): React.ReactNode {
  return linkify(content).map((seg, i) =>
    seg.type === 'link' ? (
      <a
        key={i}
        href={seg.value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-400 underline break-all"
      >
        {seg.value}
      </a>
    ) : (
      <span key={i}>{seg.value}</span>
    ),
  )
}

function ChannelSidebar({
  channels,
  activeChannelId,
  onSelect,
  onCreate,
  presenceCount,
}: {
  channels: SerializedChatChannel[]
  activeChannelId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  presenceCount: number
}) {
  return (
    <aside
      data-testid="chat-channel-sidebar"
      className="w-60 shrink-0 border-r border-border bg-card flex flex-col"
    >
      <div className="px-3 py-3 border-b border-border flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
          Canales
        </h2>
        <button
          type="button"
          data-testid="chat-channel-new"
          onClick={onCreate}
          className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
          aria-label="Crear canal"
          title="Crear canal"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {channels.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-3">
            No hay canales todavía
          </p>
        ) : (
          <ul className="space-y-0.5">
            {channels.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  data-testid={`chat-channel-item-${c.name}`}
                  className={clsx(
                    'w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm rounded-none transition-colors',
                    activeChannelId === c.id
                      ? 'bg-indigo-600/10 text-indigo-300 border-l-2 border-indigo-500'
                      : 'text-foreground/80 hover:bg-accent border-l-2 border-transparent',
                  )}
                >
                  <Hash className="h-3.5 w-3.5 opacity-70" aria-hidden />
                  <span className="truncate">{c.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <footer className="px-3 py-2 border-t border-border text-[11px] text-muted-foreground flex items-center gap-1">
        <Users className="h-3 w-3" aria-hidden />
        <span data-testid="chat-presence-count">
          {presenceCount === 1
            ? '1 persona conectada'
            : `${presenceCount} personas conectadas`}
        </span>
      </footer>
    </aside>
  )
}

function ReactionPill({
  emoji,
  count,
  active,
  onClick,
}: {
  emoji: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px]',
        active
          ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
          : 'border-border bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{emoji}</span>
      <span>{count}</span>
    </button>
  )
}

function MessageItem({
  message,
  currentUserId,
  parent,
  onReply,
  onReactToggle,
  onEdit,
  onDelete,
}: {
  message: SerializedChatMessage
  currentUserId: string | null
  parent: SerializedChatMessage | undefined
  onReply: (m: SerializedChatMessage) => void
  onReactToggle: (messageId: string, emoji: string) => void
  onEdit: (m: SerializedChatMessage) => void
  onDelete: (m: SerializedChatMessage) => void
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const isAuthor = currentUserId && message.author?.id === currentUserId
  const isDeleted = Boolean(message.deletedAt)
  const initial = (message.author?.name ?? '?').charAt(0).toUpperCase()

  return (
    <li
      data-testid="chat-message"
      className="group flex gap-3 py-2 hover:bg-muted/20 -mx-2 px-2 rounded transition-colors"
    >
      <div className="h-8 w-8 shrink-0 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-indigo-300 border border-border">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        {parent && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-0.5">
            <CornerDownRight className="h-3 w-3" aria-hidden />
            <span className="font-medium">{parent.author?.name ?? 'Sistema'}</span>
            <span className="truncate max-w-xs italic">{parent.content}</span>
          </div>
        )}
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground truncate">
            {message.author?.name ?? 'Sistema'}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatRelative(message.createdAt)}
          </span>
          {message.editedAt && !isDeleted && (
            <span className="text-[10px] text-muted-foreground italic">
              (editado)
            </span>
          )}
        </div>
        <p
          className={clsx(
            'text-sm leading-relaxed mt-0.5 whitespace-pre-wrap break-words',
            isDeleted
              ? 'italic text-muted-foreground'
              : 'text-foreground/90',
          )}
        >
          {isDeleted ? 'Mensaje eliminado' : renderContent(message.content)}
        </p>

        {!isDeleted && message.reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {message.reactions.map((r) => (
              <ReactionPill
                key={r.emoji}
                emoji={r.emoji}
                count={r.userIds.length}
                active={Boolean(
                  currentUserId && r.userIds.includes(currentUserId),
                )}
                onClick={() => onReactToggle(message.id, r.emoji)}
              />
            ))}
          </div>
        )}

        {!isDeleted && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <button
              type="button"
              data-testid="chat-message-reply"
              onClick={() => onReply(message)}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <ReplyIcon className="h-3 w-3" aria-hidden /> Responder
            </button>
            <div className="relative">
              <button
                type="button"
                data-testid="chat-message-react"
                onClick={() => setShowEmojiPicker((v) => !v)}
                className="inline-flex items-center gap-1 hover:text-foreground"
                aria-haspopup="menu"
                aria-expanded={showEmojiPicker}
              >
                Reaccionar
              </button>
              {showEmojiPicker && (
                <div
                  role="menu"
                  className="absolute bottom-full left-0 mb-2 z-10 rounded-md border border-border bg-card shadow-lg p-1 flex flex-wrap gap-1 w-40"
                >
                  {ALLOWED_REACTION_EMOJIS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => {
                        onReactToggle(message.id, e)
                        setShowEmojiPicker(false)
                      }}
                      className="text-base p-1 rounded hover:bg-accent"
                      aria-label={`Reaccionar ${e}`}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isAuthor && (
              <>
                <button
                  type="button"
                  data-testid="chat-message-edit"
                  onClick={() => onEdit(message)}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" aria-hidden /> Editar
                </button>
                <button
                  type="button"
                  data-testid="chat-message-delete"
                  onClick={() => onDelete(message)}
                  className="inline-flex items-center gap-1 hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" aria-hidden /> Eliminar
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

export function ChatClient({
  projectId,
  projectName,
  initialChannels,
  currentUser,
  mentionableUsers,
}: ChatClientProps) {
  const [channels, setChannels] = useState<SerializedChatChannel[]>(initialChannels)
  const [activeChannelId, setActiveChannelId] = useState<string | null>(
    initialChannels[0]?.id ?? null,
  )
  const [creating, setCreating] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [newChannelError, setNewChannelError] = useState<string | null>(null)
  const [replyTo, setReplyTo] = useState<SerializedChatMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SerializedChatMessage[] | null>(null)

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  )

  const {
    messages,
    isLoading,
    error,
    sendMessage,
    toggleReaction,
    editMessage,
    deleteMessage,
  } = useChatChannel(activeChannelId, currentUser)

  // Presence por canal — el topic incluye el channelId para que cambiar
  // de canal reinicie la membresía. Construimos la identity mínima a
  // partir del currentUser básico (id + name).
  const presenceTopic = activeChannelId
    ? `chat:${activeChannelId}:presence`
    : `chat:${projectId}:idle`
  const presenceIdentity: PresenceIdentity | null = currentUser
    ? { userId: currentUser.id, name: currentUser.name }
    : null
  const { users: onlineUsers } = usePresence(presenceTopic, presenceIdentity)

  const listRef = useRef<HTMLUListElement | null>(null)
  const lastCountRef = useRef<number>(0)
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (messages.length > lastCountRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
    lastCountRef.current = messages.length
  }, [messages.length])

  const onCreateChannel = useCallback(async () => {
    const name = newChannelName.trim().toLowerCase()
    if (!name) return
    setNewChannelError(null)
    try {
      const created = await createChannel({
        projectId,
        name,
        kind: 'TOPIC',
      })
      const fresh: SerializedChatChannel = {
        id: created.id,
        projectId: created.projectId,
        name: created.name,
        kind: created.kind,
        description: created.description ?? null,
        lastMessageAt: created.lastMessageAt
          ? new Date(created.lastMessageAt).toISOString()
          : null,
        createdAt: new Date(created.createdAt).toISOString(),
      }
      setChannels((prev) => [...prev, fresh])
      setActiveChannelId(fresh.id)
      setNewChannelName('')
      setCreating(false)
    } catch (e) {
      setNewChannelError(
        e instanceof Error ? e.message : 'Error al crear canal',
      )
    }
  }, [newChannelName, projectId])

  const onSubmitMessage = useCallback(
    async (content: string) => {
      await sendMessage(content, {
        parentMessageId: replyTo?.id ?? null,
      })
      setReplyTo(null)
    },
    [sendMessage, replyTo],
  )

  const onEditMessage = useCallback(
    (m: SerializedChatMessage) => {
      const next = window.prompt('Editar mensaje', m.content)
      if (next === null) return
      const trimmed = next.trim()
      if (!trimmed || trimmed === m.content) return
      void editMessage(m.id, trimmed)
    },
    [editMessage],
  )

  const onDeleteMessage = useCallback(
    (m: SerializedChatMessage) => {
      if (!window.confirm('¿Eliminar este mensaje?')) return
      void deleteMessage(m.id)
    },
    [deleteMessage],
  )

  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim()
      if (trimmed.length < 2) {
        setSearchResults(null)
        return
      }
      try {
        const rows = await searchMessages({
          projectId,
          query: trimmed,
        })
        setSearchResults(rows)
      } catch {
        setSearchResults([])
      }
    },
    [projectId],
  )

  const messagesById = useMemo(() => {
    const map = new Map<string, SerializedChatMessage>()
    for (const m of messages) map.set(m.id, m)
    return map
  }, [messages])

  return (
    <div
      data-testid="chat-client"
      className="flex h-[calc(100vh-4rem)] w-full overflow-hidden bg-background"
    >
      <ChannelSidebar
        channels={channels}
        activeChannelId={activeChannelId}
        onSelect={(id) => {
          setActiveChannelId(id)
          setReplyTo(null)
          setSearchResults(null)
        }}
        onCreate={() => setCreating(true)}
        presenceCount={Math.max(onlineUsers.length, currentUser ? 1 : 0)}
      />

      <section className="flex-1 min-w-0 flex flex-col">
        <header className="border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Hash className="h-3.5 w-3.5 opacity-70" aria-hidden />
              {activeChannel?.name ?? 'sin canal'}
            </h1>
            <p className="text-[11px] text-muted-foreground truncate">
              Chat · {projectName}
              {activeChannel?.description ? ` · ${activeChannel.description}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <input
              data-testid="chat-search-input"
              type="search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                void runSearch(e.target.value)
              }}
              placeholder="Buscar en este proyecto…"
              className="bg-background border border-border rounded px-2 py-1 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </header>

        {creating && (
          <div
            data-testid="chat-create-channel-form"
            className="border-b border-border px-4 py-3 bg-muted/20 flex items-center gap-2"
          >
            <span className="text-xs text-muted-foreground">Nuevo canal:</span>
            <input
              type="text"
              autoFocus
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder="ej. dev, qa, release-2026"
              className="flex-1 bg-background border border-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void onCreateChannel()
                }
                if (e.key === 'Escape') {
                  setCreating(false)
                  setNewChannelName('')
                }
              }}
            />
            <button
              type="button"
              onClick={() => void onCreateChannel()}
              className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-500"
            >
              Crear
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false)
                setNewChannelName('')
              }}
              className="text-xs px-2 py-1 text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            {newChannelError && (
              <span role="alert" className="text-xs text-destructive">
                {newChannelError}
              </span>
            )}
          </div>
        )}

        {searchResults !== null ? (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Resultados de búsqueda ({searchResults.length})
            </h2>
            {searchResults.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Sin coincidencias
              </p>
            ) : (
              <ul className="space-y-2">
                {searchResults.map((m) => (
                  <li
                    key={m.id}
                    data-testid="chat-search-result"
                    className="border border-border rounded px-3 py-2"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {m.author?.name ?? 'Sistema'}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelative(m.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
                      {renderContent(m.content)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-hidden px-4 py-3 flex flex-col">
              {error && (
                <div
                  role="alert"
                  className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 mb-2"
                >
                  {error}
                </div>
              )}
              {isLoading ? (
                <p className="text-xs text-muted-foreground italic py-8 text-center">
                  Cargando mensajes…
                </p>
              ) : messages.length === 0 ? (
                <p
                  data-testid="chat-empty"
                  className="text-xs text-muted-foreground italic py-8 text-center"
                >
                  Sé el primero en escribir en este canal.
                </p>
              ) : (
                <ul
                  ref={listRef}
                  data-testid="chat-messages-list"
                  className="flex-1 overflow-y-auto pr-1"
                >
                  {messages.map((m) => (
                    <MessageItem
                      key={m.id}
                      message={m}
                      currentUserId={currentUser?.id ?? null}
                      parent={
                        m.parentMessageId
                          ? messagesById.get(m.parentMessageId)
                          : undefined
                      }
                      onReply={(parent) => setReplyTo(parent)}
                      onReactToggle={(id, emoji) => {
                        void toggleReaction(id, emoji)
                      }}
                      onEdit={onEditMessage}
                      onDelete={onDeleteMessage}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div className="px-4 pb-3">
              <ChatComposer
                disabled={!activeChannelId || !currentUser}
                placeholder={
                  currentUser
                    ? `Escribir en #${activeChannel?.name ?? 'canal'}`
                    : 'Inicia sesión para participar'
                }
                mentionableUsers={mentionableUsers}
                replyingTo={
                  replyTo
                    ? {
                        id: replyTo.id,
                        authorName: replyTo.author?.name ?? null,
                        preview:
                          replyTo.content.length > 80
                            ? `${replyTo.content.slice(0, 77)}…`
                            : replyTo.content,
                      }
                    : null
                }
                onCancelReply={() => setReplyTo(null)}
                onSubmit={onSubmitMessage}
              />
            </div>
          </>
        )}
      </section>
    </div>
  )
}
