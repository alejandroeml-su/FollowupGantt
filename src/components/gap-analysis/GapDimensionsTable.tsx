'use client'

/**
 * US-9.2 · Wave R5 — Tabla editable de dimensiones de un Gap Analysis.
 *
 * Permite:
 *   - Agregar dimensiones AUTO (catálogo) o MANUAL.
 *   - Editar AS-IS / TO-BE / peso / notas en línea (blur → server action).
 *   - Disparar "Refresh" para recalcular las dimensiones AUTO.
 *   - Exportar a Excel (server action → base64 → blob).
 *   - Vincular acciones (tareas existentes o texto libre).
 *
 * Decisión: no auto-recalculamos AUTO en cada render (sería costoso y
 * generaría latencia inesperada al abrir la página). El refresh es
 * explícito vía botón — restricción del entregable.
 */

import { useState, useTransition, useMemo } from 'react'
import {
  RefreshCw,
  Plus,
  FileSpreadsheet,
  Trash2,
  AlertCircle,
  Link2,
} from 'lucide-react'
import {
  addDimension,
  updateDimension,
  removeDimension,
  linkDimensionToTask,
  removeDimensionAction,
  recalculateAutoMetrics,
  exportGapAnalysisExcel,
} from '@/lib/actions/gap-analysis'
import type {
  SerializedGapAnalysis,
  SerializedGapDimension,
  GapColor,
} from '@/lib/gap-analysis/types'

type AutoMetricView = {
  key: string
  label: string
  defaultToBe: number
  unit: string
  description: string
  direction: 'higher-is-better' | 'lower-is-better'
}

type Props = {
  gap: SerializedGapAnalysis
  autoMetricsCatalog: AutoMetricView[]
  projectTasks: Array<{ id: string; title: string; mnemonic: string | null }>
}

const COLOR_CLASS: Record<GapColor, string> = {
  green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  red: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/40',
  neutral: 'bg-muted text-muted-foreground border-border',
}

const COLOR_LABEL: Record<GapColor, string> = {
  green: 'Objetivo alcanzado',
  amber: 'Gap moderado (≤ 25%)',
  red: 'Gap crítico (> 25%)',
  neutral: 'Sin valor comparable',
}

