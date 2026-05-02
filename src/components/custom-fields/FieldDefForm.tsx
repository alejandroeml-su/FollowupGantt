'use client'

/**
 * Ola P1 · Equipo 3 — Formulario crear/editar de Custom Field.
 *
 * Renderiza los inputs para `key`, `label`, `type`, `required` y, cuando
 * el tipo lo amerita, una mini-grilla para gestionar `options`. Hace
 * validación zod local equivalente a la del server action para feedback
 * inmediato; al `submit` invoca al action correspondiente y propaga el
 * resultado vía callbacks.
 *
 * Decisión de diseño:
 *   - El componente NO conoce el `projectId` cuando se invoca para editar
 *     (se infiere del def existente en el server action). En modo
 *     creación, el padre lo pasa por prop.
 *   - `key` se auto-deriva del `label` mientras el usuario no lo edite
 *     manualmente; esto simplifica el caso 95% sin restar control.
 */

import { useId, useMemo, useState, useTransition } from 'react'
import { Plus, Save, Trash2, X } from 'lucide-react'
import { z } from 'zod'
import {
  createFieldDef,
  updateFieldDef,
  type CreateFieldDefInput,
} from '@/lib/actions/custom-fields'

export type FieldType =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'SELECT'
  | 'MULTI_SELECT'
  | 'URL'

export type FieldOption = { value: string; label: string }

export type FieldDefDraft = {
  id?: string
  key: string
  label: string
  type: FieldType
  required: boolean
  options: FieldOption[]
}

type Props = {
  projectId: string
  /** Si se pasa, el form arranca en modo edición. */
  initial?: FieldDefDraft
  onSaved?: (id: string) => void
  onCancel?: () => void
}

const TYPE_LABELS: Record<FieldType, string> = {
  TEXT: 'Texto',
  NUMBER: 'Número',
  DATE: 'Fecha',
  BOOLEAN: 'Booleano',
  SELECT: 'Selección única',
  MULTI_SELECT: 'Selección múltiple',
  URL: 'URL',
}

const KEY_REGEX = /^[a-z][a-z0-9_]*$/

const DRAFT_SCHEMA = z
  .object({
    key: z
      .string()
      .min(1, 'La key es obligatoria')
      .max(64)
      .regex(KEY_REGEX, 'Sólo minúsculas, números y "_". Debe iniciar en letra'),
    label: z.string().min(1, 'La etiqueta es obligatoria').max(120),
    type: z.enum([
      'TEXT',
      'NUMBER',
      'DATE',
      'BOOLEAN',
      'SELECT',
      'MULTI_SELECT',
      'URL',
    ]),
    required: z.boolean(),
    options: z
      .array(
        z.object({
          value: z.string().min(1, 'value vacío').max(120),
          label: z.string().min(1, 'label vacío').max(160),
        }),
      )
      .default([]),
  })
  .refine(
    (v) => {
      const needs = v.type === 'SELECT' || v.type === 'MULTI_SELECT'
      return needs ? v.options.length > 0 : true
    },
    { message: 'Debe agregar al menos una opción para listas', path: ['options'] },
  )

