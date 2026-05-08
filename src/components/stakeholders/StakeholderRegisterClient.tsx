'use client'

/**
 * Wave P11-PMI (HU-12.2) — Stakeholder Register UI MVP.
 * Lista + form inline para crear · grid poder×interés (Mendelow).
 */

import { useState, useTransition } from 'react'
import { Users, Plus, X as CloseIcon, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import {
  createStakeholder,
  deleteStakeholder,
  suggestEngagementStrategy,
} from '@/lib/actions/stakeholders'
import { toast } from '@/components/interactions/Toaster'

type Level = 'LOW' | 'MEDIUM' | 'HIGH'
type Influence = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE'

type Stakeholder = {
  id: string
  name: string
  organization: string | null
  email: string | null
  role: string
  power: Level
  interest: Level
  influence: Influence
  expectations: string | null
  engagementStrategy: string | null
  notes: string | null
}

type Props = {
  projectId: string
  projectName: string
  stakeholders: Stakeholder[]
}

const LEVEL_TONE: Record<Level, string> = {
  LOW: 'bg-slate-500/15 text-slate-300',
  MEDIUM: 'bg-amber-500/15 text-amber-300',
  HIGH: 'bg-rose-500/15 text-rose-300',
}

const INFLUENCE_TONE: Record<Influence, string> = {
  POSITIVE: 'bg-emerald-500/15 text-emerald-300',
  NEUTRAL: 'bg-slate-500/15 text-slate-300',
  NEGATIVE: 'bg-rose-500/15 text-rose-300',
}

const ROLE_OPTIONS = [
  'Sponsor',
  'Customer',
  'Team',
  'Vendor',
  'Regulator',
  'End User',
  'Other',
]

export function StakeholderRegisterClient({
  projectId,
  stakeholders,
}: Props) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '',
    organization: '',
    email: '',
    role: 'Customer',
    power: 'MEDIUM' as Level,
    interest: 'MEDIUM' as Level,
    influence: 'NEUTRAL' as Influence,
    expectations: '',
    notes: '',
  })
  const [isPending, startTransition] = useTransition()

  const handleSubmit = () => {
    if (!form.name.trim() || !form.role.trim()) {
      toast.error('Name + Role requeridos')
      return
    }
    startTransition(async () => {
      try {
        await createStakeholder({
          projectId,
          name: form.name.trim(),
          organization: form.organization.trim() || null,
          email: form.email.trim() || null,
          role: form.role.trim(),
          power: form.power,
          interest: form.interest,
          influence: form.influence,
          expectations: form.expectations.trim() || null,
          engagementStrategy: suggestEngagementStrategy(form.power, form.interest),
          notes: form.notes.trim() || null,
        })
        toast.success('Stakeholder agregado al register')
        setShowForm(false)
        setForm({
          name: '',
          organization: '',
          email: '',
          role: 'Customer',
          power: 'MEDIUM',
          interest: 'MEDIUM',
          influence: 'NEUTRAL',
          expectations: '',
          notes: '',
        })
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`¿Quitar a "${name}" del register?`)) return
    startTransition(async () => {
      try {
        await deleteStakeholder(id)
        toast.success('Stakeholder removido')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  // Matriz Mendelow 2x2: power (Y) × interest (X)
  const grid: Record<string, Stakeholder[]> = {
    'HIGH_HIGH': [],
    'HIGH_MEDIUM': [],
    'HIGH_LOW': [],
    'MEDIUM_HIGH': [],
    'MEDIUM_MEDIUM': [],
    'MEDIUM_LOW': [],
    'LOW_HIGH': [],
    'LOW_MEDIUM': [],
    'LOW_LOW': [],
  }
  for (const s of stakeholders) {
    const k = `${s.power}_${s.interest}`
    if (grid[k]) grid[k].push(s)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-indigo-400" />
          <div>
            <h2 className="text-base font-bold text-foreground">
              Stakeholder Register
            </h2>
            <p className="text-xs text-muted-foreground">
              {stakeholders.length} stakeholder
              {stakeholders.length === 1 ? '' : 's'} · matriz Mendelow
              poder×interés
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          <Plus className="h-3.5 w-3.5" /> Agregar
        </button>
      </header>

      {/* Form inline */}
      {showForm && (
        <section className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Nuevo stakeholder</h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              aria-label="Cerrar"
              className="rounded p-1 text-muted-foreground hover:bg-secondary"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre *">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej. Edwin Martinez"
                className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
              />
            </Field>
            <Field label="Organización">
              <input
                type="text"
                value={form.organization}
                onChange={(e) => setForm({ ...form, organization: e.target.value })}
                placeholder="Avante · Cliente X · …"
                className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
              />
            </Field>
            <Field label="Rol *">
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Power">
              <select
                value={form.power}
                onChange={(e) =>
                  setForm({ ...form, power: e.target.value as Level })
                }
                className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </Field>
            <Field label="Interest">
              <select
                value={form.interest}
                onChange={(e) =>
                  setForm({ ...form, interest: e.target.value as Level })
                }
                className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
              </select>
            </Field>
            <Field label="Influence">
              <select
                value={form.influence}
                onChange={(e) =>
                  setForm({ ...form, influence: e.target.value as Influence })
                }
                className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
              >
                <option value="POSITIVE">POSITIVE</option>
                <option value="NEUTRAL">NEUTRAL</option>
                <option value="NEGATIVE">NEGATIVE</option>
              </select>
            </Field>
          </div>

          <Field label="Expectativas / requisitos">
            <textarea
              value={form.expectations}
              onChange={(e) => setForm({ ...form, expectations: e.target.value })}
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
            />
          </Field>

          <p className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-[11px] text-indigo-300">
            Estrategia sugerida: <strong>{suggestEngagementStrategy(form.power, form.interest)}</strong>
          </p>

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
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {isPending ? 'Agregando…' : 'Agregar al register'}
            </button>
          </div>
        </section>
      )}

      {/* Matriz Mendelow 3×3 */}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Matriz Power × Interest (Mendelow)
        </h3>
        <div className="grid grid-cols-[auto_repeat(3,1fr)] gap-1 text-[10px]">
          <div />
          <div className="text-center font-semibold text-muted-foreground">
            Interest LOW
          </div>
          <div className="text-center font-semibold text-muted-foreground">
            Interest MEDIUM
          </div>
          <div className="text-center font-semibold text-muted-foreground">
            Interest HIGH
          </div>
          {(['HIGH', 'MEDIUM', 'LOW'] as const).map((p) => (
            <>
              <div
                key={`label-${p}`}
                className="flex items-center justify-end pr-1 text-[10px] font-semibold text-muted-foreground"
              >
                Power {p}
              </div>
              {(['LOW', 'MEDIUM', 'HIGH'] as const).map((i) => {
                const list = grid[`${p}_${i}`] ?? []
                const strategy = suggestEngagementStrategy(p, i)
                return (
                  <div
                    key={`cell-${p}-${i}`}
                    className={clsx(
                      'min-h-[80px] rounded border p-1.5',
                      list.length > 0
                        ? 'border-indigo-500/30 bg-indigo-500/5'
                        : 'border-border/40 bg-input/20',
                    )}
                  >
                    <p className="text-[8px] uppercase tracking-wider text-muted-foreground/70">
                      {strategy}
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {list.slice(0, 4).map((s) => (
                        <div
                          key={s.id}
                          className="truncate rounded bg-card px-1.5 py-0.5 text-[10px] text-foreground"
                          title={`${s.name} · ${s.role}`}
                        >
                          {s.name}
                        </div>
                      ))}
                      {list.length > 4 && (
                        <div className="text-[9px] italic text-muted-foreground">
                          +{list.length - 4} más
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </>
          ))}
        </div>
      </section>

      {/* Lista detallada */}
      {stakeholders.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Detalle ({stakeholders.length})
          </h3>
          <ul className="space-y-1.5">
            {stakeholders.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs"
              >
                <span className="font-semibold text-foreground">{s.name}</span>
                {s.organization && (
                  <span className="text-muted-foreground">· {s.organization}</span>
                )}
                <span className="rounded-full bg-input/60 px-1.5 py-0.5 text-[10px] text-foreground">
                  {s.role}
                </span>
                <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px]', LEVEL_TONE[s.power])}>
                  P:{s.power}
                </span>
                <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px]', LEVEL_TONE[s.interest])}>
                  I:{s.interest}
                </span>
                <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px]', INFLUENCE_TONE[s.influence])}>
                  {s.influence}
                </span>
                {s.engagementStrategy && (
                  <span className="text-[10px] italic text-muted-foreground">
                    ({s.engagementStrategy})
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(s.id, s.name)}
                  aria-label={`Quitar ${s.name}`}
                  className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary hover:text-rose-400"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        </section>
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
