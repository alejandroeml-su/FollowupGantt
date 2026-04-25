'use client'

import { useEffect, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, type InferUITools, type UIMessage } from 'ai'
import { Sparkles, BrainCircuit, Search, ArrowRight, Loader2, Database, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { brainTools } from '@/lib/brain/tools'

type BrainUITools = InferUITools<typeof brainTools>
type BrainUIMessage = UIMessage<never, Record<string, never>, BrainUITools>

const SUGGESTIONS = [
  '¿Qué proyectos están activos?',
  '¿Qué tareas críticas están atrasadas?',
  'Resumen del proyecto Infraestructura Cloud Avante',
  '¿Qué tareas tiene asignadas Edwin Martinez?',
]

const TOOL_LABELS: Record<string, string> = {
  listProjects: 'listando proyectos',
  getProjectStatus: 'analizando proyecto',
  searchTasks: 'buscando tareas',
  getTaskDetails: 'leyendo tarea',
  getOverdueTasks: 'revisando atrasos',
}

export function KnowledgeChat() {
  const [input, setInput] = useState('')
  const { messages, sendMessage, status, error } = useChat<BrainUIMessage>({
    transport: new DefaultChatTransport({ api: '/api/brain/chat' }),
  })
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages])

  const busy = status === 'streaming' || status === 'submitted'

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    sendMessage({ text: trimmed })
    setInput('')
  }

  const isEmpty = messages.length === 0

  return (
    <div className="flex h-full flex-col gap-6">
      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="text-center space-y-4">
            <div className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.2)]">
              <BrainCircuit className="h-10 w-10 text-indigo-400" />
            </div>
            <h2 className="text-3xl font-bold text-foreground">Pregúntale a Avante Brain</h2>
            <p className="text-muted-foreground max-w-lg text-sm">
              Consulta proyectos, tareas, cronograma y riesgos en lenguaje natural.
              Conectado a la base de datos en tiempo real con Claude Sonnet 4.6.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 justify-center max-w-2xl">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="px-4 py-2 rounded-lg bg-card border border-border text-xs text-muted-foreground hover:border-indigo-500/50 hover:text-foreground transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto space-y-5 pr-1"
          role="log"
          aria-live="polite"
        >
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              <span>Avante Brain está pensando…</span>
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">No se pudo completar la consulta</p>
                <p className="text-xs text-red-300/80 mt-1">{error.message}</p>
              </div>
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
        className="w-full max-w-2xl mx-auto relative shrink-0"
      >
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-indigo-400" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ej: ¿qué tareas críticas están atrasadas?"
          disabled={busy}
          className="w-full rounded-xl border border-indigo-500/30 bg-subtle/80 py-4 pl-12 pr-14 text-sm text-foreground shadow-xl focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-ring backdrop-blur-sm transition-all disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="absolute right-3 top-1/2 -translate-y-1/2 bg-indigo-500 hover:bg-indigo-400 text-white p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={busy ? 'Consultando' : 'Enviar pregunta'}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </button>
      </form>
    </div>
  )
}

function MessageBubble({ message }: { message: BrainUIMessage }) {
  const isUser = message.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-indigo-600 text-white'
            : 'bg-card border border-border text-foreground shadow-sm'
        }`}
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-2 text-[11px] text-indigo-400 font-semibold">
            <Sparkles className="h-3 w-3" /> Avante Brain
          </div>
        )}
        <div className="space-y-2">
          {message.parts.map((part, i) => renderPart(part, `${message.id}-${i}`))}
        </div>
      </div>
    </div>
  )
}

function renderPart(
  part: BrainUIMessage['parts'][number],
  key: string,
): React.ReactNode {
  if (part.type === 'text') {
    return (
      <div key={key} className="text-sm whitespace-pre-wrap leading-relaxed">
        {part.text}
      </div>
    )
  }
  if (typeof part.type === 'string' && part.type.startsWith('tool-')) {
    const toolName = part.type.slice('tool-'.length)
    const label = TOOL_LABELS[toolName] ?? toolName
    // part.state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'
    const state = (part as { state?: string }).state
    const done = state === 'output-available'
    const failed = state === 'output-error'
    return (
      <div
        key={key}
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-500/10 border border-indigo-500/30 px-2 py-1 text-[11px] text-indigo-300 mr-1.5"
      >
        <Database className="h-3 w-3" />
        <span className="font-mono">{label}</span>
        {done ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
        ) : failed ? (
          <AlertTriangle className="h-3 w-3 text-red-400" />
        ) : (
          <Loader2 className="h-3 w-3 animate-spin" />
        )}
      </div>
    )
  }
  return null
}
