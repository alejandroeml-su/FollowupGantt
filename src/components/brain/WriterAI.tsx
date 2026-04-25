'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  PenTool,
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Send,
  X,
} from 'lucide-react'
import {
  improveTaskDescription,
  applyImprovedDescription,
  listTasksForWriter,
  type WriterImprovedDescription,
} from '@/lib/brain/writer-actions'

type TaskOption = { id: string; mnemonic: string | null; title: string; project: string | null }

const SAMPLE = 'Hacer la integración con supabase para que se guarden las tareas y se vean en la lista'

export function WriterAI() {
  const [tasks, setTasks] = useState<TaskOption[]>([])
  const [taskId, setTaskId] = useState('')
  const [rawText, setRawText] = useState('')
  const [suggestion, setSuggestion] = useState<WriterImprovedDescription | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [appliedAt, setAppliedAt] = useState<number | null>(null)
  const [isGenerating, startGenerating] = useTransition()
  const [isApplying, startApplying] = useTransition()

  useEffect(() => {
    listTasksForWriter()
      .then(setTasks)
      .catch(() => setTasks([]))
  }, [])

  const generate = () => {
    setError(null)
    setAppliedAt(null)
    if (!rawText.trim()) {
      setError('Escribe el texto a mejorar antes de continuar.')
      return
    }
    startGenerating(async () => {
      try {
        const result = await improveTaskDescription({
          rawText,
          taskId: taskId || undefined,
        })
        setSuggestion(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al generar la sugerencia.')
      }
    })
  }

  const apply = () => {
    if (!suggestion || !taskId) return
    setError(null)
    startApplying(async () => {
      try {
        await applyImprovedDescription({
          taskId,
          title: suggestion.improvedTitle,
          description: formatDescriptionWithAC(suggestion),
        })
        setAppliedAt(Date.now())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al aplicar el cambio.')
      }
    })
  }

  const discard = () => {
    setSuggestion(null)
    setError(null)
    setAppliedAt(null)
  }

  return (
    <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4 mb-6">
        <div className="h-12 w-12 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
          <PenTool className="h-6 w-6 text-amber-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-foreground">Writer AI</h2>
          <p className="text-muted-foreground text-sm">
            Convierte ideas en historias de usuario con título, descripción y criterios de aceptación.
          </p>
        </div>
      </div>

      <div className="flex-1 bg-card border border-border rounded-xl flex flex-col overflow-hidden shadow-lg">
        {/* Inputs */}
        <div className="p-4 border-b border-border bg-background/95 space-y-3">
          <div className="flex items-center gap-3">
            <label htmlFor="writer-task" className="text-xs text-muted-foreground font-medium shrink-0">
              Tarea destino:
            </label>
            <select
              id="writer-task"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-xs text-foreground focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Sin tarea — solo generar sugerencia</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.mnemonic ? `[${t.mnemonic}] ` : ''}
                  {t.title}
                  {t.project ? ` · ${t.project}` : ''}
                </option>
              ))}
            </select>
          </div>

          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={`Texto coloquial. Ej: "${SAMPLE}"`}
            rows={3}
            className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={generate}
              disabled={isGenerating || !rawText.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generando…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Sugerir mejora
                </>
              )}
            </button>
          </div>
        </div>

        {/* Output */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {appliedAt && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-4 py-3 text-sm text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              <span>Cambio aplicado a la tarea correctamente.</span>
            </div>
          )}

          {suggestion ? (
            <SuggestionCard suggestion={suggestion} />
          ) : !error && !isGenerating ? (
            <EmptyState />
          ) : null}
        </div>

        {/* Footer actions */}
        {suggestion && (
          <div className="p-4 border-t border-border bg-background/95 flex justify-end gap-3">
            <button
              type="button"
              onClick={discard}
              disabled={isApplying}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" /> Descartar
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={isApplying || !taskId}
              title={!taskId ? 'Selecciona una tarea destino para aplicar' : undefined}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors shadow-lg shadow-indigo-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isApplying ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Aplicando…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Aplicar a la tarea
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function SuggestionCard({ suggestion }: { suggestion: WriterImprovedDescription }) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center gap-2 text-indigo-400 text-sm font-semibold">
        <Sparkles className="h-4 w-4" /> Sugerencia de Writer AI
      </div>

      <div className="bg-indigo-500/5 p-4 rounded-lg border border-indigo-500/20 space-y-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-indigo-300 font-bold mb-1">Título</p>
          <p className="text-sm font-semibold text-foreground">{suggestion.improvedTitle}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-indigo-300 font-bold mb-1">Descripción</p>
          <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
            {suggestion.improvedDescription}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-indigo-300 font-bold mb-1">
            Criterios de aceptación
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-sm text-foreground/90">
            {suggestion.acceptanceCriteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </div>
      </div>

      <div className="text-xs text-muted-foreground italic flex items-start gap-1.5">
        <span className="text-indigo-400 font-medium">Nota:</span>
        <span>{suggestion.rationale}</span>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <PenTool className="h-10 w-10 mx-auto mb-3 opacity-30" />
      <p className="text-sm">Pega texto coloquial arriba y pulsa <strong>Sugerir mejora</strong>.</p>
      <p className="text-xs mt-2 opacity-70">
        Selecciona una tarea destino si quieres aplicar el resultado directamente.
      </p>
    </div>
  )
}

// Helpers

function formatDescriptionWithAC(s: WriterImprovedDescription): string {
  const ac = s.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
  return `${s.improvedDescription}\n\n## Criterios de aceptación\n\n${ac}`
}
