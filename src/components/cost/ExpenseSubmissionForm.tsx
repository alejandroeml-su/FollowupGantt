'use client'

/**
 * Ola P8 · Equipo P8-3 · Cost Management — Formulario de gasto.
 *
 * Permite a un colaborador crear (DRAFT) y/o someter (SUBMITTED) un
 * `Expense` con receipt URL placeholder (Drive/S3 público hasta P8-4
 * Storage). Validación cliente con zod equivalente al server action;
 * el server vuelve a validar y normalizar la moneda.
 *
 * Strings visibles en español según convención del repo.
 */

import { useState, useTransition } from 'react'
import { z } from 'zod'
import { Save, Send, X } from 'lucide-react'
import { createExpense, submitExpense } from '@/lib/actions/expenses'
import { SUPPORTED_CURRENCIES, isValidIsoCurrency } from '@/lib/cost/expense-types'

export type ExpenseDraft = {
  projectId: string
  taskId: string | null
  description: string
  amount: string // string en el form, parse a number al submit
  currency: string
  receiptUrl: string
  incurredAt: string // yyyy-mm-dd
}

export type ExpenseFormProps = {
  /** Catálogo de proyectos (mínimamente, los que el usuario puede ver). */
  projects: Array<{ id: string; name: string }>
  /** Tareas filtradas por proyecto seleccionado (opcional). */
  tasks?: Array<{ id: string; title: string; projectId: string }>
  /** Usuario que somete el gasto. */
  submittedById: string
  /** Borrador inicial (para edición). */
  initial?: Partial<ExpenseDraft>
  /** Callback tras éxito (id del expense creado). */
  onSubmitted?: (id: string) => void
  onCancel?: () => void
}

const DRAFT_SCHEMA = z.object({
  projectId: z.string().min(1, 'Selecciona un proyecto'),
  taskId: z.string().nullable(),
  description: z.string().trim().min(1, 'La descripción es obligatoria').max(500),
  amount: z
    .string()
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'Importe inválido (usa . como decimal)')
    .refine((v) => Number(v) > 0, 'Importe debe ser > 0'),
  currency: z.string().refine(isValidIsoCurrency, 'Moneda ISO 4217 (3 letras)'),
  receiptUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https?:\/\//i.test(v), 'URL inválida (http/https)'),
  incurredAt: z.string().min(1, 'Fecha del gasto obligatoria'),
})

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ExpenseSubmissionForm(props: ExpenseFormProps) {
  const [draft, setDraft] = useState<ExpenseDraft>({
    projectId: props.initial?.projectId ?? props.projects[0]?.id ?? '',
    taskId: props.initial?.taskId ?? null,
    description: props.initial?.description ?? '',
    amount: props.initial?.amount ?? '',
    currency: props.initial?.currency ?? 'USD',
    receiptUrl: props.initial?.receiptUrl ?? '',
    incurredAt: props.initial?.incurredAt ?? todayIso(),
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function update<K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]): void {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setErrors((e) => {
      const next = { ...e }
      delete next[key as string]
      return next
    })
  }

  function validate(): boolean {
    const parsed = DRAFT_SCHEMA.safeParse(draft)
    if (parsed.success) {
      setErrors({})
      return true
    }
    const map: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? '')
      if (k && !map[k]) map[k] = issue.message
    }
    setErrors(map)
    return false
  }

  function handleSave(submit: boolean): void {
    if (!validate()) return
    setServerError(null)
    startTransition(async () => {
      try {
        const created = await createExpense({
          projectId: draft.projectId,
          taskId: draft.taskId,
          submittedById: props.submittedById,
          description: draft.description,
          amount: Number(draft.amount),
          currency: draft.currency.toUpperCase(),
          receiptUrl: draft.receiptUrl.trim() === '' ? null : draft.receiptUrl.trim(),
          incurredAt: new Date(draft.incurredAt),
        })
        if (submit) {
          await submitExpense(created.id)
        }
        props.onSubmitted?.(created.id)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido'
        setServerError(message)
      }
    })
  }

  const filteredTasks = (props.tasks ?? []).filter(
    (t) => t.projectId === draft.projectId,
  )

  return (
    <form
      className="space-y-3 rounded border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault()
        handleSave(false)
      }}
      aria-label="Formulario de gasto"
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Proyecto</span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={draft.projectId}
            onChange={(e) => update('projectId', e.target.value)}
            aria-invalid={Boolean(errors.projectId)}
          >
            <option value="">— Selecciona —</option>
            {props.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {errors.projectId && <p className="text-xs text-red-500">{errors.projectId}</p>}
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Tarea (opcional)</span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={draft.taskId ?? ''}
            onChange={(e) => update('taskId', e.target.value === '' ? null : e.target.value)}
          >
            <option value="">— Sin tarea —</option>
            {filteredTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Descripción</span>
        <input
          type="text"
          className="w-full rounded border border-border bg-background px-2 py-1"
          value={draft.description}
          onChange={(e) => update('description', e.target.value)}
          aria-invalid={Boolean(errors.description)}
          maxLength={500}
        />
        {errors.description && (
          <p className="text-xs text-red-500">{errors.description}</p>
        )}
      </label>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="font-medium">Importe</span>
          <input
            type="text"
            inputMode="decimal"
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={draft.amount}
            onChange={(e) => update('amount', e.target.value)}
            aria-invalid={Boolean(errors.amount)}
            placeholder="0.00"
          />
          {errors.amount && <p className="text-xs text-red-500">{errors.amount}</p>}
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Moneda</span>
          <select
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={draft.currency}
            onChange={(e) => update('currency', e.target.value)}
            aria-invalid={Boolean(errors.currency)}
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {errors.currency && <p className="text-xs text-red-500">{errors.currency}</p>}
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium">Fecha del gasto</span>
          <input
            type="date"
            className="w-full rounded border border-border bg-background px-2 py-1"
            value={draft.incurredAt}
            onChange={(e) => update('incurredAt', e.target.value)}
            aria-invalid={Boolean(errors.incurredAt)}
          />
          {errors.incurredAt && (
            <p className="text-xs text-red-500">{errors.incurredAt}</p>
          )}
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="font-medium">Recibo (URL opcional)</span>
        <input
          type="url"
          className="w-full rounded border border-border bg-background px-2 py-1"
          placeholder="https://drive.google.com/..."
          value={draft.receiptUrl}
          onChange={(e) => update('receiptUrl', e.target.value)}
          aria-invalid={Boolean(errors.receiptUrl)}
        />
        <span className="text-xs text-muted-foreground">
          Adjunta un link al comprobante. La carga de archivos se habilita en P8-4.
        </span>
        {errors.receiptUrl && (
          <p className="text-xs text-red-500">{errors.receiptUrl}</p>
        )}
      </label>

      {serverError && (
        <p role="alert" className="text-sm text-red-500">
          {serverError}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" aria-hidden /> Guardar borrador
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => handleSave(true)}
          className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden /> Someter
        </button>
        {props.onCancel && (
          <button
            type="button"
            onClick={props.onCancel}
            className="inline-flex items-center gap-1 rounded border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            <X className="h-4 w-4" aria-hidden /> Cancelar
          </button>
        )}
      </div>
    </form>
  )
}
