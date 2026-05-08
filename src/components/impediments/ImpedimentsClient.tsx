'use client'

/**
 * Wave P12 (Scrum 100% · HU-12.6) — Impediments tracker.
 *
 * Lista filtrable + form + workflow buttons (Iniciar / Resolver /
 * Escalar). Severidad coloreada (LOW/MEDIUM/HIGH/CRITICAL).
 */

import { useMemo, useState, useTransition } from 'react'
import {
  ArrowUpRight,
  CheckCircle2,
  ListFilter,
  Plus,
  ShieldAlert,
  Siren,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  createImpediment,
  updateImpedimentStatus,
} from '@/lib/actions/impediments'
import type { ImpedimentSeverity, ImpedimentStatus } from '@prisma/client'
import { toast } from '@/components/interactions/Toaster'

type TeamMember = { id: string; name: string }

type Impediment = {
  id: string
  title: string
  description: string | null
  severity: ImpedimentSeverity
  status: ImpedimentStatus
  raisedAt: string | Date
  resolvedAt: string | Date | null
  resolutionNotes: string | null
  raisedBy: { id: string; name: string } | null
  owner: { id: string; name: string } | null
  sprint: { id: string; name: string }
}

type Props = {
  sprintId: string
  sprintName: string
  projectId: string
  team: TeamMember[]
  impediments: Impediment[]
  currentUser: { id: string; name: string } | null
}

const SEVERITY_META: Record<
  ImpedimentSeverity,
  { label: string; classes: string; icon: typeof TriangleAlert }
> = {
  LOW: {
    label: 'Baja',
    classes: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-200',
    icon: TriangleAlert,
  },
  MEDIUM: {
    label: 'Media',
    classes: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    icon: TriangleAlert,
  },
  HIGH: {
    label: 'Alta',
    classes: 'border-orange-500/40 bg-orange-500/10 text-orange-200',
    icon: ShieldAlert,
  },
  CRITICAL: {
    label: 'Crítica',
    classes: 'border-rose-500/50 bg-rose-500/15 text-rose-200',
    icon: Siren,
  },
}

const STATUS_META: Record<
  ImpedimentStatus,
  { label: string; classes: string }
> = {
  OPEN: { label: 'Abierto', classes: 'bg-rose-500/20 text-rose-200' },
  IN_PROGRESS: {
    label: 'En curso',
    classes: 'bg-amber-500/20 text-amber-200',
  },
  RESOLVED: {
    label: 'Resuelto',
    classes: 'bg-emerald-500/20 text-emerald-200',
  },
  ESCALATED: {
    label: 'Escalado',
    classes: 'bg-fuchsia-500/20 text-fuchsia-200',
  },
}

