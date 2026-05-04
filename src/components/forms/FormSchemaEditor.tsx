'use client'

/**
 * Ola P5 · Equipo P5-5 — Editor visual del schema de un PublicForm.
 *
 * Drag-and-drop simple SIN librerías externas: HTML5 Drag and Drop API.
 * Permite agregar/eliminar campos, reordenarlos, cambiar tipo, label,
 * required, opciones (para SELECT). Persiste vía `updateForm`.
 */

import { useState, useTransition } from 'react'
import { updateForm } from '@/lib/actions/forms'
import { FORM_FIELD_TYPES, type FormField, type FormFieldType } from '@/lib/forms/schema'

interface Props {
  formId: string
  initialFields: FormField[]
  initialTitle: string
  initialDescription: string | null
  initialTemplate: string
}

export function FormSchemaEditor(props: Props) {
  const [fields, setFields] = useState<FormField[]>(props.initialFields)
  const [title, setTitle] = useState(props.initialTitle)
  const [description, setDescription] = useState(props.initialDescription ?? '')
  const [template, setTemplate] = useState(props.initialTemplate)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  function updateField(idx: number, patch: Partial<FormField>) {
    setFields((prev) =>
      prev.map((f, i) => (i === idx ? ({ ...f, ...patch } as FormField) : f)),
    )
  }

  function addField() {
    setFields((prev) => [
      ...prev,
      {
        name: `campo_${prev.length + 1}`,
        type: 'text',
        label: '',
        required: false,
      } as FormField,
    ])
  }

  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx))
  }

  function moveField(from: number, to: number) {
    if (from === to) return
    setFields((prev) => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  async function handleSave() {
    setError(null)
    setSuccess(null)
    startTransition(async () => {
      try {
        await updateForm(props.formId, {
          title,
          description: description || null,
          schema: fields,
          targetTaskTitleTemplate: template || undefined,
        })
        setSuccess('Cambios guardados')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al guardar')
      }
    })
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white">Configuración general</h2>
        <div>
          <label className="text-xs text-muted-foreground">Título del formulario</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Descripción</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">
            Plantilla del título de Task ({'{campo}'} para interpolar)
          </label>
          <input
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
          />
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Campos</h2>
          <button
            type="button"
            onClick={addField}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Añadir campo
          </button>
        </div>
        <ul className="space-y-2">
          {fields.map((f, idx) => (
            <li
              key={idx}
              draggable
              onDragStart={() => setDragIndex(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) moveField(dragIndex, idx)
                setDragIndex(null)
              }}
              className="rounded-md border border-border bg-background/80 p-3 space-y-2 cursor-grab"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                <input
                  value={f.name}
                  onChange={(e) => updateField(idx, { name: e.target.value })}
                  className="rounded border border-border bg-background px-2 py-1 text-xs font-mono w-40"
                  placeholder="nombre_campo"
                />
                <select
                  value={f.type}
                  onChange={(e) =>
                    updateField(idx, { type: e.target.value as FormFieldType })
                  }
                  className="rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  {FORM_FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  value={f.label ?? ''}
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                  className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                  placeholder="Etiqueta visible"
                />
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => updateField(idx, { required: e.target.checked })}
                  />
                  Requerido
                </label>
                <button
                  type="button"
                  onClick={() => removeField(idx)}
                  className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200 hover:bg-red-500/20"
                >
                  Eliminar
                </button>
              </div>
              {f.type === 'select' ? (
                <input
                  value={(f.options ?? []).join(', ')}
                  onChange={(e) =>
                    updateField(idx, {
                      options: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                  placeholder="Opción 1, Opción 2, Opción 3"
                />
              ) : null}
            </li>
          ))}
          {fields.length === 0 ? (
            <li className="text-xs text-muted-foreground italic">Sin campos.</li>
          ) : null}
        </ul>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
      {success ? <p className="text-sm text-green-300">{success}</p> : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {isPending ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