function deriveKey(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

const EMPTY_DRAFT: FieldDefDraft = {
  key: '',
  label: '',
  type: 'TEXT',
  required: false,
  options: [],
}

export function FieldDefForm({ projectId, initial, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState<FieldDefDraft>(initial ?? EMPTY_DRAFT)
  const [keyTouched, setKeyTouched] = useState<boolean>(!!initial)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const formId = useId()
  const isEdit = !!initial?.id

  // Auto-deriva la `key` desde la `label` mientras el usuario no edite la
  // key manualmente. Lo hacemos en el handler onChange (en vez de un
  // useEffect → setState, que React 19 desaconseja con
  // `react-hooks/set-state-in-effect`).
  const handleLabelChange = (nextLabel: string) => {
    setDraft((d) => ({
      ...d,
      label: nextLabel,
      key: keyTouched ? d.key : deriveKey(nextLabel),
    }))
  }

  const needsOptions = draft.type === 'SELECT' || draft.type === 'MULTI_SELECT'

  const addOption = () => {
    setDraft((d) => ({
      ...d,
      options: [...d.options, { value: '', label: '' }],
    }))
  }
  const removeOption = (idx: number) => {
    setDraft((d) => ({ ...d, options: d.options.filter((_, i) => i !== idx) }))
  }
  const patchOption = (idx: number, patch: Partial<FieldOption>) => {
    setDraft((d) => ({
      ...d,
      options: d.options.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
    }))
  }

  const validate = useMemo(() => {
    return () => {
      const cleaned = {
        ...draft,
        options: needsOptions ? draft.options : [],
      }
      return DRAFT_SCHEMA.safeParse(cleaned)
    }
  }, [draft, needsOptions])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = validate()
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '))
      return
    }
    setError(null)

    startTransition(async () => {
      try {
        if (isEdit && initial?.id) {
          const updated = await updateFieldDef(initial.id, {
            key: parsed.data.key,
            label: parsed.data.label,
            type: parsed.data.type,
            required: parsed.data.required,
            options: needsOptions ? parsed.data.options : undefined,
          })
          onSaved?.(updated.id)
        } else {
          const input: CreateFieldDefInput = {
            key: parsed.data.key,
            label: parsed.data.label,
            type: parsed.data.type,
            required: parsed.data.required,
            options: needsOptions ? parsed.data.options : undefined,
          }
          const created = await createFieldDef(projectId, input)
          onSaved?.(created.id)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error desconocido'
        setError(msg)
      }
    })
  }

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      data-testid="custom-field-def-form"
      className="space-y-5"
    >
      {/* Etiqueta */}
      <div className="space-y-1.5">
        <label
          htmlFor={`${formId}-label`}
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Etiqueta <span className="text-destructive">*</span>
        </label>
        <input
          id={`${formId}-label`}
          type="text"
          value={draft.label}
          onChange={(e) => handleLabelChange(e.target.value)}
          placeholder="Ej. Código de cliente"
          className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
          required
          maxLength={120}
        />
      </div>

      {/* Key */}
      <div className="space-y-1.5">
        <label
          htmlFor={`${formId}-key`}
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Clave (slug) <span className="text-destructive">*</span>
        </label>
        <input
          id={`${formId}-key`}
          type="text"
          value={draft.key}
          onChange={(e) => {
            setKeyTouched(true)
            setDraft({ ...draft, key: e.target.value })
          }}
          placeholder="cliente_codigo"
          className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm font-mono text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
          required
          maxLength={64}
          pattern="[a-z][a-z0-9_]*"
        />
        <p className="text-[11px] text-muted-foreground">
          Sólo minúsculas, números y &quot;_&quot;. Único por proyecto.
        </p>
      </div>

      {/* Tipo */}
      <div className="space-y-1.5">
        <label
          htmlFor={`${formId}-type`}
          className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Tipo <span className="text-destructive">*</span>
        </label>
        <select
          id={`${formId}-type`}
          value={draft.type}
          onChange={(e) =>
            setDraft({ ...draft, type: e.target.value as FieldType })
          }
          className="w-full rounded-md border border-border bg-input py-2 px-3 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {(Object.keys(TYPE_LABELS) as FieldType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {/* Required */}
      <div className="flex items-center gap-2">
        <input
          id={`${formId}-required`}
          type="checkbox"
          checked={draft.required}
          onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
          className="h-4 w-4 rounded border-border bg-input"
        />
        <label
          htmlFor={`${formId}-required`}
          className="text-sm text-foreground"
        >
          Campo obligatorio
        </label>
      </div>

      {/* Opciones para SELECT / MULTI_SELECT */}
      {needsOptions && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Opciones de la lista
            </span>
            <button
              type="button"
              onClick={addOption}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-xs text-foreground hover:bg-secondary/80"
            >
              <Plus className="h-3 w-3" /> Agregar opción
            </button>
          </div>
          <div className="space-y-2" data-testid="custom-field-options">
            {draft.options.length === 0 && (
              <p className="text-[11px] italic text-muted-foreground">
                Aún no hay opciones. Agrega al menos una.
              </p>
            )}
            {draft.options.map((opt, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr,1fr,auto] gap-2 items-center"
              >
                <input
                  type="text"
                  value={opt.value}
                  onChange={(e) =>
                    patchOption(idx, { value: e.target.value })
                  }
                  placeholder="value"
                  className="rounded-md border border-border bg-input py-1.5 px-2 text-sm font-mono text-input-foreground focus:border-primary focus:outline-none"
                  aria-label={`Valor opción ${idx + 1}`}
                />
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) =>
                    patchOption(idx, { label: e.target.value })
                  }
                  placeholder="Etiqueta visible"
                  className="rounded-md border border-border bg-input py-1.5 px-2 text-sm text-input-foreground focus:border-primary focus:outline-none"
                  aria-label={`Etiqueta opción ${idx + 1}`}
                />
                <button
                  type="button"
                  onClick={() => removeOption(idx)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Eliminar opción ${idx + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-3 py-2 text-sm text-foreground hover:bg-secondary/80"
            disabled={isPending}
          >
            <X className="h-4 w-4" /> Cancelar
          </button>
        )}
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          disabled={isPending}
        >
          <Save className="h-4 w-4" /> {isEdit ? 'Guardar cambios' : 'Crear campo'}
        </button>
      </div>
    </form>
  )
}
