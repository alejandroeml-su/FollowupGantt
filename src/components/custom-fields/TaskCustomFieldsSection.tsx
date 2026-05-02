'use client'

/**
 * Ola P1 · Equipo 3 — Sección de Custom Fields dentro del Task Drawer.
 *
 * Renderiza un input por cada `CustomFieldDef` del proyecto. Los inputs
 * son específicos por tipo (text/number/date/checkbox/select/multi/url) y
 * persisten on-blur (auto-save) llamando a `setTaskFieldValue` /
 * `clearTaskFieldValue`.
 *
 * Decisiones autónomas:
 *   D-CF-UI-1: cargamos defs + values al montar y mantenemos estado local.
 *              No hay router refresh tras mutar el value: el resto del
 *              drawer no depende de éste y los toasts son suficientes para
 *              feedback. Esto evita loops `revalidatePath → refetch`.
 *   D-CF-UI-2: si el campo está marcado como `required` y el usuario lo
 *              vacía, mostramos el error inline pero NO bloqueamos al
 *              resto del formulario — el server action ya rechaza. La UX
 *              de "obligatoriedad efectiva" la veremos en validación de
 *              cierre de tarea (HU futura, fuera de alcance).
 *   D-CF-UI-3: para MULTI_SELECT usamos un `<select multiple>` nativo —
 *              accesible por defecto, sin nuevas dependencias. La UX de
 *              "tags chip" puede llegar más adelante reutilizando el
 *              componente `TagChipInput` existente.
 */