export function ImpedimentsClient({
  sprintId,
  sprintName,
  team,
  impediments,
  currentUser,
}: Props) {
  const [showForm, setShowForm] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ImpedimentStatus | 'ALL'>(
    'ALL',
  )
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    severity: 'MEDIUM' as ImpedimentSeverity,
    ownerId: '',
  })
  const [resolveDraft, setResolveDraft] = useState<{
    id: string
    notes: string
  } | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const filtered = useMemo(
    () =>
      statusFilter === 'ALL'
        ? impediments
        : impediments.filter((i) => i.status === statusFilter),
    [impediments, statusFilter],
  )

  const counts = useMemo(() => {
    const c = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, ESCALATED: 0, total: 0 }
    for (const i of impediments) {
      c[i.status] += 1
      c.total += 1
    }
    return c
  }, [impediments])

  const handleCreate = () => {
    if (!draft.title.trim()) {
      toast.error('Título requerido')
      return
    }
    startTransition(async () => {
      try {
        await createImpediment({
          sprintId,
          title: draft.title,
          description: draft.description,
          severity: draft.severity,
          raisedById: currentUser?.id,
          ownerId: draft.ownerId || null,
        })
        toast.success('Impediment registrado')
        setDraft({
          title: '',
          description: '',
          severity: 'MEDIUM',
          ownerId: '',
        })
        setShowForm(false)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const moveStatus = (
    id: string,
    status: ImpedimentStatus,
    resolutionNotes?: string,
  ) => {
    startTransition(async () => {
      try {
        await updateImpedimentStatus({
          id,
          status,
          resolutionNotes,
          actorId: currentUser?.id,
        })
        toast.success('Status actualizado')
        setResolveDraft(null)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-gradient-to-br from-orange-500/10 via-card to-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-orange-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              Impediments Tracker
            </div>
            <h1 className="mt-1 text-2xl font-bold text-foreground">
              {sprintName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bloqueos del equipo · responsabilidad del Scrum Master
            </p>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="inline-flex items-center gap-2 rounded-md bg-orange-500/20 px-3 py-2 text-sm font-medium text-orange-200 hover:bg-orange-500/30"
          >
            <Plus className="h-4 w-4" />
            Levantar nuevo
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(
            [
              ['ALL', 'Todos', counts.total],
              ['OPEN', 'Abiertos', counts.OPEN],
              ['IN_PROGRESS', 'En curso', counts.IN_PROGRESS],
              ['RESOLVED', 'Resueltos', counts.RESOLVED],
              ['ESCALATED', 'Escalados', counts.ESCALATED],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key as ImpedimentStatus | 'ALL')}
              className={`rounded-lg border px-3 py-2 text-xs ${
                statusFilter === key
                  ? 'border-orange-500/60 bg-orange-500/15 text-orange-200'
                  : 'border-border bg-card/40 text-muted-foreground hover:border-border'
              }`}
            >
              <div className="text-2xl font-bold">{count}</div>
              <div>{label}</div>
            </button>
          ))}
        </div>
      </header>

      {showForm && (
        <div className="rounded-xl border border-orange-500/30 bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            Nuevo Impediment
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              placeholder="Resumen del bloqueo"
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
            <textarea
              rows={3}
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
              placeholder="Contexto, intentos previos, posibles soluciones..."
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
            <select
              value={draft.severity}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  severity: e.target.value as ImpedimentSeverity,
                }))
              }
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground"
            >
              <option value="LOW">Severidad: Baja</option>
              <option value="MEDIUM">Severidad: Media</option>
              <option value="HIGH">Severidad: Alta</option>
              <option value="CRITICAL">Severidad: Crítica</option>
            </select>
            <select
              value={draft.ownerId}
              onChange={(e) =>
                setDraft((d) => ({ ...d, ownerId: e.target.value }))
              }
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground"
            >
              <option value="">Asignar owner... (opcional)</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
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
              className="inline-flex items-center gap-1.5 rounded-md bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Registrar
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
            <ListFilter className="mx-auto h-8 w-8 opacity-50" />
            <p className="mt-2">No hay impediments con este filtro.</p>
          </div>
        )}
        {filtered.map((imp) => {
          const sev = SEVERITY_META[imp.severity]
          const SevIcon = sev.icon
          const stat = STATUS_META[imp.status]
          const isResolveOpen = resolveDraft?.id === imp.id
          return (
            <article
              key={imp.id}
              className={`rounded-xl border bg-card p-4 ${
                imp.status === 'OPEN' || imp.status === 'ESCALATED'
                  ? 'border-rose-500/30'
                  : 'border-border'
              }`}
            >
              <div className="flex flex-wrap items-start gap-3">
                <div
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border ${sev.classes}`}
                >
                  <SevIcon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {imp.title}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${stat.classes}`}
                    >
                      {stat.label}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${sev.classes}`}
                    >
                      {sev.label}
                    </span>
                  </div>
                  {imp.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                      {imp.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    {imp.owner && <span>Owner: {imp.owner.name}</span>}
                    {imp.raisedBy && <span>Por: {imp.raisedBy.name}</span>}
                    <span>
                      {new Date(imp.raisedAt).toLocaleDateString('es-MX')}
                    </span>
                    {imp.resolvedAt && (
                      <span className="text-emerald-300">
                        Resuelto:{' '}
                        {new Date(imp.resolvedAt).toLocaleDateString('es-MX')}
                      </span>
                    )}
                  </div>
                  {imp.resolutionNotes && (
                    <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs text-emerald-200">
                      <CheckCircle2 className="mr-1 inline h-3 w-3" />
                      {imp.resolutionNotes}
                    </div>
                  )}
                </div>
              </div>

              {imp.status !== 'RESOLVED' && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-3">
                  {imp.status === 'OPEN' && (
                    <button
                      onClick={() => moveStatus(imp.id, 'IN_PROGRESS')}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/30"
                    >
                      <Zap className="h-3 w-3" />
                      Iniciar
                    </button>
                  )}
                  <button
                    onClick={() => setResolveDraft({ id: imp.id, notes: '' })}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Marcar resuelto
                  </button>
                  {imp.status !== 'ESCALATED' && (
                    <button
                      onClick={() => moveStatus(imp.id, 'ESCALATED')}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-fuchsia-500/20 px-2.5 py-1 text-xs font-medium text-fuchsia-200 hover:bg-fuchsia-500/30"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                      Escalar fuera del equipo
                    </button>
                  )}
                </div>
              )}

              {isResolveOpen && (
                <div className="mt-3 space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <textarea
                    rows={2}
                    autoFocus
                    value={resolveDraft.notes}
                    onChange={(e) =>
                      setResolveDraft((rd) =>
                        rd ? { ...rd, notes: e.target.value } : rd,
                      )
                    }
                    placeholder="¿Cómo se resolvió? (notas para Lessons Learned)"
                    className="w-full rounded-md border border-border bg-background/50 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setResolveDraft(null)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() =>
                        moveStatus(imp.id, 'RESOLVED', resolveDraft.notes)
                      }
                      disabled={isPending}
                      className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