export default function GapDimensionsTable({
  gap,
  autoMetricsCatalog,
  projectTasks,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [actionFor, setActionFor] = useState<SerializedGapDimension | null>(
    null,
  )

  // Form state · agregar dimensión
  const [newKind, setNewKind] = useState<'AUTO' | 'MANUAL'>('MANUAL')
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newMetricKey, setNewMetricKey] = useState('')
  const [newToBe, setNewToBe] = useState<string>('')
  const [newUnit, setNewUnit] = useState<string>('')
  const [newWeight, setNewWeight] = useState<string>('')

  // Form state · vincular acción
  const [actionTaskId, setActionTaskId] = useState<string>('')
  const [actionFreeText, setActionFreeText] = useState<string>('')

  const autoMap = useMemo(
    () => new Map(autoMetricsCatalog.map((m) => [m.key, m])),
    [autoMetricsCatalog],
  )

  function asyncRun(fn: () => Promise<unknown>) {
    setError(null)
    startTransition(async () => {
      try {
        await fn()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  function handleRefresh() {
    asyncRun(() => recalculateAutoMetrics(gap.id))
  }

  function handleExport() {
    setError(null)
    startTransition(async () => {
      try {
        const { filename, base64 } = await exportGapAnalysisExcel(gap.id)
        // Decodificar base64 a blob y disparar descarga.
        const bin = atob(base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const blob = new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) {
      setError('El nombre de la dimensión es obligatorio')
      return
    }
    if (newKind === 'AUTO' && !newMetricKey) {
      setError('Selecciona la métrica automática')
      return
    }
    const toBeNum = newToBe ? Number(newToBe) : null
    const weightNum = newWeight ? Number(newWeight) : null
    const unit =
      newKind === 'AUTO' && newMetricKey
        ? autoMap.get(newMetricKey)?.unit ?? null
        : newUnit || null

    asyncRun(async () => {
      await addDimension({
        gapAnalysisId: gap.id,
        name: newName.trim(),
        category: newCategory.trim() || null,
        kind: newKind,
        metricKey: newKind === 'AUTO' ? newMetricKey : null,
        toBeValue:
          toBeNum != null && !Number.isNaN(toBeNum) ? toBeNum : null,
        unit,
        weight:
          weightNum != null && !Number.isNaN(weightNum) ? weightNum : null,
      })
      setNewName('')
      setNewCategory('')
      setNewMetricKey('')
      setNewToBe('')
      setNewUnit('')
      setNewWeight('')
      setAdding(false)
    })
  }

  function handleInlineUpdate(
    dim: SerializedGapDimension,
    patch: Parameters<typeof updateDimension>[1],
  ) {
    asyncRun(() => updateDimension(dim.id, patch))
  }

  function handleRemove(dim: SerializedGapDimension) {
    if (!confirm(`¿Eliminar la dimensión "${dim.name}"?`)) return
    asyncRun(() => removeDimension(dim.id))
  }

  function handleAddAction(e: React.FormEvent) {
    e.preventDefault()
    if (!actionFor) return
    if (!actionTaskId && !actionFreeText.trim()) {
      setError('Selecciona una tarea o escribe un texto')
      return
    }
    const dimId = actionFor.id
    asyncRun(async () => {
      await linkDimensionToTask({
        dimensionId: dimId,
        taskId: actionTaskId || null,
        freeText: actionFreeText.trim() || null,
      })
      setActionTaskId('')
      setActionFreeText('')
      setActionFor(null)
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Dimensiones</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isPending}
            className="inline-flex h-7 items-center gap-1 rounded border px-2 text-xs disabled:opacity-60"
            title="Recalcula los valores AS-IS de las dimensiones AUTO"
          >
            <RefreshCw
              className={
                'h-3 w-3 ' + (isPending ? 'animate-spin' : '')
              }
              aria-hidden
            />
            Refresh AUTO
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={isPending}
            className="inline-flex h-7 items-center gap-1 rounded border px-2 text-xs disabled:opacity-60"
          >
            <FileSpreadsheet className="h-3 w-3" aria-hidden />
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1 rounded bg-primary px-2 text-xs text-primary-foreground"
          >
            <Plus className="h-3 w-3" aria-hidden />
            Agregar
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-1 rounded border border-destructive/60 bg-destructive/10 p-2 text-xs text-destructive"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {gap.dimensions.length === 0 ? (
        <div className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">
          Aún no hay dimensiones. Usa “Agregar” para empezar.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th className="px-1 py-1 text-left">Dimensión</th>
                <th className="px-1 py-1 text-left">Tipo</th>
                <th className="px-1 py-1 text-right">AS-IS</th>
                <th className="px-1 py-1 text-right">TO-BE</th>
                <th className="px-1 py-1 text-right">Gap</th>
                <th className="px-1 py-1 text-center">Estado</th>
                <th className="px-1 py-1 text-left">Acciones</th>
                <th className="px-1 py-1" />
              </tr>
            </thead>
            <tbody>
              {gap.dimensions.map((d) => (
                <tr key={d.id} className="border-b align-top">
                  <td className="px-1 py-1.5">
                    <div className="font-medium">{d.name}</div>
                    {d.category && (
                      <div className="text-[10px] text-muted-foreground">
                        {d.category}
                      </div>
                    )}
                    {d.kind === 'AUTO' && d.metricKey && (
                      <div className="text-[10px] text-muted-foreground">
                        {autoMap.get(d.metricKey)?.label ?? d.metricKey}
                      </div>
                    )}
                  </td>
                  <td className="px-1 py-1.5">
                    <span
                      className={
                        'rounded px-1.5 py-0.5 text-[10px] ' +
                        (d.kind === 'AUTO'
                          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                          : 'bg-muted text-muted-foreground')
                      }
                    >
                      {d.kind}
                    </span>
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    {d.kind === 'AUTO' ? (
                      <span className="font-mono">
                        {d.asIsValue != null
                          ? d.asIsValue.toFixed(2)
                          : '—'}
                      </span>
                    ) : (
                      <input
                        type="number"
                        defaultValue={d.asIsValue ?? ''}
                        step="any"
                        onBlur={(e) => {
                          const v = e.target.value
                          const num = v === '' ? null : Number(v)
                          if (num !== d.asIsValue) {
                            handleInlineUpdate(d, {
                              asIsValue:
                                num != null && !Number.isNaN(num)
                                  ? num
                                  : null,
                            })
                          }
                        }}
                        className="w-16 rounded border bg-background px-1 text-right"
                        aria-label={`AS-IS de ${d.name}`}
                      />
                    )}
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    <input
                      type="number"
                      defaultValue={d.toBeValue ?? ''}
                      step="any"
                      onBlur={(e) => {
                        const v = e.target.value
                        const num = v === '' ? null : Number(v)
                        if (num !== d.toBeValue) {
                          handleInlineUpdate(d, {
                            toBeValue:
                              num != null && !Number.isNaN(num)
                                ? num
                                : null,
                          })
                        }
                      }}
                      className="w-16 rounded border bg-background px-1 text-right"
                      aria-label={`TO-BE de ${d.name}`}
                    />
                    {d.unit && (
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {d.unit}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-1.5 text-right font-mono">
                    {d.gap != null ? d.gap.toFixed(2) : '—'}
                  </td>
                  <td className="px-1 py-1.5 text-center">
                    <span
                      title={COLOR_LABEL[d.color]}
                      className={
                        'inline-block rounded-full border px-2 py-0.5 text-[10px] ' +
                        COLOR_CLASS[d.color]
                      }
                    >
                      {d.color === 'green'
                        ? 'OK'
                        : d.color === 'amber'
                        ? 'Mod.'
                        : d.color === 'red'
                        ? 'Crít.'
                        : '—'}
                    </span>
                  </td>
                  <td className="px-1 py-1.5">
                    <ul className="space-y-0.5">
                      {d.actions.map((a) => (
                        <li
                          key={a.id}
                          className="flex items-center gap-1 text-[11px]"
                        >
                          <span
                            className="truncate"
                            title={a.taskTitle ?? a.freeText ?? ''}
                          >
                            {a.taskTitle ?? a.freeText ?? '—'}
                          </span>
                          <span className="text-muted-foreground">
                            [{a.status}]
                          </span>
                          <button
                            type="button"
                            aria-label="Eliminar acción"
                            onClick={() =>
                              asyncRun(() => removeDimensionAction(a.id))
                            }
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => setActionFor(d)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      <Link2 className="h-3 w-3" aria-hidden />
                      Vincular
                    </button>
                  </td>
                  <td className="px-1 py-1.5">
                    <button
                      type="button"
                      onClick={() => handleRemove(d)}
                      aria-label={`Eliminar ${d.name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal · Agregar dimensión ── */}
      {adding && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gap-add-dim-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAdding(false)
          }}
        >
          <form
            onSubmit={handleAdd}
            className="w-full max-w-md space-y-3 rounded-lg border bg-card p-4 shadow-lg"
          >
            <h3 id="gap-add-dim-title" className="text-sm font-semibold">
              Agregar dimensión
            </h3>
            <fieldset className="flex gap-3 text-xs">
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="kind"
                  checked={newKind === 'MANUAL'}
                  onChange={() => setNewKind('MANUAL')}
                />
                Manual (ingreso del analista)
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="kind"
                  checked={newKind === 'AUTO'}
                  onChange={() => setNewKind('AUTO')}
                />
                Automática (catálogo)
              </label>
            </fieldset>

            {newKind === 'AUTO' && (
              <label className="block">
                <span className="text-xs text-muted-foreground">
                  Métrica automática
                </span>
                <select
                  value={newMetricKey}
                  onChange={(e) => {
                    const k = e.target.value
                    setNewMetricKey(k)
                    const def = autoMap.get(k)
                    if (def) {
                      if (!newName) setNewName(def.label)
                      setNewUnit(def.unit)
                      setNewToBe(String(def.defaultToBe))
                    }
                  }}
                  className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
                >
                  <option value="">Selecciona…</option>
                  {autoMetricsCatalog.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {newMetricKey && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {autoMap.get(newMetricKey)?.description}
                  </p>
                )}
              </label>
            )}

            <label className="block">
              <span className="text-xs text-muted-foreground">Nombre</span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                maxLength={200}
                className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">
                Categoría (opcional)
              </span>
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Ej. Procesos, Personas, Tecnología"
                maxLength={80}
                className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-muted-foreground">
                  TO-BE (objetivo)
                </span>
                <input
                  type="number"
                  step="any"
                  value={newToBe}
                  onChange={(e) => setNewToBe(e.target.value)}
                  className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Unidad</span>
                <input
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                  placeholder="%, pts, días"
                  maxLength={20}
                  className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-xs text-muted-foreground">
                Peso 1-10 (opcional)
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={newWeight}
                onChange={(e) => setNewWeight(e.target.value)}
                className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
              />
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdding(false)}
                disabled={isPending}
                className="h-8 rounded border px-3 text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="h-8 rounded bg-primary px-3 text-xs font-medium text-primary-foreground"
              >
                {isPending ? 'Agregando…' : 'Agregar'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Modal · Vincular acción ── */}
      {actionFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gap-action-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setActionFor(null)
          }}
        >
          <form
            onSubmit={handleAddAction}
            className="w-full max-w-md space-y-3 rounded-lg border bg-card p-4 shadow-lg"
          >
            <h3 id="gap-action-title" className="text-sm font-semibold">
              Vincular acción a “{actionFor.name}”
            </h3>
            <label className="block">
              <span className="text-xs text-muted-foreground">
                Tarea existente (opcional)
              </span>
              <select
                value={actionTaskId}
                onChange={(e) => setActionTaskId(e.target.value)}
                className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
              >
                <option value="">— Sin tarea (usar texto libre) —</option>
                {projectTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.mnemonic ? `${t.mnemonic} · ` : ''}
                    {t.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">
                Acción en texto libre (alternativa)
              </span>
              <textarea
                value={actionFreeText}
                onChange={(e) => setActionFreeText(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Ej. Capacitar al equipo en ITIL v4"
                className="mt-1 block w-full rounded border bg-background p-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionFor(null)}
                disabled={isPending}
                className="h-8 rounded border px-3 text-xs"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="h-8 rounded bg-primary px-3 text-xs font-medium text-primary-foreground"
              >
                {isPending ? 'Guardando…' : 'Vincular'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
