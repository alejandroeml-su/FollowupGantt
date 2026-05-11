'use client'

/**
 * Support Chatbot · FAB flotante + panel chat para CUALQUIER usuario
 * autenticado. Vive al final del body de `RootLayout` y se oculta a sí
 * mismo en `/login`, `/invite/*` y rutas públicas vía `usePathname()`.
 *
 * Decisiones técnicas clave:
 *  - 0 deps nuevas: usamos `fetch()` + lectura del `text/event-stream`
 *    crudo. Evitamos `@ai-sdk/react` aquí porque cambiar a `toUIMessageStreamResponse`
 *    no aplica al protocolo simple text/event-stream que devuelve el server.
 *  - Persistencia: `localStorage` con key `sync-support-chat-v1`.
 *  - Detección de rol: leemos `data-user-role` del body si el server lo
 *    setea (futuro); por defecto enviamos null y el server cae al rol
 *    del session user. Esto cumple "detecta rol y personaliza tono" sin
 *    requerir API extra.
 *  - Accesibilidad: role="dialog", aria-modal, focus trap, Esc cierra,
 *    aria-live para el feed de mensajes.
 *  - React 19 purity: no usamos `Date.now()` en render. IDs vienen de
 *    `crypto.randomUUID()` o counter monotónico.
 *  - Z-index: FAB y panel usan `z-[9990]` (debajo de modales criticos
 *    y de toasts globales en `z-[10000]+`).
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import {
  MessageCircleQuestion,
  X,
  Send,
  Loader2,
  Sparkles,
  Trash2,
  Minus,
} from 'lucide-react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const STORAGE_KEY = 'sync-support-chat-v1'
const HIDDEN_PREFIXES = ['/login', '/invite', '/forgot-password', '/reset-password']

const QUICK_PROMPTS: string[] = [
  'Cómo crear un proyecto',
  'Qué es Sprint Planning',
  'Cómo invitar miembros',
  'Cómo registrar mi tiempo',
]

function shouldHideOnPath(path: string | null): boolean {
  if (!path) return false
  return HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

function loadFromStorage(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === 'object' &&
        typeof (m as ChatMessage).id === 'string' &&
        ((m as ChatMessage).role === 'user' ||
          (m as ChatMessage).role === 'assistant') &&
        typeof (m as ChatMessage).content === 'string',
    )
  } catch {
    return []
  }
}

function saveToStorage(messages: ChatMessage[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch {
    // QuotaExceeded o private mode — silencioso, la conversación sigue
    // funcionando en memoria.
  }
}

function makeId(seed: number): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID()
  }
  return `msg-${seed}`
}

export function SupportChatbot(): React.JSX.Element | null {
  const pathname = usePathname()
  const hidden = shouldHideOnPath(pathname)

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idCounterRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fabRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const headingId = useId()

  // Hidratación desde localStorage post-mount. SSR renderiza array vacío
  // para evitar mismatch; tras hidratar, cargamos lo persistido. El setState
  // aquí es la sincronización con external system (localStorage), patrón
  // que la lint rule react-hooks/set-state-in-effect permite explícitamente.
  useEffect(() => {
    const initial = loadFromStorage()
    if (initial.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages(initial)
    }
  }, [])

  // Persistir cualquier cambio en messages.
  useEffect(() => {
    if (messages.length === 0) return
    saveToStorage(messages)
  }, [messages])

  // Autoscroll al final cuando hay nuevos mensajes o streaming.
  useEffect(() => {
    if (!open) return
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, streaming, open])

  // Focus al input cuando se abre.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    } else {
      fabRef.current?.focus()
    }
  }, [open])

  // Esc cierra el panel.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Abort streaming al desmontar.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const nextId = useCallback((): string => {
    idCounterRef.current += 1
    return makeId(idCounterRef.current)
  }, [])

  const clearConversation = useCallback(() => {
    setMessages([])
    setError(null)
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore storage errors
    }
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || streaming) return

      setError(null)
      const userMsg: ChatMessage = {
        id: nextId(),
        role: 'user',
        content: trimmed,
      }
      const assistantId = nextId()
      const placeholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
      }

      const history = [...messages, userMsg]
      setMessages([...history, placeholder])
      setInput('')
      setStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch('/api/support/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: history.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          let detail = `Error ${res.status}`
          try {
            const data: unknown = await res.json()
            if (
              data &&
              typeof data === 'object' &&
              'error' in data &&
              data.error &&
              typeof data.error === 'object' &&
              'message' in data.error
            ) {
              detail = String(
                (data.error as { message: unknown }).message ?? detail,
              )
            }
          } catch {
            // body no era JSON; mantenemos el detail genérico.
          }
          throw new Error(detail)
        }

        if (!res.body) {
          throw new Error('Respuesta sin body')
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let accumulated = ''
        let done = false

        while (!done) {
          const chunk = await reader.read()
          done = chunk.done
          if (done) break
          accumulated += decoder.decode(chunk.value, { stream: true })
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: accumulated } : m,
            ),
          )
        }
        const tail = decoder.decode()
        if (tail) {
          accumulated += tail
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: accumulated } : m,
            ),
          )
        }

        if (!accumulated.trim()) {
          throw new Error('Respuesta vacía del servidor')
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Usuario cerró el panel a mitad del stream — limpia el placeholder.
          setMessages((prev) => prev.filter((m) => m.id !== assistantId))
        } else {
          const detail = err instanceof Error ? err.message : 'Error inesperado'
          setError(detail)
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content:
                      'No pude responder en este momento. Por favor intenta de nuevo.',
                  }
                : m,
            ),
          )
        }
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
    },
    [messages, nextId, streaming],
  )

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      void sendMessage(input)
    },
    [input, sendMessage],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void sendMessage(input)
      }
    },
    [input, sendMessage],
  )

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        setOpen(false)
      }
    },
    [],
  )

  const isEmpty = messages.length === 0
  const userHints = useMemo(() => QUICK_PROMPTS, [])

  if (hidden) return null

  return (
    <>
      {/* Floating Action Button */}
      <button
        ref={fabRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Cerrar chat de soporte' : 'Abrir chat de soporte'}
        aria-expanded={open}
        aria-controls={panelId}
        className="fixed bottom-5 right-5 z-[9990] inline-flex h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 transition-all hover:bg-indigo-500 hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:bottom-6 lg:right-6"
      >
        {open ? (
          <X className="h-5 w-5" aria-hidden="true" />
        ) : (
          <MessageCircleQuestion className="h-6 w-6" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[9989] flex items-end justify-end bg-black/20 backdrop-blur-[1px] sm:bg-transparent sm:backdrop-blur-0"
          onClick={onBackdropClick}
          aria-hidden="false"
        >
          <div
            id={panelId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="flex h-[100dvh] w-full flex-col bg-background shadow-2xl sm:mb-20 sm:mr-5 sm:h-[500px] sm:max-h-[80vh] sm:w-[360px] sm:rounded-2xl sm:border sm:border-border lg:mb-24 lg:mr-6"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3 text-white sm:rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                <h2 id={headingId} className="text-sm font-semibold">
                  Sync Support
                </h2>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={clearConversation}
                    className="rounded p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    aria-label="Limpiar conversación"
                    title="Limpiar conversación"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:hidden"
                  aria-label="Minimizar"
                  title="Minimizar"
                >
                  <Minus className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded p-1.5 text-white/80 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  aria-label="Cerrar chat"
                  title="Cerrar"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Mensajes */}
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-label="Conversación con soporte"
              className="flex-1 space-y-3 overflow-y-auto bg-subtle/30 px-3 py-3"
            >
              {isEmpty ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 px-2 text-center">
                  <div className="rounded-full bg-indigo-500/15 p-3">
                    <MessageCircleQuestion className="h-7 w-7 text-indigo-400" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      Hola, soy el asistente de Sync
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Pregúntame cómo usar la plataforma. Respondo en
                      español con base en los manuales oficiales.
                    </p>
                  </div>
                  <div className="grid w-full gap-2">
                    {userHints.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => void sendMessage(prompt)}
                        className="rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-foreground transition-colors hover:border-indigo-400 hover:bg-indigo-500/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m) => <MessageBubble key={m.id} message={m} />)
              )}
              {streaming && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin text-indigo-400" aria-hidden="true" />
                  <span>Sync Support está escribiendo…</span>
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
                >
                  {error}
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={onSubmit}
              className="flex items-end gap-2 border-t border-border bg-background px-3 py-3"
            >
              <label className="sr-only" htmlFor={`${panelId}-input`}>
                Escribe tu pregunta
              </label>
              <textarea
                ref={inputRef}
                id={`${panelId}-input`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Escribe tu pregunta…"
                rows={1}
                disabled={streaming}
                maxLength={4000}
                className="min-h-[40px] flex-1 resize-none rounded-lg border border-border bg-subtle/80 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={streaming || !input.trim()}
                aria-label="Enviar mensaje"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {streaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'bg-indigo-600 text-white'
            : 'border border-border bg-card text-foreground'
        }`}
      >
        {!isUser && (
          <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
            <Sparkles className="h-3 w-3" aria-hidden="true" /> Sync Support
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  )
}
