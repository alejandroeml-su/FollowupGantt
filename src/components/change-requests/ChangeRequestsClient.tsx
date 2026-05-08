'use client'

/**
 * Wave P11-PMI (HU-12.3) — Change Control Board UI MVP.
 * Lista + form crear + decisión inline (approve/reject/defer).
 */

import { useState, useTransition } from 'react'
import { GitMerge, Plus, X as CloseIcon, Check, Ban, Clock as ClockIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import {
  createChangeRequest,
  decideChangeRequest,
} from '@/lib/actions/change-requests'
import { toast } from '@/components/interactions/Toaster'

type Impact = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'
type Status =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'DEFERRED'
  | 'IMPLEMENTED'

type ChangeRequest = {
  id: string
  title: string
  description: string
  rationale: string | null
  impactScope: Impact
  impactSchedule: Impact
  impactCost: Impact
  impactQuality: Impact
  estimatedCostDelta: unknown
  estimatedScheduleDeltaDays: number | null
  status: Status
  decisionNotes: string | null
  createdAt: Date
  decidedAt: Date | null
  requestedBy: { id: string; name: string }
  decidedBy: { id: string; name: string } | null
}

const STATUS_TONE: Record<Status, string> = {
  SUBMITTED: 'border-slate-500/40 bg-slate-500/15 text-slate-300',
  UNDER_REVIEW: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300',
  APPROVED: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  REJECTED: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  DEFERRED: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  IMPLEMENTED: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
}

const IMPACT_TONE: Record<Impact, string> = {
  NONE: 'text-muted-foreground',
  LOW: 'text-blue-300',
  MEDIUM: 'text-amber-300',
  HIGH: 'text-rose-300',
}

type Props = {
  projectId: string
  currentUserId: string | null
  changeRequests: ChangeRequest[]
}

export function ChangeRequestsClient({
  projectId,
  currentUserId,
  changeRequests,
}: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    title: '',
    description: '',
    rationale: '',
    impactScope: 'NONE' as Impact,
    impactSchedule: 'NONE' as Impact,
    impactCost: 'NONE' as Impact,
    impactQuality: 'NONE' as Impact,
    estimatedCostDelta: '',
    estimatedScheduleDeltaDays: '',
  })
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    if (!currentUserId) {
      toast.error('Sesión requerida')
      return
    }
    if (!form.title.trim() || !form.description.trim()) {
      toast.error('Title + Description requeridos')
      return
    }
    startTransition(async () => {
      try {
        await createChangeRequest({
          projectId,
          requestedById: currentUserId,
          title: form.title.trim(),
          description: form.description.trim(),
          rationale: form.rationale.trim() || null,
          impactScope: form.impactScope,
          impactSchedule: form.impactSchedule,
          impactCost: form.impactCost,
          impactQuality: form.impactQuality,
          estimatedCostDelta: form.estimatedCostDelta
            ? Number(form.estimatedCostDelta)
            : null,
          estimatedScheduleDeltaDays: form.estimatedScheduleDeltaDays
            ? Number(form.estimatedScheduleDeltaDays)
            : null,
        })
        toast.success('Change Request enviado')
        setShowForm(false)
        setForm({
          title: '',
          description: '',
          rationale: '',
          impactScope: 'NONE',
          impactSchedule: 'NONE',
          impactCost: 'NONE',
          impactQuality: 'NONE',
          estimatedCostDelta: '',
          estimatedScheduleDeltaDays: '',
        })
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const handleDecide = (
    id: string,
    decision: 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'UNDER_REVIEW' | 'IMPLEMENTED',
  ) => {
    if (!currentUserId) {
      toast.error('Sesión requerida')
      return
    }
    const notes = decision === 'APPROVED' || decision === 'REJECTED'
      ? prompt(`Notas de decisión para ${decision}:`)
      : null
    startTransition(async () => {
      try {
        await decideChangeRequest({
          id,
          status: decision,
          decidedById: currentUserId,
          decisionNotes: notes,
        })
        toast.success(`Marcado como ${decision}`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex items-center justify-between rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <GitMerge className="h-6 w-6 text-amber-400" />
          <div>
            <h2 className="text-base font-bold text-foreground">
              Change Control Board
            </h2>
            <p className="text-xs text-muted-foreground">
              {changeRequests.length} change request
              {changeRequests.length === 1 ? '' : 's'} · PMBOK Integrated Change
              Control
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-500"
        >
          <Plus className="h-3.5 w-3.5" /> Nuevo Change Request
        </button>
      </header>

      {showForm && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">
              Nuevo Change Request
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded p-1 text-muted-foreground hover:bg-secondary"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <Field label="Título *">
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Resumen del cambio solicitado"
              className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
            />
          </Field>
          <Field label="Descripción *">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="Descripción detallada del cambio"
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
            />
          </Field>
          <Field label="Justificación / rationale">
            <textarea
              value={form.rationale}
              onChange={(e) => setForm({ ...form, rationale: e.target.value })}
              rows={2}
              placeholder="Por qué se necesita este cambio"
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
            />
          </Field>

          <div className="grid grid-cols-4 gap-3">
            {(['Scope', 'Schedule', 'Cost', 'Quality'] as const).map((dim) => {
              const key = `impact${dim}` as keyof typeof form
              return (
                <Field key={dim} label={`Impact ${dim}`}>
                  <select
                    value={form[key] as string}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value as Impact })
                    }
                    className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs text-input-foreground"
                  >
                    <option value="NONE">NONE</option>
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                  </select>
                </Field>
              )
            })}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost delta estimado (USD)">
              <input
                type="number"
                value={form.estimatedCostDelta}
                onChange={(e) =>
                  setForm({ ...form, estimatedCostDelta: e.target.value })
                }
                className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
              />
            </Field>
            <Field label="Schedule delta (días)">
              <input
                type="number"
                value={form.estimatedScheduleDeltaDays}
                onChange={(e) =>
                  setForm({
                    ...form,
                    estimatedScheduleDeltaDays: e.target.value,
                  })
                }
                className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-border bg-secondary px-3 py-1.5 text-xs"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {isPending ? 'Enviando…' : 'Enviar al CCB'}
            </button>
          </div>
        </section>
      )}

      {/* Lista */}
      {changeRequests.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          Sin change requests · perfecto, todo estable
        </p>
      ) : (
        <ul className="space-y-3">
          {changeRequests.map((cr) => (
            <li key={cr.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-foreground">{cr.title}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{cr.description}</p>
                  {cr.rationale && (
                    <p className="mt-2 text-[11px] italic text-muted-foreground">
                      💡 {cr.rationale}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
                    <span>
                      Scope:{' '}
                      <strong className={IMPACT_TONE[cr.impactScope]}>
                        {cr.impactScope}
                      </strong>
                    </span>
                    <span>
                      Schedule:{' '}
                      <strong className={IMPACT_TONE[cr.impactSchedule]}>
                        {cr.impactSchedule}
                      </strong>
                    </span>
                    <span>
                      Cost:{' '}
                      <strong className={IMPACT_TONE[cr.impactCost]}>
                        {cr.impactCost}
                      </strong>
                    </span>
                    <span>
                      Quality:{' '}
                      <strong className={IMPACT_TONE[cr.impactQuality]}>
                        {cr.impactQuality}
                      </strong>
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    Solicitado por <strong>{cr.requestedBy.name}</strong>{' '}
                    · {new Date(cr.createdAt).toLocaleDateString('es-MX')}
                    {cr.decidedAt && cr.decidedBy && (
                      <>
                        {' '}
                        · Decidido por <strong>{cr.decidedBy.name}</strong>{' '}
                        ({new Date(cr.decidedAt).toLocaleDateString('es-MX')})
                      </>
                    )}
                  </div>
                  {cr.decisionNotes && (
                    <p className="mt-2 rounded border border-border bg-input/30 px-2 py-1 text-[11px] italic text-foreground/90">
                      {cr.decisionNotes}
                    </p>
                  )}
                </div>
                <span
                  className={clsx(
                    'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                    STATUS_TONE[cr.status],
                  )}
                >
                  {cr.status}
                </span>
              </div>

              {/* Acciones */}
              {(cr.status === 'SUBMITTED' || cr.status === 'UNDER_REVIEW') && (
                <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                  {cr.status === 'SUBMITTED' && (
                    <button
                      type="button"
                      onClick={() => handleDecide(cr.id, 'UNDER_REVIEW')}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-[11px] font-semibold text-indigo-300 hover:bg-indigo-500/20"
                    >
                      <ClockIcon className="h-3 w-3" /> Mover a Review
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDecide(cr.id, 'APPROVED')}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                  >
                    <Check className="h-3 w-3" /> Aprobar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecide(cr.id, 'REJECTED')}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/20"
                  >
                    <Ban className="h-3 w-3" /> Rechazar
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecide(cr.id, 'DEFERRED')}
                    disabled={isPending}
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/20"
                  >
                    Diferir
                  </button>
                </div>
              )}
              {cr.status === 'APPROVED' && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <button
                    type="button"
                    onClick={() => handleDecide(cr.id, 'IMPLEMENTED')}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-semibold text-violet-300 hover:bg-violet-500/20"
                  >
                    Marcar Implementado
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}
