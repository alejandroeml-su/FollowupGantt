'use client'

/**
 * Wave P12 (Scrum 100% · HU-12.7) — Improvement Items kanban.
 *
 * Cross-sprint tracking de Retro Action Items. KPI panel de close rate
 * (madurez ágil) + columnas Open/InProgress/Done/Cancelled.
 */

import { useMemo, useState, useTransition } from 'react'
import {
  CalendarClock,
  CheckCheck,
  Lightbulb,
  Plus,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  createImprovement,
  deleteImprovement,
  updateImprovementStatus,
} from '@/lib/actions/improvements'
import type { ImprovementStatus } from '@prisma/client'
import { toast } from '@/components/interactions/Toaster'

type TeamMember = { id: string; name: string }

type Improvement = {
  id: string
  title: string
  description: string | null
  status: ImprovementStatus
  dueDate: Date | string | null
  closedAt: Date | string | null
  closeNotes: string | null
  createdAt: Date | string
  owner: { id: string; name: string } | null
  retrospective: {
    id: string
    title: string
    sprint: { id: string; name: string }
  } | null
}

type Metrics = {
  total: number
  open: number
  inProgress: number
  done: number
  cancelled: number
  overdue: number
  closeRate: number
}

type Props = {
  projectId: string
  projectName: string
  team: TeamMember[]
  items: Improvement[]
  metrics: Metrics
  currentUser: { id: string; name: string } | null
}

const COLUMNS: { key: ImprovementStatus; label: string; classes: string }[] = [
  {
    key: 'OPEN',
    label: 'Abierto',
    classes: 'border-rose-500/30 bg-rose-500/5 text-rose-200',
  },
  {
    key: 'IN_PROGRESS',
    label: 'En curso',
    classes: 'border-amber-500/30 bg-amber-500/5 text-amber-200',
  },
  {
    key: 'DONE',
    label: 'Completado',
    classes: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200',
  },
  {
    key: 'CANCELLED',
    label: 'Cancelado',
    classes: 'border-zinc-500/30 bg-zinc-500/5 text-zinc-300',
  },
]

