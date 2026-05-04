'use client'

/**
 * Ola P2 · Equipo P2-4 — Componente cliente que orquesta el dashboard
 * de Goals: filtros (cycle / project), creación, edición, expansión de
 * KRs y dialog de vinculación de tareas.
 *
 * Recibe los datos pre-cargados por la page server-rendered y maneja
 * el estado de UI: ciclo seleccionado (sincronizado con URL via
 * useRouter.replace para preservar deep-links), forms abiertos.
 */

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Filter } from 'lucide-react'
import type { SerializedGoal } from '@/lib/actions/goals'
import { GoalCard } from './GoalCard'
import { GoalForm } from './GoalForm'
import { KeyResultForm } from './KeyResultForm'
import { CycleSelector } from './CycleSelector'
import { LinkTaskToKRDialog, type TaskOption } from './LinkTaskToKRDialog'

type Props = {
  goals: SerializedGoal[]
  users: Array<{ id: string; name: string }>
  projects: Array<{ id: string; name: string }>
  tasks: TaskOption[]
  cycle: string
  projectId: string | null
}

export function GoalsBoard({
  goals,
  users,
  projects,
  tasks,
  cycle,
  projectId,
}: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [pending, start] = useTransition()
  const [creating, setCreating] = useState(false)
  const [krFormFor, setKrFormFor] = useState<string | null>(null)
  const [linkDialogFor, setLinkDialogFor] = useState<string | null>(null)

  const parentCandidates = useMemo(
    () =>
      goals.map((g) => ({ id: g.id, title: g.title, cycle: g.cycle })),
    [goals],
  )

  function setQuery(next: { cycle?: string; projectId?: string | null }) {
    const params = new URLSearchParams(sp?.toString() ?? '')
    if (next.cycle !== undefined) params.set('cycle', next.cycle)
    if (next.projectId !== undefined) {
      if (next.projectId === null) params.delete('projectId')
      else params.set('projectId', next.projectId)
    }
    start(() => {
      router.replace(`/goals?${params.toString()}`)
    })
  }

  return (
    <div className="space-y-4" data-testid="goals-board">
      <header className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <CycleSelector
            value={cycle}
            onChange={(c) => setQuery({ cycle: c })}
          />
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Proyecto</span>
            <select
              value={projectId ?? ''}
              onChange={(e) => setQuery({ projectId: e.target.value || null })}
              className="rounded border border-border bg-background px-2 py-1 text-sm"
            >
              <option value="">— Todos —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {pending && (
            <span className="text-[11px] text-muted-foreground">Cargando…</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          data-testid="goals-new-btn"
        >
          <Plus className="h-3 w-3" />
          Nuevo objetivo
        </button>
      </header>

      {creating && (
        <GoalForm
          users={users}
          projects={projects}
          parentCandidates={parentCandidates}
          defaultCycle={cycle}
          onSaved={() => {
            setCreating(false)
            router.refresh()
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {goals.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-border bg-card/30 px-6 py-10 text-center text-sm text-muted-foreground"
          data-testid="goals-empty"
        >
          <Filter className="mx-auto mb-2 h-5 w-5" aria-hidden />
          No hay objetivos para el ciclo {cycle}
          {projectId ? ' en este proyecto' : ''}.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {goals.map((g) => (
            <li key={g.id}>
              <GoalCard
                goal={g}
                onLinkTaskRequest={(krId) => setLinkDialogFor(krId)}
              />
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => setKrFormFor((prev) => (prev === g.id ? null : g.id))}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                  data-testid="goal-add-kr-btn"
                >
                  {krFormFor === g.id ? '× Cancelar' : '+ Añadir resultado clave'}
                </button>
              </div>
              {krFormFor === g.id && (
                <div className="mt-2">
                  <KeyResultForm
                    goalId={g.id}
                    onSaved={() => {
                      setKrFormFor(null)
                      router.refresh()
                    }}
                    onCancel={() => setKrFormFor(null)}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {linkDialogFor && (
        <LinkTaskToKRDialog
          krId={linkDialogFor}
          open={!!linkDialogFor}
          tasks={tasks}
          onClose={() => setLinkDialogFor(null)}
          onLinked={() => {
            setLinkDialogFor(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