import { useEffect, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import {
  clearTaskFieldValue,
  getFieldDefsForProject,
  getTaskFieldValues,
  setTaskFieldValue,
} from '@/lib/actions/custom-fields'

type FieldType =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'URL'

type FieldOption = { value: string; label: string }

type LoadedDef = {
  id: string
  key: string
  label: string
  type: FieldType
  required: boolean
  options: FieldOption[]
  position: number
}

type Props = {
  taskId: string
  projectId: string
  /**
   * Opcional: en pruebas inyectamos los defs/values pre-cargados para no
   * tener que mockear acciones. En runtime los cargamos vía effect.
   */
  preloadedDefs?: LoadedDef[]
  preloadedValues?: Record<string, unknown>
}

/**
 * Hash mínimo (no criptográfico) para usar como sufijo de `key` en los
 * sub-inputs. Sólo necesita ser estable para una misma representación
 * lógica del valor; `JSON.stringify` cumple.
 */
function stableValueHash(value: unknown): string {
  if (value === undefined) return 'u'
  try {
    return JSON.stringify(value) ?? 'u'
  } catch {
    return 'err'
  }
}

function asFieldOptions(raw: unknown): FieldOption[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((o) => {
      if (
        o &&
        typeof o === 'object' &&
        'value' in o &&
        'label' in o &&
        typeof (o as { value: unknown }).value === 'string' &&
        typeof (o as { label: unknown }).label === 'string'
      ) {
        return {
          value: (o as { value: string }).value,
          label: (o as { label: string }).label,
        }
      }
      return null
    })
    .filter((o): o is FieldOption => o !== null)
}

export function TaskCustomFieldsSection({
  taskId,
  projectId,
  preloadedDefs,
  preloadedValues,
}: Props) {
  const [defs, setDefs] = useState<LoadedDef[]>(preloadedDefs ?? [])
  const [values, setValues] = useState<Record<string, unknown>>(
    preloadedValues ?? {},
  )
  const [loading, setLoading] = useState<boolean>(!preloadedDefs)
  const [errors, setErrors] = useState<Record<string, string | null>>({})

  // Carga inicial: defs por proyecto + values de la tarea.
  useEffect(() => {
    if (preloadedDefs) return
    let cancelled = false
    const run = async () => {
      try {
        const [rawDefs, rawValues] = await Promise.all([
          getFieldDefsForProject(projectId),
          getTaskFieldValues(taskId),
        ])
        if (cancelled) return
        const mapped: LoadedDef[] = rawDefs.map((d) => ({
          id: d.id,
          key: d.key,
          label: d.label,
          type: d.type as FieldType,
          required: d.required,
          options: asFieldOptions(d.options),
          position: d.position,
        }))
        const valueMap: Record<string, unknown> = {}
        for (const v of rawValues) {
          valueMap[v.fieldId] = v.value
        }
        setDefs(mapped)
        setValues(valueMap)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [projectId, taskId, preloadedDefs])

  const sortedDefs = useMemo(
    () => [...defs].sort((a, b) => a.position - b.position),
    [defs],
  )

  const persist = async (def: LoadedDef, nextValue: unknown) => {
    setErrors((e) => ({ ...e, [def.id]: null }))
    try {
      const isEmpty =
        nextValue === null ||
        nextValue === undefined ||
        nextValue === '' ||
        (Array.isArray(nextValue) && nextValue.length === 0)

      if (isEmpty && !def.required) {
        await clearTaskFieldValue(taskId, def.id)
        setValues((v) => {
          const next = { ...v }
          delete next[def.id]
          return next
        })
        return
      }

      const saved = await setTaskFieldValue(taskId, def.id, nextValue)
      setValues((v) => ({ ...v, [def.id]: saved.value }))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error guardando'
      setErrors((e) => ({ ...e, [def.id]: msg }))
    }
  }

  if (loading) {
    return (
      <section
        aria-labelledby="custom-fields-heading"
        className="pt-4 text-sm text-muted-foreground"
        data-testid="task-custom-fields-loading"
      >
        Cargando campos personalizados…
      </section>
    )
  }

  if (sortedDefs.length === 0) return null

  return (
    <section
      aria-labelledby="custom-fields-heading"
      className="pt-4"
      data-testid="task-custom-fields-section"
    >
      <h3
        id="custom-fields-heading"
        className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <Sparkles className="h-4 w-4 text-indigo-400" /> Campos personalizados
      </h3>

      <div className="space-y-4">
        {sortedDefs.map((def) => (
          // Anti-eslint `react-hooks/set-state-in-effect`: el `key` incluye
          // un hash del valor persistido, así los sub-inputs se remontan
          // cuando llega un valor nuevo desde el server (autosave de otro
          // tab/usuario o tras blur). Esto reemplaza el patrón
          // `useEffect → setState(value)` que React 19 desaconseja.
          <CustomFieldInput
            key={`${def.id}-${stableValueHash(values[def.id])}`}
            def={def}
            value={values[def.id]}
            error={errors[def.id] ?? null}
            onCommit={(next) => persist(def, next)}
          />
        ))}
      </div>
    </section>
  )
}

// ─────────────────────── Input por tipo ───────────────────────

type InputProps = {
  def: LoadedDef
  value: unknown
  error: string | null
  onCommit: (nextValue: unknown) => void
}

function CustomFieldInput({ def, value, error, onCommit }: InputProps) {
  const inputId = `cf-${def.id}`
  const baseInputClass =
    'w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring'

  const labelNode = (
    <label
      htmlFor={inputId}
      className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
    >
      {def.label}
      {def.required && <span className="text-destructive"> *</span>}
    </label>
  )

  return (
    <div className="space-y-1.5" data-testid={`task-custom-field-${def.key}`}>
      {labelNode}
      {def.type === 'TEXT' && (
        <TextInput inputId={inputId} value={value} className={baseInputClass} onCommit={onCommit} />
      )}
      {def.type === 'NUMBER' && (
        <NumberInput inputId={inputId} value={value} className={baseInputClass} onCommit={onCommit} />
      )}
      {def.type === 'DATE' && (
        <DateInput inputId={inputId} value={value} className={baseInputClass} onCommit={onCommit} />
      )}
      {def.type === 'URL' && (
        <UrlInput inputId={inputId} value={value} className={baseInputClass} onCommit={onCommit} />
      )}
      {def.type === 'BOOLEAN' && (
        <BooleanInput inputId={inputId} value={value} onCommit={onCommit} />
      )}
      {def.type === 'SELECT' && (
        <SelectInput
          inputId={inputId}
          value={value}
          options={def.options}
          required={def.required}
          className={baseInputClass}
          onCommit={onCommit}
        />
      )}
      {def.type === 'MULTI_SELECT' && (
        <MultiSelectInput
          inputId={inputId}
          value={value}
          options={def.options}
          className={baseInputClass}
          onCommit={onCommit}
        />
      )}
      {error && (
        <p className="text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function TextInput({
  inputId,
  value,
  className,
  onCommit,
}: {
  inputId: string
  value: unknown
  className: string
  onCommit: (v: unknown) => void
}) {
  // El componente se remonta vía `key` cuando cambia `value` (ver
  // `TaskCustomFieldsSection`), por lo que el estado local no necesita
  // sincronizarse con un effect.
  const initial = typeof value === 'string' ? value : ''
  const [local, setLocal] = useState<string>(initial)
  return (
    <input
      id={inputId}
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== initial) onCommit(local)
      }}
      className={className}
    />
  )
}

function NumberInput({
  inputId,
  value,
  className,
  onCommit,
}: {
  inputId: string
  value: unknown
  className: string
  onCommit: (v: unknown) => void
}) {
  const initial = typeof value === 'number' ? String(value) : ''
  const [local, setLocal] = useState<string>(initial)
  return (
    <input
      id={inputId}
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local === '') {
          if (initial !== '') onCommit(null)
          return
        }
        const num = Number(local)
        if (!Number.isFinite(num)) return
        if (num !== value) onCommit(num)
      }}
      className={className}
    />
  )
}

