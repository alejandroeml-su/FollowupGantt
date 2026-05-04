'use client'

/**
 * Wave P6 · Equipo A3 — Lista de comentarios + composer con realtime.
 *
 * Composición:
 *   - `useTaskComments(taskId, currentUser)` para fetch inicial +
 *     postgres_changes.
 *   - `useTypingIndicator(channel, currentUser)` para typing efímero
 *     (broadcast).
 *   - Auto-scroll al fondo cuando llega un comment nuevo (smooth) usando
 *     `ref` directo sobre el contenedor scrollable. NO usamos
 *     `useEffect → setState` para sincronizar el scroll (regla
 *     react-hooks/set-state-in-effect): manipulamos `el.scrollTop` que es
 *     side-effect imperativo permitido.
 *   - Composer: textarea + botón "Enviar". `onChange` triggers
 *     `setTyping(true)`; al enviar, `addComment` + clear + `setTyping(false)`.
 *
 * Markdown simple: bold (`**txt**`), italic (`*txt*`), links (`[txt](url)`).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import { useTaskComments } from '@/lib/realtime-comments/use-task-comments'
import { useTypingIndicator } from '@/lib/realtime-comments/use-typing-indicator'
import type { SerializedComment } from '@/lib/types'
import { TypingIndicator } from './TypingIndicator'

type Props = {
  taskId: string
  currentUser: { id: string; name: string } | null
}

/** Formatea un timestamp ISO como tiempo relativo en español. */
export function formatRelative(iso: string, now: Date = new Date()): string {
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

type Token =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'link'; value: string; href: string }

/** Markdown simple → tokens (bold, italic, links). */
export function parseSimpleMarkdown(input: string): Token[] {
  const tokens: Token[] = []
  // Regex global: orden importa. Bold antes que italic.
  const re =
    /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ type: 'text', value: input.slice(lastIndex, m.index) })
    }
    if (m[1]) {
      tokens.push({ type: 'link', value: m[2], href: m[3] })
    } else if (m[4]) {
      tokens.push({ type: 'bold', value: m[5] })
    } else if (m[6]) {
      tokens.push({ type: 'italic', value: m[7] })
    }
    lastIndex = re.lastIndex
  }
  if (lastIndex < input.length) {
    tokens.push({ type: 'text', value: input.slice(lastIndex) })
  }
  return tokens
}

function renderTokens(tokens: Token[]): React.ReactNode {
  return tokens.map((t, i) => {
    if (t.type === 'bold') return <strong key={i}>{t.value}</strong>
    if (t.type === 'italic') return <em key={i}>{t.value}</em>
    if (t.type === 'link') {
      // Sanitización mínima: sólo http(s):// y rutas internas.
      const safe = /^https?:\/\//i.test(t.href) || t.href.startsWith('/')
      if (!safe) return <span key={i}>{t.value}</span>
      return (
        <a
          key={i}
          href={t.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 underline"
        >
          {t.value}
        </a>
      )
    }
    return <span key={i}>{t.value}</span>
  })
}

function CommentItem({ comment }: { comment: SerializedComment }) {
  const initial = (comment.author?.name || '?').charAt(0).toUpperCase()
  return (
    <li
      data-testid="comment-item"
      className="flex gap-3 py-3 border-b border-border last:border-b-0"
    >
      <div className="h-8 w-8 shrink-0 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-indigo-400 border border-border">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground truncate">
            {comment.author?.name || 'Sistema'}
          </span>
          <span
            data-testid="comment-time"
            className="text-[11px] text-muted-foreground"
          >
            {formatRelative(comment.createdAt)}
          </span>
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed mt-0.5 whitespace-pre-wrap break-words">
          {renderTokens(parseSimpleMarkdown(comment.content))}
        </p>
      </div>
    </li>
  )
}

export function TaskCommentsRealtime({ taskId, currentUser }: Props) {
  const { comments, isLoading, error, addComment } = useTaskComments(
    taskId,
    currentUser,
  )
  const { typingUsers, setTyping } = useTypingIndicator(
    `task:${taskId}:comments`,
    currentUser,
  )

  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const listRef = useRef<HTMLUListElement | null>(null)
  const lastCountRef = useRef<number>(0)

  // Auto-scroll al fondo cuando crece la lista (sin setState desde effect).
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (comments.length > lastCountRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
    lastCountRef.current = comments.length
  }, [comments.length])

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value
      setDraft(value)
      // Sólo emitimos typing si efectivamente hay texto.
      if (value.trim().length > 0) {
        setTyping(true)
      } else {
        setTyping(false)
      }
    },
    [setTyping],
  )

  const onSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault()
      const text = draft.trim()
      if (!text || submitting) return
      setSubmitting(true)
      setSubmitError(null)
      try {
        await addComment(text)
        setDraft('')
        setTyping(false)
      } catch (err) {
        setSubmitError(
          err instanceof Error ? err.message : 'Error al enviar comentario',
        )
      } finally {
        setSubmitting(false)
      }
    },
    [draft, submitting, addComment, setTyping],
  )

  return (
    <section
      data-testid="task-comments-realtime"
      className="flex flex-col gap-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Comentarios
        </h3>
        {!isLoading && (
          <span className="text-[11px] text-muted-foreground">
            {comments.length}{' '}
            {comments.length === 1 ? 'comentario' : 'comentarios'}
          </span>
        )}
      </header>

      {error && (
        <div
          data-testid="comments-error"
          role="alert"
          className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2"
        >
          {error}
        </div>
      )}

      {isLoading ? (
        <div
          data-testid="comments-loading"
          className="text-xs text-muted-foreground italic py-6 text-center"
        >
          Cargando comentarios…
        </div>
      ) : comments.length === 0 ? (
        <div
          data-testid="comments-empty"
          className="text-center py-8 border border-dashed border-border rounded-lg"
        >
          <MessageSquare className="h-8 w-8 mx-auto opacity-30 mb-2" />
          <p className="text-xs text-muted-foreground italic">
            Sé el primero en comentar
          </p>
        </div>
      ) : (
        <ul
          ref={listRef}
          data-testid="comments-list"
          className="max-h-80 overflow-y-auto pr-1"
        >
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} />
          ))}
        </ul>
      )}

      <TypingIndicator users={typingUsers} />

      <form
        data-testid="comments-composer"
        onSubmit={onSubmit}
        className="flex flex-col gap-2 border-t border-border pt-3"
      >
        <textarea
          data-testid="comments-textarea"
          value={draft}
          onChange={onChange}
          onBlur={() => setTyping(false)}
          placeholder="Escribe un comentario… Soporta **negrita**, *itálica* y [enlaces](https://…)."
          disabled={submitting || !currentUser}
          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none h-20 disabled:opacity-50"
          rows={3}
        />
        {submitError && (
          <span
            data-testid="comments-submit-error"
            role="alert"
            className="text-[11px] text-destructive"
          >
            {submitError}
          </span>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {currentUser
              ? `Comentando como ${currentUser.name}`
              : 'Inicia sesión para comentar'}
          </span>
          <button
            type="submit"
            data-testid="comments-submit"
            disabled={submitting || !draft.trim() || !currentUser}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-sm font-bold transition-all"
          >
            <Send className="h-3.5 w-3.5" />
            Enviar
          </button>
        </div>
      </form>
    </section>
  )
}
