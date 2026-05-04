'use client'

/**
 * Equipo D2 · Sección de Campos Personalizados embebida en TaskForm.
 *
 * Render dinámico de `CustomFieldDef[]` del proyecto. Soporta dos modos:
 *   - `mode="pending"` (creación): el valor sólo se acumula en estado del
 *     padre via `onValuesChange`. El TaskForm decide cómo persistirlo
 *     después de crear la tarea (HU futura: `bulkSetTaskFieldValues`).
 *   - `mode="persisted"` (edición): cada blur llama a `setTaskFieldValue`
 *     y limpia con `clearTaskFieldValue` cuando el campo queda vacío.
 *
 * Decisiones (D2-CF-1..3):
 *   D2-CF-1: La carga de defs/values se hace una vez al montar y se
 *            mantiene en estado local. Evitamos `useEffect → setState`
 *            usando un loader async con flag `cancelled` y un solo
 *            `setState` final dentro de `startTransition`. (React 19).
 *   D2-CF-2: Cada input controla su propio estado local (string) y se
 *            "commit"ea en blur cuando difiere del initial. Esto evita
 *            que el padre se entere de cada keystroke y mantiene el
 *            componente tolerante a re-renders.
 *   D2-CF-3: Para `pending`, transformamos el record `{fieldId: value}`
 *            a array de pares `[fieldId, key, value]` para que el padre
 *            pueda mapearlo a `bulkSetTaskFieldValues` sin re-leer defs.
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
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

export type LoadedCustomFieldDef = {
  id: string
  key: string
  label: string
  type: FieldType
  required: boolean
  options: FieldOption[]
  position: number
}

export type CustomFieldsValueMap = Record<string, unknown>

interface Props {
  projectId: string
  taskId?: string | null
  /**
   * `pending`: nueva tarea (no hay taskId). Acumula en estado del padre.
   * `persisted`: edita tarea existente. Persiste on-blur.
   */
  mode?: 'pending' | 'persisted'
  /** Defs y values pre-cargados (para tests / RSC). */
  preloadedDefs?: LoadedCustomFieldDef[]
  preloadedValues?: CustomFieldsValueMap
  /** Notificación de cambios (sólo modo `pending`). */
  onValuesChange?: (next: CustomFieldsValueMap) => void
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

function stableValueHash(value: unknown): string {
  if (value === undefined) return 'u'
  try {
    return JSON.stringify(value) ?? 'u'
  } catch {
    return 'err'
  }
}

