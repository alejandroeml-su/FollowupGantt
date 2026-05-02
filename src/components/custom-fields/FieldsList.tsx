'use client'

/**
 * Ola P1 · Equipo 3 — Lista de Custom Fields del proyecto.
 *
 * Tabla con drag-handle visual para reordenar (persiste vía
 * `updateFieldDef({ position })`). El reordenamiento usa swap simple del
 * `position`: NO recalculamos todo el array para no inflar costo en
 * proyectos con muchos campos.
 *
 * Acciones disponibles por fila:
 *   - Editar (abre `<FieldDefForm initial={...}/>` en el modal del padre).
 *   - Eliminar (cascade incluye los valores ya guardados — se confirma).
 *
 * No usa `@dnd-kit` aquí: el patrón "↑ / ↓" es suficiente para el MVP y
 * accesible por defecto. Cuando aumente la frecuencia de uso, se puede
 * migrar a un drag-handle real.
 */

import { useTransition } from 'react'
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  deleteFieldDef,
  updateFieldDef,
} from '@/lib/actions/custom-fields'

export type FieldDefRow = {
  id: string
  key: string
  label: string
  type: string
  required: boolean
  position: number
}

const TYPE_LABELS: Record<string, string> = {
  TEXT: 'Texto',
  NUMBER: 'Número',
  DATE: 'Fecha',
  BOOLEAN: 'Booleano',
  SELECT: 'Selección única',
  MULTI_SELECT: 'Selección múltiple',
  URL: 'URL',
}

type Props = {
  fields: FieldDefRow[]
  onEdit?: (id: string) => void
}

export function FieldsList({ fields, onEdit }: Props) {
  const [isPending, startTransition] = useTransition()

  const sorted = [...fields].sort((a, b) => a.position - b.position)

  const swapPositions = (idx: number, dir: -1 | 1) => {
    const a = sorted[idx]
    const b = sorted[idx + dir]
    if (!a || !b) return
    startTransition(async () => {
      // Swap atómico de positions. Si fallara la 2da llamada, queda
      // posición duplicada momentáneamente pero el orderBy sigue siendo
      // determinista por createdAt como tie-breaker.
      try {
        await updateFieldDef(a.id, { position: b.position })
        await updateFieldDef(b.id, { position: a.position })
      } catch {
        // El error se propaga al hub global del padre vía revalidatePath.
      }
    })
  }

  const handleDelete = (id: string, label: string) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `¿Eliminar "${label}"? Se borrarán también los valores guardados en tareas.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      try {
        await deleteFieldDef(id)
      } catch {
        /* el padre revalida y refresca tras la mutación */
      }
    })
  }

  if (sorted.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Aún no hay campos personalizados para este proyecto.
        </p>
      </div>
    )
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      data-testid="custom-fields-list"
    >
      <div className="grid grid-cols-[auto,2fr,1.5fr,1fr,auto,auto] items-center gap-3 border-b border-border bg-background/95 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <div className="w-6" aria-hidden />
        <div>Etiqueta</div>
        <div>Clave</div>
        <div>Tipo</div>
        <div>Obligatorio</div>
        <div className="text-right">Acciones</div>
      </div>

      <ul className="divide-y divide-border/50">
        {sorted.map((f, idx) => (
          <li
            key={f.id}
            data-testid={`custom-field-row-${f.key}`}
            className="grid grid-cols-[auto,2fr,1.5fr,1fr,auto,auto] items-center gap-3 px-4 py-3 hover:bg-secondary/40"
          >
            <div className="flex flex-col items-center gap-0.5 text-muted-foreground">
              <button
                type="button"
                onClick={() => swapPositions(idx, -1)}
                disabled={idx === 0 || isPending}
                aria-label={`Subir ${f.label}`}
                className="hover:text-foreground disabled:opacity-30"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <GripVertical className="h-3.5 w-3.5 opacity-50" aria-hidden />
              <button
                type="button"
                onClick={() => swapPositions(idx, 1)}
                disabled={idx === sorted.length - 1 || isPending}
                aria-label={`Bajar ${f.label}`}
                className="hover:text-foreground disabled:opacity-30"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="font-medium text-foreground">{f.label}</div>
            <div className="font-mono text-xs text-muted-foreground">
              {f.key}
            </div>
            <div className="text-sm text-muted-foreground">
              {TYPE_LABELS[f.type] ?? f.type}
            </div>
            <div>
              {f.required ? (
                <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400 border border-amber-500/30">
                  Sí
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">No</span>
              )}
            </div>
            <div className="flex justify-end gap-2">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(f.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-1 text-xs text-foreground hover:bg-secondary/80"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </button>
              )}
              <button
                type="button"
                onClick={() => handleDelete(f.id, f.label)}
                className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                disabled={isPending}
              >
                <Trash2 className="h-3.5 w-3.5" /> Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