function DateInput({
  inputId,
  value,
  className,
  onCommit,
}: {
  inputId: string
  value: unknown
  className: string
  onCommit: (v: unknown) => void
}) {
  const initial = typeof value === 'string' ? value.slice(0, 10) : ''
  const [local, setLocal] = useState<string>(initial)
  return (
    <input
      id={inputId}
      type="date"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== initial) onCommit(local || null)
      }}
      className={className}
    />
  )
}

function UrlInput({
  inputId,
  value,
  className,
  onCommit,
}: {
  inputId: string
  value: unknown
  className: string
  onCommit: (v: unknown) => void
}) {
  const initial = typeof value === 'string' ? value : ''
  const [local, setLocal] = useState<string>(initial)
  return (
    <input
      id={inputId}
      type="url"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== initial) onCommit(local)
      }}
      placeholder="https://…"
      className={className}
    />
  )
}

function BooleanInput({
  inputId,
  value,
  onCommit,
}: {
  inputId: string
  value: unknown
  onCommit: (v: unknown) => void
}) {
  const checked = value === true
  return (
    <div className="flex items-center gap-2">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onCommit(e.target.checked)}
        className="h-4 w-4 rounded border-border bg-input"
      />
      <span className="text-sm text-muted-foreground">
        {checked ? 'Sí' : 'No'}
      </span>
    </div>
  )
}

function SelectInput({
  inputId,
  value,
  options,
  required,
  className,
  onCommit,
}: {
  inputId: string
  value: unknown
  options: FieldOption[]
  required: boolean
  className: string
  onCommit: (v: unknown) => void
}) {
  const current = typeof value === 'string' ? value : ''
  return (
    <select
      id={inputId}
      value={current}
      onChange={(e) => {
        const next = e.target.value
        onCommit(next === '' ? null : next)
      }}
      className={className}
    >
      {!required && <option value="">— Sin valor —</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function MultiSelectInput({
  inputId,
  value,
  options,
  className,
  onCommit,
}: {
  inputId: string
  value: unknown
  options: FieldOption[]
  className: string
  onCommit: (v: unknown) => void
}) {
  const current = Array.isArray(value)
    ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
    : []
  return (
    <select
      id={inputId}
      multiple
      value={current}
      onChange={(e) => {
        const selected = Array.from(e.target.selectedOptions).map((o) => o.value)
        onCommit(selected)
      }}
      className={`${className} min-h-[6rem]`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