export function CustomFieldsSection({
  projectId,
  taskId,
  mode = taskId ? 'persisted' : 'pending',
  preloadedDefs,
  preloadedValues,
  onValuesChange,
}: Props) {
  const [defs, setDefs] = useState<LoadedCustomFieldDef[]>(
    preloadedDefs ?? [],
  )
  const [values, setValues] = useState<CustomFieldsValueMap>(
    preloadedValues ?? {},
  )
  const [loading, setLoading] = useState<boolean>(!preloadedDefs)
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [, startTransition] = useTransition()

  // Carga inicial. Patrón "cleanup pattern" (cancelled flag) sin
  // setState-in-effect crítico — sólo un setState final.
  useEffect(() => {
    if (preloadedDefs) return
    let cancelled = false
    void (async () => {
      try {
        const rawDefs = await getFieldDefsForProject(projectId)
        const rawValues = taskId ? await getTaskFieldValues(taskId) : []
        if (cancelled) return
        const mapped: LoadedCustomFieldDef[] = rawDefs.map((d) => ({
          id: d.id,
          key: d.key,
          label: d.label,
          type: d.type as FieldType,
          required: d.required,
          options: asFieldOptions(d.options),
          position: d.position,
        }))
        const valueMap: CustomFieldsValueMap = {}
        for (const v of rawValues) {
          valueMap[v.fieldId] = v.value
        }
        startTransition(() => {
          setDefs(mapped)
          setValues(valueMap)
          setLoading(false)
        })
      } catch {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, taskId, preloadedDefs])

  const sortedDefs = useMemo(
    () => [...defs].sort((a, b) => a.position - b.position),
    [defs],
  )

  const updateLocal = (fieldId: string, nextValue: unknown) => {
    setValues((prev) => {
      const next = { ...prev }
      if (
        nextValue === null ||
        nextValue === undefined ||
        nextValue === '' ||
        (Array.isArray(nextValue) && nextValue.length === 0)
      ) {
        delete next[fieldId]
      } else {
        next[fieldId] = nextValue
      }
      onValuesChange?.(next)
      return next
    })
  }

  const persist = async (def: LoadedCustomFieldDef, nextValue: unknown) => {
    setErrors((e) => ({ ...e, [def.id]: null }))
    if (mode === 'pending' || !taskId) {
      updateLocal(def.id, nextValue)
      return
    }
    try {
      const isEmpty =
        nextValue === null ||
        nextValue === undefined ||
        nextValue === '' ||
        (Array.isArray(nextValue) && nextValue.length === 0)

      if (isEmpty && !def.required) {
        await clearTaskFieldValue(taskId, def.id)
        updateLocal(def.id, null)
        return
      }
      const saved = await setTaskFieldValue(taskId, def.id, nextValue)
      updateLocal(def.id, saved.value)
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
        data-testid="custom-fields-loading"
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
      data-testid="custom-fields-section"
    >
      <h3
        id="custom-fields-heading"
        className="mb-3 flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"
      >
        <Sparkles className="h-4 w-4 text-indigo-400" /> Campos personalizados
      </h3>

      <div className="space-y-4">
        {sortedDefs.map((def) => (
          <CustomFieldInput
            // El `key` incluye un hash del valor persistido para remontar
            // los sub-inputs cuando llega un valor nuevo desde el server.
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

export default CustomFieldsSection

// ─────────────────── Sub-inputs ───────────────────

type InputProps = {
  def: LoadedCustomFieldDef
  value: unknown
  error: string | null
  onCommit: (nextValue: unknown) => void
}

function CustomFieldInput({ def, value, error, onCommit }: InputProps) {
  const inputId = `cf-d2-${def.id}`
  const baseInputClass =
    'w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div
      className="space-y-1.5"
      data-testid={`custom-field-${def.key}`}
    >
      <label
        htmlFor={inputId}
        className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {def.label}
        {def.required && (
          <span className="text-destructive" aria-label="obligatorio">
            {' '}
            *
          </span>
        )}
      </label>

      {def.type === 'TEXT' && (
        <TextInput
          inputId={inputId}
          value={value}
          className={baseInputClass}
          onCommit={onCommit}
        />
      )}
      {def.type === 'NUMBER' && (
        <NumberInput
          inputId={inputId}
          value={value}
          className={baseInputClass}
          onCommit={onCommit}
        />
      )}
      {def.type === 'DATE' && (
        <DateInput
          inputId={inputId}
          value={value}
          className={baseInputClass}
          onCommit={onCommit}
        />
      )}
      {def.type === 'URL' && (
        <UrlInput
          inputId={inputId}
          value={value}
          className={baseInputClass}
          onCommit={onCommit}
        />
      )}
      {def.type === 'BOOLEAN' && (
        <BooleanInput
          inputId={inputId}
          value={value}
          onCommit={onCommit}
        />
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
        <MultiSelectCheckboxes
          inputId={inputId}
          value={value}
          options={def.options}
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

function MultiSelectCheckboxes({
  inputId,
  value,
  options,
  onCommit,
}: {
  inputId: string
  value: unknown
  options: FieldOption[]
  onCommit: (v: unknown) => void
}) {
  const current = useMemo<string[]>(() => {
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === 'string')
    }
    return []
  }, [value])

  const toggle = (optValue: string) => {
    const set = new Set(current)
    if (set.has(optValue)) {
      set.delete(optValue)
    } else {
      set.add(optValue)
    }
    onCommit(Array.from(set))
  }

  return (
    <fieldset
      id={inputId}
      className="space-y-1.5 rounded-md border border-border bg-input/40 p-3"
      data-testid={`${inputId}-group`}
    >
      <legend className="sr-only">Opciones múltiples</legend>
      {options.map((o) => {
        const checked = current.includes(o.value)
        return (
          <label
            key={o.value}
            className="flex items-center gap-2 text-sm text-foreground/90"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(o.value)}
              className="h-4 w-4 rounded border-border bg-input"
            />
            <span>{o.label}</span>
          </label>
        )
      })}
    </fieldset>
  )
}