export function ImprovementsClient({
  projectId,
  projectName,
  team,
  items,
  metrics,
  currentUser,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    ownerId: '',
    dueDate: '',
  })
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const grouped = useMemo(() => {
    const map: Record<ImprovementStatus, Improvement[]> = {
      OPEN: [],
      IN_PROGRESS: [],
      DONE: [],
      CANCELLED: [],
    }
    for (const i of items) map[i.status].push(i)
    return map
  }, [items])

  const handleCreate = () => {
    if (!draft.title.trim()) {
      toast.error('Título requerido')
      return
    }
    startTransition(async () => {
      try {
        await createImprovement({
          projectId,
          title: draft.title,
          description: draft.description,
          ownerId: draft.ownerId || null,
          dueDate: draft.dueDate || null,
          actorId: currentUser?.id,
        })
        toast.success('Improvement creado')
        setDraft({ title: '', description: '', ownerId: '', dueDate: '' })
        setShowForm(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const moveStatus = (id: string, status: ImprovementStatus) => {
    startTransition(async () => {
      try {
        await updateImprovementStatus({
          id,
          status,
          actorId: currentUser?.id,
        })
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const remove = (id: string) => {
    if (!confirm('¿Eliminar este improvement?')) return
    startTransition(async () => {
      await deleteImprovement({ id, actorId: currentUser?.id })
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-gradient-to-br from-cyan-500/10 via-card to-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-cyan-300">
              <Lightbulb className="h-3.5 w-3.5" />
              Improvement Items · Retro tracking cross-sprint
            </div>
            <h1 className="mt-1 text-2xl font-bold text-foreground">
              {projectName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              ¿Las acciones del retro realmente se cierran? Esta es la métrica
              de madurez ágil.
            </p>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-500/20 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/30"
          >
            <Plus className="h-4 w-4" />
            Nuevo Improvement
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard
            label="Close Rate"
            value={`${metrics.closeRate}%`}
            icon={TrendingUp}
            color="emerald"
          />
          <KpiCard
            label="Total"
            value={metrics.total.toString()}
            icon={Target}
            color="cyan"
          />
          <KpiCard
            label="Vencidos"
            value={metrics.overdue.toString()}
            icon={CalendarClock}
            color={metrics.overdue > 0 ? 'rose' : 'zinc'}
          />
          <KpiCard
            label="En curso"
            value={metrics.inProgress.toString()}
            icon={CheckCheck}
            color="amber"
          />
        </div>
      </header>

      {showForm && (
        <div className="rounded-xl border border-cyan-500/30 bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Nuevo Improvement Item
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              placeholder="Acción concreta · ej: Reducir tiempo de PR review a <24h"
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
              placeholder="Contexto, métrica de éxito..."
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
            <select
              value={draft.ownerId}
              onChange={(e) =>
                setDraft((d) => ({ ...d, ownerId: e.target.value }))
              }
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground"
            >
              <option value="">Sin owner</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={draft.dueDate}
              onChange={(e) =>
                setDraft((d) => ({ ...d, dueDate: e.target.value }))
              }
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              Crear
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            className={`flex min-h-[200px] flex-col rounded-xl border bg-card ${col.classes.split(' ')[0]}`}
          >
            <header
              className={`flex items-center justify-between rounded-t-xl px-3 py-2 text-xs font-semibold uppercase tracking-wider ${col.classes}`}
            >
              <span>{col.label}</span>
              <span className="rounded-full bg-background/40 px-2 py-0.5 text-xs">
                {grouped[col.key].length}
              </span>
            </header>
            <div className="flex-1 space-y-2 p-2">
              {grouped[col.key].map((item) => {
                const overdue =
                  item.dueDate &&
                  item.status !== 'DONE' &&
                  item.status !== 'CANCELLED' &&
                  new Date(item.dueDate) < new Date()
                return (
                  <article
                    key={item.id}
                    className={`rounded-lg border bg-background/40 p-3 text-sm transition-colors ${
                      overdue
                        ? 'border-rose-500/40'
                        : 'border-border hover:border-border'
                    }`}
                  >
                    <h3 className="font-medium text-foreground line-clamp-2">
                      {item.title}
                    </h3>
                    {item.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                    )}
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {item.owner && <div>👤 {item.owner.name}</div>}
                      {item.retrospective && (
                        <div className="text-cyan-300">
                          ↩ {item.retrospective.sprint.name}
                        </div>
                      )}
                      {item.dueDate && (
                        <div className={overdue ? 'text-rose-300' : ''}>
                          📅{' '}
                          {new Date(item.dueDate).toLocaleDateString('es-MX')}
                          {overdue && ' (vencido)'}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {col.key === 'OPEN' && (
                        <button
                          onClick={() => moveStatus(item.id, 'IN_PROGRESS')}
                          disabled={isPending}
                          className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-200 hover:bg-amber-500/30"
                        >
                          → En curso
                        </button>
                      )}
                      {col.key === 'IN_PROGRESS' && (
                        <>
                          <button
                            onClick={() => moveStatus(item.id, 'DONE')}
                            disabled={isPending}
                            className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs text-emerald-200 hover:bg-emerald-500/30"
                          >
                            ✓ Completar
                          </button>
                          <button
                            onClick={() => moveStatus(item.id, 'OPEN')}
                            disabled={isPending}
                            className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-300 hover:bg-rose-500/20"
                          >
                            ← Open
                          </button>
                        </>
                      )}
                      {col.key !== 'DONE' && col.key !== 'CANCELLED' && (
                        <button
                          onClick={() => moveStatus(item.id, 'CANCELLED')}
                          disabled={isPending}
                          className="rounded bg-zinc-500/20 px-1.5 py-0.5 text-xs text-zinc-300 hover:bg-zinc-500/30"
                        >
                          ✗ Cancelar
                        </button>
                      )}
                      <button
                        onClick={() => remove(item.id)}
                        className="ml-auto rounded p-0.5 text-muted-foreground hover:text-rose-300"
                        title="Eliminar"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  icon: typeof TrendingUp
  color: 'emerald' | 'amber' | 'rose' | 'cyan' | 'zinc'
}) {
  const map: Record<typeof color, string> = {
    emerald: 'text-emerald-200 bg-emerald-500/10 border-emerald-500/30',
    amber: 'text-amber-200 bg-amber-500/10 border-amber-500/30',
    rose: 'text-rose-200 bg-rose-500/10 border-rose-500/30',
    cyan: 'text-cyan-200 bg-cyan-500/10 border-cyan-500/30',
    zinc: 'text-zinc-200 bg-zinc-500/10 border-zinc-500/30',
  }
  return (
    <div className={`rounded-lg border px-3 py-2 ${map[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider opacity-80">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 opacity-70" />
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  )
}
