'use client'

/**
 * Ola P2 · Equipo P2-4 — Sección "Objetivos" del TaskDrawer.
 *
 * Muestra los KRs vinculados a la tarea actual con su Goal padre, ciclo
 * y progreso. Si no hay vínculos, muestra placeholder. La gestión de
 * vínculos se hace desde el dashboard `/goals` (decisión D-OKR-6: el
 * drawer es read-only para mantener el alcance del MVP acotado).
 */

import { useEffect, useState } from 'react'
import { Target, Link2 } from 'lucide-react'
import { getKeyResultsForTask } from '@/lib/actions/goals'

type Linked = Awaited<ReturnType<typeof getKeyResultsForTask>>

export function TaskGoalsSection({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<Linked | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Reset diferido a microtask para cumplir react-hooks/set-state-in-effect
    // (no llamar setState sincrónicamente dentro del cuerpo del efecto).
    queueMicrotask(() => {
      if (cancelled) return
      setError(null)
      setItems(null)
    })
    getKeyResultsForTask(taskId)
      .then((rows) => {
        if (!cancelled) setItems(rows)
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Error desconocido')
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  return (
    <section
      aria-label="Resultados clave vinculados"
      className="space-y-2"
      data-testid="task-goals-section"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Target className="h-3.5 w-3.5 text-primary" aria-hidden />
        Objetivos
      </div>

      {error && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
          {error}
        </p>
      )}

      {items === null && !error && (
        <p className="text-[11px] text-muted-foreground">Cargando…</p>
      )}

      {items !== null && items.length === 0 && (
        <p className="rounded border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          Esta tarea no está vinculada a ningún resultado clave. Vincúlala desde el dashboard de objetivos.
        </p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((kr) => (
            <li
              key={kr.id}
              className="rounded border border-border bg-card/40 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    {kr.title}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    <Link2 className="mr-1 inline h-3 w-3" aria-hidden />
                    {kr.goalTitle}
                    <span className="ml-1 font-mono">{kr.cycle}</span>
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {Math.round(kr.progress)}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
