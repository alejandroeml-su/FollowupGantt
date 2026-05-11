'use client'

/**
 * Wave R-360 — Pantalla de gestión 360° de riesgos del proyecto.
 *
 * Capacidades:
 *   1. Crear/editar/cerrar Risks manuales (PMBOK 5×5).
 *   2. Promover insights heurísticos (DELAY_RISK) al Risk Register.
 *   3. Registrar/editar/cerrar acciones correctivas por Risk.
 *
 * Diseño:
 *   - Layout 2 secciones: panel izquierdo lista de Risks + filtros;
 *     panel derecho detalle con acciones correctivas del Risk seleccionado.
 *   - Sección superior: bandeja de insights heurísticos pendientes con
 *     botón "Promover" inline.
 */

import { useId, useState, useTransition, useMemo } from 'react'
import {
  Plus,
  Sparkles,
  ShieldAlert,
  ListChecks,
  X as CloseIcon,
  CheckCircle2,
  Circle,
  AlertCircle,
  XCircle,
  Trash2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { createRisk, updateRisk, deleteRisk } from '@/lib/actions/risks'
import {
  promoteHeuristicInsightToRisk,
  promoteAllHeuristicInsightsForProject,
  createRiskAction,
  updateRiskAction,
  deleteRiskAction,
} from '@/lib/actions/risk-actions'
import type { SerializedRisk } from '@/lib/risks/types'
import { toast } from '@/components/interactions/Toaster'
import { useTranslation } from '@/lib/i18n/use-translation'

type RiskActionStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'

export type ProjectRisksClientAction = {
  id: string
  riskId: string
  description: string
  status: RiskActionStatus
  ownerId: string | null
  ownerName: string | null
  dueDate: string | null
  doneAt: string | null
  createdAt: string
}

export type PendingHeuristicInsight = {
  id: string
  score: number
  level: 'high' | 'medium' | 'low'
  factors: string[]
  createdAt: string
  task: { id: string; title: string; mnemonic: string | null }
}

type Props = {
  project: { id: string; name: string }
  risks: SerializedRisk[]
  actions: ProjectRisksClientAction[]
  users: { id: string; name: string }[]
  pendingInsights: PendingHeuristicInsight[]
}

const TIER_BADGE: Record<SerializedRisk['tier'], string> = {
  CRITICAL: 'bg-rose-600/30 text-rose-200 border-rose-500/60',
  HIGH: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  MEDIUM: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  LOW: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
}

const STATUS_BADGE: Record<SerializedRisk['status'], string> = {
  OPEN: 'bg-rose-500/15 text-rose-300',
  MITIGATING: 'bg-amber-500/15 text-amber-300',
  ACCEPTED: 'bg-blue-500/15 text-blue-300',
  CLOSED: 'bg-emerald-500/15 text-emerald-300',
}

// R3.0-A · Hardening · Wave P20 i18n · El label estático se reemplazó por
// claves `pages.projectRisks.actionStatus*` evaluadas en render para
// respetar la cookie `x-locale`. Se mantiene `ACTION_STATUS_TONE` porque
// son clases utilitarias que no dependen del idioma.

const ACTION_STATUS_TONE: Record<RiskActionStatus, string> = {
  PENDING: 'bg-secondary text-muted-foreground',
  IN_PROGRESS: 'bg-blue-500/15 text-blue-300',
  DONE: 'bg-emerald-500/15 text-emerald-300',
  CANCELLED: 'bg-secondary text-muted-foreground line-through',
}

export function ProjectRisksClient({
  project,
  risks: initialRisks,
  actions: initialActions,
  users,
  pendingInsights: initialInsights,
}: Props) {
  const { t } = useTranslation()
  const [risks, setRisks] = useState(initialRisks)
  const [actions, setActions] = useState(initialActions)
  const [insights, setInsights] = useState(initialInsights)
  const [selectedRiskId, setSelectedRiskId] = useState<string | null>(
    initialRisks[0]?.id ?? null,
  )
  const [showNewRisk, setShowNewRisk] = useState(false)
  const [editingRisk, setEditingRisk] = useState<SerializedRisk | null>(null)
  const [filterStatus, setFilterStatus] = useState<'ALL' | SerializedRisk['status']>(
    'ALL',
  )
  const [isPending, startTransition] = useTransition()

  const filteredRisks = useMemo(
    () =>
      filterStatus === 'ALL'
        ? risks
        : risks.filter((r) => r.status === filterStatus),
    [risks, filterStatus],
  )

  const selectedRisk = risks.find((r) => r.id === selectedRiskId) ?? null
  const selectedActions = actions.filter((a) => a.riskId === selectedRiskId)

  const handlePromoteOne = (insightId: string) => {
    startTransition(async () => {
      try {
        const r = await promoteHeuristicInsightToRisk({ taskInsightId: insightId })
        if (r.alreadyPromoted) {
          toast.success(t('pages.projectRisks.alreadyPromoted'))
        } else {
          toast.success(t('pages.projectRisks.promotedToRegister'))
          // Optimistic UI: remover el insight de la lista pendiente
          setInsights((prev) => prev.filter((i) => i.id !== insightId))
          // El SSR refrescará la lista de risks — para UX inmediata
          // hacemos refresh suave forzando recarga de la página.
          window.location.reload()
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t('pages.projectRisks.promoteError'),
        )
      }
    })
  }

  const handlePromoteAll = () => {
    if (insights.length === 0) return
    if (
      !confirm(
        t('pages.projectRisks.promoteAllConfirm', {
          count: insights.length,
          plural: insights.length === 1 ? '' : 's',
        }),
      )
    )
      return
    startTransition(async () => {
      try {
        const r = await promoteAllHeuristicInsightsForProject({
          projectId: project.id,
        })
        toast.success(
          t('pages.projectRisks.bulkPromoteSummary', {
            created: r.created,
            createdPlural: r.created === 1 ? '' : 's',
            createdPlural2: r.created === 1 ? '' : 's',
            skipped: r.skipped,
          }),
        )
        window.location.reload()
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t('pages.projectRisks.bulkPromoteError'),
        )
      }
    })
  }

  const handleDeleteRisk = (id: string, title: string) => {
    if (!confirm(t('pages.projectRisks.confirmDeleteRisk', { title })))
      return
    startTransition(async () => {
      try {
        await deleteRisk(id)
        toast.success(t('pages.projectRisks.riskDeleted'))
        setRisks((prev) => prev.filter((r) => r.id !== id))
        setActions((prev) => prev.filter((a) => a.riskId !== id))
        if (selectedRiskId === id) {
          setSelectedRiskId(risks.find((r) => r.id !== id)?.id ?? null)
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t('pages.projectRisks.riskDeleteError'),
        )
      }
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
      {/* Banda de insights pendientes */}
      {insights.length > 0 && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <header className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-semibold text-foreground">
                {t('pages.projectRisks.insightsBanner', {
                  count: insights.length,
                })}
              </h2>
            </div>
            <button
              type="button"
              onClick={handlePromoteAll}
              disabled={isPending}
              className="rounded-md bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
            >
              {t('pages.projectRisks.promoteAll')}
            </button>
          </header>
          <ul className="space-y-1.5">
            {insights.slice(0, 10).map((i) => (
              <li
                key={i.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-card/50 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-foreground">
                    <span
                      className={clsx(
                        'mr-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        i.level === 'high'
                          ? 'bg-rose-500/20 text-rose-300'
                          : i.level === 'medium'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300',
                      )}
                    >
                      {i.level}
                    </span>
                    {i.task.mnemonic && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {i.task.mnemonic}{' '}
                      </span>
                    )}
                    · {i.task.title}
                  </p>
                  {i.factors.length > 0 && (
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {i.factors.slice(0, 3).join(' · ')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handlePromoteOne(i.id)}
                  disabled={isPending}
                  className="shrink-0 rounded-md bg-primary/20 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/30 disabled:opacity-50"
                >
                  {t('pages.projectRisks.promote')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Toolbar Risk Register */}
      <section className="rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-rose-400" />
            <h2 className="text-sm font-semibold text-foreground">
              {t('pages.projectRisks.registerTitle', { count: risks.length })}
            </h2>
            <select
              value={filterStatus}
              onChange={(e) =>
                setFilterStatus(e.target.value as typeof filterStatus)
              }
              className="ml-3 rounded-md border border-border bg-input px-2 py-0.5 text-xs text-input-foreground"
            >
              <option value="ALL">
                {t('pages.projectRisks.filterAllStatuses')}
              </option>
              <option value="OPEN">{t('pages.projectRisks.statusOpen')}</option>
              <option value="MITIGATING">
                {t('pages.projectRisks.statusMitigating')}
              </option>
              <option value="ACCEPTED">
                {t('pages.projectRisks.statusAccepted')}
              </option>
              <option value="CLOSED">
                {t('pages.projectRisks.statusClosed')}
              </option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => setShowNewRisk(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('pages.projectRisks.newManualRisk')}
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* Lista de Risks */}
          <div className="max-h-[60vh] overflow-y-auto border-b lg:border-b-0 lg:border-r border-border">
            {filteredRisks.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                {t('pages.projectRisks.noRisksFilter')}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filteredRisks.map((r) => {
                  const actionCount = actions.filter((a) => a.riskId === r.id).length
                  const isSelected = selectedRiskId === r.id
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedRiskId(r.id)}
                        className={clsx(
                          'flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors',
                          isSelected
                            ? 'bg-secondary/60'
                            : 'hover:bg-secondary/30',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium text-foreground">
                            {r.title}
                          </p>
                          <span
                            className={clsx(
                              'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                              TIER_BADGE[r.tier],
                            )}
                          >
                            {r.tier} · {r.score}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span
                            className={clsx(
                              'rounded-full px-1.5 py-0.5',
                              STATUS_BADGE[r.status],
                            )}
                          >
                            {r.status}
                          </span>
                          <span>P{r.probability} × I{r.impact}</span>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1">
                            <ListChecks className="h-3 w-3" />
                            {t('pages.projectRisks.actionsCount', {
                              count: actionCount,
                              plural: actionCount === 1 ? '' : 'es',
                            })}
                          </span>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Detalle + acciones correctivas */}
          <div className="max-h-[60vh] overflow-y-auto p-4">
            {!selectedRisk ? (
              <p className="text-xs text-muted-foreground">
                {t('pages.projectRisks.selectRiskHint')}
              </p>
            ) : (
              <RiskDetail
                risk={selectedRisk}
                actions={selectedActions}
                users={users}
                onEditRisk={() => setEditingRisk(selectedRisk)}
                onDeleteRisk={() =>
                  handleDeleteRisk(selectedRisk.id, selectedRisk.title)
                }
                onActionsChange={(next) => {
                  setActions((prev) => [
                    ...prev.filter((a) => a.riskId !== selectedRisk.id),
                    ...next,
                  ])
                }}
              />
            )}
          </div>
        </div>
      </section>

      {/* Modales */}
      {showNewRisk && (
        <RiskModal
          mode="create"
          projectId={project.id}
          users={users}
          onClose={() => setShowNewRisk(false)}
          onSaved={(risk) => {
            setRisks((prev) => [risk, ...prev])
            setSelectedRiskId(risk.id)
            setShowNewRisk(false)
          }}
        />
      )}
      {editingRisk && (
        <RiskModal
          mode="edit"
          projectId={project.id}
          users={users}
          risk={editingRisk}
          onClose={() => setEditingRisk(null)}
          onSaved={(risk) => {
            setRisks((prev) => prev.map((r) => (r.id === risk.id ? risk : r)))
            setEditingRisk(null)
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────── RiskDetail (panel derecho) ───────────────────────

function RiskDetail({
  risk,
  actions,
  users,
  onEditRisk,
  onDeleteRisk,
  onActionsChange,
}: {
  risk: SerializedRisk
  actions: ProjectRisksClientAction[]
  users: { id: string; name: string }[]
  onEditRisk: () => void
  onDeleteRisk: () => void
  onActionsChange: (actions: ProjectRisksClientAction[]) => void
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)
  const [newDescription, setNewDescription] = useState('')
  const [newOwnerId, setNewOwnerId] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [isPending, startTransition] = useTransition()

  const localizedStatusLabel: Record<RiskActionStatus, string> = {
    PENDING: t('pages.projectRisks.actionStatusPending'),
    IN_PROGRESS: t('pages.projectRisks.actionStatusInProgress'),
    DONE: t('pages.projectRisks.actionStatusDone'),
    CANCELLED: t('pages.projectRisks.actionStatusCancelled'),
  }

  const handleAddAction = () => {
    if (newDescription.trim().length < 3) {
      toast.error(t('pages.projectRisks.actionDescriptionRequired'))
      return
    }
    startTransition(async () => {
      try {
        const created = await createRiskAction({
          riskId: risk.id,
          description: newDescription.trim(),
          ownerId: newOwnerId || null,
          dueDate: newDueDate || null,
        })
        toast.success(t('pages.projectRisks.actionCreated'))
        const newAction: ProjectRisksClientAction = {
          id: created.id,
          riskId: risk.id,
          description: newDescription.trim(),
          status: 'PENDING',
          ownerId: newOwnerId || null,
          ownerName: users.find((u) => u.id === newOwnerId)?.name ?? null,
          dueDate: newDueDate ? new Date(newDueDate).toISOString() : null,
          doneAt: null,
          createdAt: new Date().toISOString(),
        }
        onActionsChange([...actions, newAction])
        setNewDescription('')
        setNewOwnerId('')
        setNewDueDate('')
        setAdding(false)
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t('pages.projectRisks.actionCreateError'),
        )
      }
    })
  }

  const handleStatusChange = (
    actionId: string,
    nextStatus: RiskActionStatus,
  ) => {
    startTransition(async () => {
      try {
        await updateRiskAction({ id: actionId, status: nextStatus })
        toast.success(t('pages.projectRisks.actionUpdated'))
        onActionsChange(
          actions.map((a) =>
            a.id === actionId
              ? {
                  ...a,
                  status: nextStatus,
                  doneAt:
                    nextStatus === 'DONE' ? new Date().toISOString() : null,
                }
              : a,
          ),
        )
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t('pages.projectRisks.actionUpdateError'),
        )
      }
    })
  }

  const handleDeleteAction = (actionId: string) => {
    if (!confirm(t('pages.projectRisks.confirmDeleteAction'))) return
    startTransition(async () => {
      try {
        await deleteRiskAction({ id: actionId })
        toast.success(t('pages.projectRisks.actionDeleted'))
        onActionsChange(actions.filter((a) => a.id !== actionId))
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t('pages.projectRisks.actionDeleteError'),
        )
      }
    })
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground">
            {risk.title}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {risk.ownerName
              ? `${t('pages.projectRisks.ownerLine', { name: risk.ownerName })} · `
              : ''}
            P{risk.probability} × I{risk.impact} = score {risk.score}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEditRisk}
            className="rounded-md border border-border bg-secondary px-2 py-1 text-xs hover:bg-secondary/80"
          >
            {t('pages.projectRisks.edit')}
          </button>
          <button
            type="button"
            onClick={onDeleteRisk}
            className="rounded-md border border-destructive/40 bg-destructive/10 p-1 text-destructive hover:bg-destructive/20"
            title={t('pages.projectRisks.delete')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {risk.description && (
        <p className="text-xs text-muted-foreground whitespace-pre-line">
          {risk.description}
        </p>
      )}
      {risk.mitigation && (
        <div className="rounded-md border border-border/50 bg-secondary/30 p-3 text-xs text-foreground">
          <p className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px] mb-1">
            {t('pages.projectRisks.mitigationHeader')}
          </p>
          {risk.mitigation}
        </div>
      )}

      {/* Acciones correctivas */}
      <section>
        <header className="mb-2 flex items-center justify-between">
          <h4 className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <ListChecks className="h-4 w-4" />
            {t('pages.projectRisks.actionsTitle', { count: actions.length })}
          </h4>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-md bg-primary/15 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/25"
          >
            <Plus className="inline h-3 w-3" />{' '}
            {t('pages.projectRisks.newAction')}
          </button>
        </header>

        {adding && (
          <div className="mb-3 space-y-2 rounded-md border border-border bg-card p-3">
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              placeholder={t(
                'pages.projectRisks.actionDescriptionPlaceholder',
              )}
              className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                className="rounded-md border border-border bg-input px-2 py-1 text-xs"
              >
                <option value="">
                  {t('pages.projectRisks.actionWithoutOwner')}
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="rounded-md border border-border bg-input px-2 py-1 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAdding(false)
                  setNewDescription('')
                  setNewOwnerId('')
                  setNewDueDate('')
                }}
                disabled={isPending}
                className="rounded-md border border-border bg-secondary px-3 py-1 text-xs hover:bg-secondary/80 disabled:opacity-50"
              >
                {t('pages.projectRisks.cancel')}
              </button>
              <button
                type="button"
                onClick={handleAddAction}
                disabled={isPending}
                className="rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending
                  ? t('pages.projectRisks.saving')
                  : t('pages.projectRisks.create')}
              </button>
            </div>
          </div>
        )}

        {actions.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
            {t('pages.projectRisks.noActions')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {actions.map((a) => (
              <li
                key={a.id}
                className="flex items-start gap-2 rounded-md border border-border/40 bg-card/50 p-2.5"
              >
                <ActionStatusToggle
                  status={a.status}
                  onChange={(next) => handleStatusChange(a.id, next)}
                  disabled={isPending}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={clsx(
                      'text-xs text-foreground',
                      a.status === 'CANCELLED' && 'line-through opacity-60',
                      a.status === 'DONE' && 'opacity-70',
                    )}
                  >
                    {a.description}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    <span
                      className={clsx(
                        'mr-2 rounded-full px-1.5 py-0.5',
                        ACTION_STATUS_TONE[a.status],
                      )}
                    >
                      {localizedStatusLabel[a.status]}
                    </span>
                    {a.ownerName && (
                      <>
                        {t('pages.projectRisks.ownerLine', {
                          name: a.ownerName,
                        })}
                        {' · '}
                      </>
                    )}
                    {a.dueDate && (
                      <>
                        {t('pages.projectRisks.dueLine', {
                          date: new Date(a.dueDate).toLocaleDateString(),
                        })}
                        {' · '}
                      </>
                    )}
                    {a.doneAt && (
                      <>
                        {t('pages.projectRisks.closedLine', {
                          date: new Date(a.doneAt).toLocaleDateString(),
                        })}
                      </>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteAction(a.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                  title={t('pages.projectRisks.delete')}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ActionStatusToggle({
  status,
  onChange,
  disabled,
}: {
  status: RiskActionStatus
  onChange: (next: RiskActionStatus) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  // Toggle simple en orden cíclico: PENDING → IN_PROGRESS → DONE → CANCELLED → PENDING
  const next: Record<RiskActionStatus, RiskActionStatus> = {
    PENDING: 'IN_PROGRESS',
    IN_PROGRESS: 'DONE',
    DONE: 'PENDING',
    CANCELLED: 'PENDING',
  }
  const Icon =
    status === 'DONE'
      ? CheckCircle2
      : status === 'IN_PROGRESS'
        ? AlertCircle
        : status === 'CANCELLED'
          ? XCircle
          : Circle
  const tone =
    status === 'DONE'
      ? 'text-emerald-400'
      : status === 'IN_PROGRESS'
        ? 'text-blue-400'
        : status === 'CANCELLED'
          ? 'text-muted-foreground'
          : 'text-muted-foreground'
  const localizedStatus =
    status === 'DONE'
      ? t('pages.projectRisks.actionStatusDone')
      : status === 'IN_PROGRESS'
        ? t('pages.projectRisks.actionStatusInProgress')
        : status === 'CANCELLED'
          ? t('pages.projectRisks.actionStatusCancelled')
          : t('pages.projectRisks.actionStatusPending')
  return (
    <button
      type="button"
      onClick={() => onChange(next[status])}
      disabled={disabled}
      title={t('pages.projectRisks.actionStatusToggleTitle', {
        status: localizedStatus,
      })}
      className="shrink-0 rounded-full p-0.5 transition-transform hover:scale-110 disabled:opacity-50"
    >
      <Icon className={clsx('h-4 w-4', tone)} />
    </button>
  )
}

// ─────────────────────── RiskModal (create + edit) ───────────────────────

function RiskModal({
  mode,
  projectId,
  users,
  risk,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  projectId: string
  users: { id: string; name: string }[]
  risk?: SerializedRisk
  onClose: () => void
  onSaved: (risk: SerializedRisk) => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const [title, setTitle] = useState(risk?.title ?? '')
  const [description, setDescription] = useState(risk?.description ?? '')
  const [probability, setProbability] = useState<number>(risk?.probability ?? 3)
  const [impact, setImpact] = useState<number>(risk?.impact ?? 3)
  const [status, setStatus] = useState<SerializedRisk['status']>(
    risk?.status ?? 'OPEN',
  )
  const [ownerId, setOwnerId] = useState(risk?.ownerId ?? '')
  const [mitigation, setMitigation] = useState(risk?.mitigation ?? '')
  const [triggerDelayDays, setTriggerDelayDays] = useState(
    risk?.triggerDelayDays ?? '',
  )
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error(t('pages.projectRisks.fieldTitleRequired'))
      return
    }
    startTransition(async () => {
      try {
        if (mode === 'edit' && risk) {
          await updateRisk(risk.id, {
            title: title.trim(),
            description: description.trim() || null,
            probability: probability as 1 | 2 | 3 | 4 | 5,
            impact: impact as 1 | 2 | 3 | 4 | 5,
            status,
            ownerId: ownerId || null,
            mitigation: mitigation.trim() || null,
            triggerDelayDays:
              typeof triggerDelayDays === 'number' && triggerDelayDays > 0
                ? triggerDelayDays
                : null,
          })
          // Reconstruir SerializedRisk localmente (con score/tier recalculados).
          const score = (probability as number) * (impact as number)
          const tier: SerializedRisk['tier'] =
            score >= 20 ? 'CRITICAL' : score >= 12 ? 'HIGH' : score >= 6 ? 'MEDIUM' : 'LOW'
          onSaved({
            ...risk,
            title: title.trim(),
            description: description.trim() || null,
            probability: probability as 1 | 2 | 3 | 4 | 5,
            impact: impact as 1 | 2 | 3 | 4 | 5,
            status,
            ownerId: ownerId || null,
            ownerName: users.find((u) => u.id === ownerId)?.name ?? null,
            mitigation: mitigation.trim() || null,
            triggerDelayDays:
              typeof triggerDelayDays === 'number' && triggerDelayDays > 0
                ? triggerDelayDays
                : null,
            score,
            tier,
            updatedAt: new Date().toISOString(),
          })
          toast.success(t('pages.projectRisks.riskUpdated'))
        } else {
          const r = await createRisk({
            projectId,
            title: title.trim(),
            description: description.trim() || null,
            probability: probability as 1 | 2 | 3 | 4 | 5,
            impact: impact as 1 | 2 | 3 | 4 | 5,
            status,
            ownerId: ownerId || null,
            mitigation: mitigation.trim() || null,
            triggerDelayDays:
              typeof triggerDelayDays === 'number' && triggerDelayDays > 0
                ? triggerDelayDays
                : null,
          })
          // Construir el SerializedRisk del optimistic UI (los campos
          // calculados se derivan en client; el server los recalcula al
          // recargar).
          const score = (probability as number) * (impact as number)
          const tier: SerializedRisk['tier'] =
            score >= 20 ? 'CRITICAL' : score >= 12 ? 'HIGH' : score >= 6 ? 'MEDIUM' : 'LOW'
          onSaved({
            id: r.id,
            projectId,
            projectName: null,
            title: title.trim(),
            description: description.trim() || null,
            probability: probability as 1 | 2 | 3 | 4 | 5,
            impact: impact as 1 | 2 | 3 | 4 | 5,
            score,
            tier,
            status,
            ownerId: ownerId || null,
            ownerName: users.find((u) => u.id === ownerId)?.name ?? null,
            mitigation: mitigation.trim() || null,
            triggerDelayDays:
              typeof triggerDelayDays === 'number' && triggerDelayDays > 0
                ? triggerDelayDays
                : null,
            detectedAt: new Date().toISOString(),
            closedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          toast.success(t('pages.projectRisks.riskCreated'))
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : t('pages.projectRisks.saveError'),
        )
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-[520px] rounded-xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            {mode === 'create'
              ? t('pages.projectRisks.modalTitleNew')
              : t('pages.projectRisks.modalTitleEdit')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('pages.projectRisks.close')}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-3 p-5">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('pages.projectRisks.fieldTitle')}{' '}
              <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('pages.projectRisks.titlePlaceholder')}
              autoFocus
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('pages.projectRisks.fieldDescription')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t('pages.projectRisks.descriptionPlaceholder')}
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('pages.projectRisks.fieldProbability')}
              </label>
              <select
                value={probability}
                onChange={(e) => setProbability(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('pages.projectRisks.fieldImpact')}
              </label>
              <select
                value={impact}
                onChange={(e) => setImpact(Number(e.target.value))}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('pages.projectRisks.fieldStatus')}
              </label>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as SerializedRisk['status'])
                }
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
              >
                <option value="OPEN">
                  {t('pages.portfolioRisks.statusOpen')}
                </option>
                <option value="MITIGATING">
                  {t('pages.portfolioRisks.statusMitigating')}
                </option>
                <option value="ACCEPTED">
                  {t('pages.portfolioRisks.statusAccepted')}
                </option>
                <option value="CLOSED">
                  {t('pages.portfolioRisks.statusClosed')}
                </option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('pages.projectRisks.fieldOwner')}
              </label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-sm"
              >
                <option value="">
                  {t('pages.projectRisks.actionWithoutOwner')}
                </option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('pages.projectRisks.fieldMitigation')}
            </label>
            <textarea
              value={mitigation}
              onChange={(e) => setMitigation(e.target.value)}
              rows={2}
              placeholder={t('pages.projectRisks.mitigationPlaceholder')}
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('pages.projectRisks.fieldDelayDays')}
            </label>
            <input
              type="number"
              min={0}
              max={3650}
              value={triggerDelayDays}
              onChange={(e) =>
                setTriggerDelayDays(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder={t('pages.projectRisks.delayPlaceholder')}
              className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm"
            />
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border bg-subtle/50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm hover:bg-secondary/80 disabled:opacity-60"
          >
            {t('pages.projectRisks.cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !title.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {isPending
              ? t('pages.projectRisks.saving')
              : mode === 'create'
                ? t('pages.projectRisks.saveRisk')
                : t('pages.projectRisks.saveRiskEdit')}
          </button>
        </footer>
      </div>
    </div>
  )
}
