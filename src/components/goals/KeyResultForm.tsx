'use client'

/**
 * Ola P2 · Equipo P2-4 — Formulario de creación de Key Result.
 *
 * Renderiza title, metric, targetValue, currentValue (solo cuando aplica),
 * unit (opcional). Valida en cliente con paridad al server action y
 * dispatcha a `createKeyResult`.
 *
 * Defaults razonables por metric:
 *   - PERCENT          → target=100
 *   - NUMERIC          → target=10 (placeholder)
 *   - BOOLEAN          → target=1, current=0 (no editables)
 *   - TASKS_COMPLETED  → target=100, current=0 (no editables)
 */

import { useState, useTransition } from 'react'
import type { KeyResultMetric } from '@prisma/client'
import { Save, X } from 'lucide-react'
import { createKeyResult } from '@/lib/actions/goals'

type Props = {
  goalId: string
  onSaved?: (id: string) => void
  onCancel?: () => void
}

const METRIC_OPTIONS: Array<{ value: KeyResultMetric; label: string; help: string }> = [
  { value: 'PERCENT', label: 'Porcentaje', help: 'Avance manual 0–100%' },
  { value: 'NUMERIC', label: 'Numérico', help: 'Cantidad con unidad (USD, users…)' },
  { value: 'BOOLEAN', label: 'Sí / No', help: 'Hito completado o pendiente' },
  { value: 'TASKS_COMPLETED', label: 'Tareas completadas', help: 'Derivado de tasks vinculadas' },
]

function defaultTarget(metric: KeyResultMetric): number {
  switch (metric) {
    case 'PERCENT':
      return 100
    case 'NUMERIC':
      return 10
    case 'BOOLEAN':
      return 1
    case 'TASKS_COMPLETED':
      return 100
  }
}

export function KeyResultForm({ goalId, onSaved, onCancel }: Props) {
  const [title, setTitle] = useState('')
  const [metric, setMetric] = useState<KeyResultMetric>('PERCENT')
  const [target, setTarget] = useState<number>(100)
  const [current, setCurrent] = useState<number>(0)
  const [unit, setUnit] = useState<string>('')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function setMetricSafe(m: KeyResultMetric) {
    setMetric(m)
    setTarget(defaultTarget(m))
    setCurrent(0)
    if (m === 'PERCENT') setUnit('%')
    else if (m === 'BOOLEAN' || m === 'TASKS_COMPLETED') setUnit('')
  }

  const isAuto = metric === 'BOOLEAN' || metric === 'TASKS_COMPLETED'

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) {
      setError('El título es obligatorio')
      return
    }
    if (!Number.isFinite(target)) {
      setError('targetValue debe ser un número')
      return
    }
    start(async () => {
      try {
        const { id } = await createKeyResult(goalId, {
          title: title.trim(),
          metric,
          targetValue: target,
          currentValue: isAuto ? 0 : current,
          unit: unit.trim() || null,
        })
        onSaved?.(id)
        // Reset form para añadir más KRs en serie.
        setTitle('')
        setCurrent(0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-3"
      data-testid="kr-form"
    >
      <h4 className="text-xs font-semibold text-foreground">Nuevo resultado clave</h4>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Título</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
          maxLength={200}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Métrica</span>
        <select
          value={metric}
          onChange={(e) => setMetricSafe(e.target.value as KeyResultMetric)}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          {METRIC_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground">
          {METRIC_OPTIONS.find((o) => o.value === metric)?.help}
        </span>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Objetivo</span>
          <input
            type="number"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            disabled={metric === 'BOOLEAN' || metric === 'TASKS_COMPLETED'}
            step="any"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Actual</span>
          <input
            type="number"
            value={current}
            onChange={(e) => setCurrent(Number(e.target.value))}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            disabled={isAuto}
            step="any"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Unidad (opcional)</span>
        <input
          type="text"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
          maxLength={40}
          placeholder="USD, %, users…"
          disabled={metric === 'BOOLEAN' || metric === 'TASKS_COMPLETED'}
        />
      </label>

      {error && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-500">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded border border-border px-3 py-1 text-xs hover:bg-accent"
            disabled={pending}
          >
            <X className="h-3 w-3" />
            Cancelar
          </button>
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-testid="kr-form-submit"
        >
          <Save className="h-3 w-3" />
          {pending ? 'Guardando…' : 'Añadir KR'}
        </button>
      </div>
    </form>
  )
}
