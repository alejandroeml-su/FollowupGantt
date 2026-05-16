'use client'

/**
 * R4 · US-7.2 Chat View — Composer del chat por proyecto.
 *
 * Aislado del cliente principal para poder testearlo en jsdom sin
 * arrastrar las dependencias Realtime (`useChatChannel`).
 *
 * Características:
 *   - Textarea de altura controlada, envío con Enter (Shift+Enter = nueva línea).
 *   - Soporta mentions vía `<MentionTextarea>` si se proveen `mentionableUsers`.
 *   - Picker compacto de emojis (set canónico `ALLOWED_REACTION_EMOJIS`).
 *   - Pintamos un "Replying to …" cuando hay `parentMessage` activo.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Send, Smile, X } from 'lucide-react'
import { ALLOWED_REACTION_EMOJIS } from '@/lib/actions/chat'
import {
  MentionTextarea,
  type MentionUser,
} from '@/components/mentions/MentionTextarea'

export type ChatComposerProps = {
  disabled?: boolean
  placeholder?: string
  mentionableUsers?: MentionUser[]
  /** Mensaje al que se está respondiendo (parent del thread). */
  replyingTo?: {
    id: string
    authorName: string | null
    preview: string
  } | null
  onCancelReply?: () => void
  onSubmit: (content: string) => Promise<void> | void
  /** Activado cuando el usuario escribe — útil para typing indicator. */
  onTyping?: (active: boolean) => void
}

export function ChatComposer({
  disabled = false,
  placeholder = 'Escribe un mensaje… Enter para enviar · Shift+Enter para nueva línea',
  mentionableUsers,
  replyingTo,
  onCancelReply,
  onSubmit,
  onTyping,
}: ChatComposerProps) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Cuando aparece un parent (replyingTo) damos foco al textarea para que
  // el usuario pueda escribir la respuesta sin un click extra.
  useEffect(() => {
    if (replyingTo) {
      textareaRef.current?.focus()
    }
  }, [replyingTo])

  const submit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || submitting || disabled) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      setValue('')
      onTyping?.(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al enviar')
    } finally {
      setSubmitting(false)
    }
  }, [value, submitting, disabled, onSubmit, onTyping])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void submit()
      }
    },
    [submit],
  )

  const insertEmoji = useCallback(
    (emoji: string) => {
      setValue((v) => (v.endsWith(' ') || v.length === 0 ? `${v}${emoji} ` : `${v} ${emoji} `))
      setEmojiOpen(false)
      textareaRef.current?.focus()
    },
    [],
  )

  return (
    <form
      data-testid="chat-composer"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="flex flex-col gap-2 border-t border-border pt-3"
    >
      {replyingTo && (
        <div
          data-testid="chat-composer-reply"
          className="flex items-center justify-between bg-muted/40 border-l-2 border-indigo-500 rounded px-2 py-1 text-xs"
        >
          <div className="min-w-0 flex-1 truncate">
            <span className="font-medium text-foreground">
              {replyingTo.authorName ?? 'Sistema'}
            </span>
            <span className="text-muted-foreground ml-2 truncate">
              {replyingTo.preview}
            </span>
          </div>
          {onCancelReply && (
            <button
              type="button"
              data-testid="chat-composer-cancel-reply"
              onClick={onCancelReply}
              className="ml-2 p-0.5 text-muted-foreground hover:text-foreground rounded"
              aria-label="Cancelar respuesta"
            >
              <X className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
      )}

      {mentionableUsers && mentionableUsers.length > 0 ? (
        <MentionTextarea
          data-testid="chat-composer-textarea"
          ref={textareaRef as React.Ref<HTMLTextAreaElement>}
          value={value}
          onChange={(next) => {
            setValue(next)
            onTyping?.(next.trim().length > 0)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => onTyping?.(false)}
          users={mentionableUsers}
          placeholder={placeholder}
          disabled={disabled || submitting}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none h-20 disabled:opacity-50"
          rows={3}
        />
      ) : (
        <textarea
          ref={textareaRef}
          data-testid="chat-composer-textarea"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            onTyping?.(e.target.value.trim().length > 0)
          }}
          onKeyDown={onKeyDown}
          onBlur={() => onTyping?.(false)}
          placeholder={placeholder}
          disabled={disabled || submitting}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none h-20 disabled:opacity-50"
          rows={3}
        />
      )}

      {error && (
        <span
          role="alert"
          data-testid="chat-composer-error"
          className="text-[11px] text-destructive"
        >
          {error}
        </span>
      )}

      <div className="flex items-center justify-between">
        <div className="relative">
          <button
            type="button"
            data-testid="chat-composer-emoji-toggle"
            onClick={() => setEmojiOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            disabled={disabled}
            aria-haspopup="menu"
            aria-expanded={emojiOpen}
          >
            <Smile className="h-3.5 w-3.5" aria-hidden />
            Emoji
          </button>
          {emojiOpen && (
            <div
              role="menu"
              data-testid="chat-composer-emoji-picker"
              className="absolute bottom-full left-0 mb-2 z-10 rounded-md border border-border bg-card shadow-lg p-1 flex flex-wrap gap-1 w-40"
            >
              {ALLOWED_REACTION_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => insertEmoji(e)}
                  className="text-base p-1 rounded hover:bg-accent"
                  aria-label={`Insertar ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="submit"
          data-testid="chat-composer-submit"
          disabled={submitting || disabled || !value.trim()}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-sm font-bold transition-all"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          Enviar
        </button>
      </div>
    </form>
  )
}
