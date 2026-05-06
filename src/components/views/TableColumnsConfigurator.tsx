'use client'

/**
 * TableColumnsConfigurator · Modal popover para que el usuario:
 *   - Active/desactive columnas (checkboxes).
 *   - Reordene columnas con drag&drop (handle = grip a la izquierda).
 *   - Resete a defaults.
 *
 * Persistencia: el padre (TableBoardClient) usa `useTableColumnPrefs`
 * y pasa `prefs` + `onChange` aquí. El componente NO toca localStorage
 * directamente — desacoplamos UI de storage para testabilidad.
 *
 * Pensado para invocarse desde un botón "Columnas" en el header de
 * la tabla. El botón gestiona el estado abierto/cerrado y el outside
 * click.
 */

import { useMemo } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, RotateCcw } from 'lucide-react'
import {
  TABLE_COLUMNS,
  getColumnDef,
  getDefaultColumnPrefs,
  type TableColumnId,
  type TableColumnPrefs,
} from '@/lib/views/table-columns'

type Props = {
  prefs: TableColumnPrefs
  onChange: (next: TableColumnPrefs) => void
  onClose?: () => void
}

export function TableColumnsConfigurator({ prefs, onChange, onClose }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  // Derivamos las filas a mostrar a partir de `prefs.order`. Cada fila
  // sabe si la columna está visible y si es de las que no se pueden
  // ocultar (alwaysVisible).
  const rows = useMemo(
    () =>
      prefs.order
        .map((id) => getColumnDef(id))
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .map((c) => ({
          id: c.id,
          label: c.label,
          alwaysVisible: !!c.alwaysVisible,
          visible: prefs.visible.includes(c.id),
        })),
    [prefs],
  )

  function toggleVisible(id: TableColumnId) {
    const def = getColumnDef(id)
    if (def?.alwaysVisible) return // no se puede ocultar
    const isVisible = prefs.visible.includes(id)
    const nextVisible = isVisible
      ? prefs.visible.filter((x) => x !== id)
      : [...prefs.visible, id]
    onChange({ order: prefs.order, visible: nextVisible })
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = prefs.order.indexOf(active.id as TableColumnId)
    const to = prefs.order.indexOf(over.id as TableColumnId)
    if (from < 0 || to < 0) return
    const nextOrder = arrayMove(prefs.order, from, to)
    onChange({ order: nextOrder, visible: prefs.visible })
  }

  function handleReset() {
    onChange(getDefaultColumnPrefs())
  }

  // Por si el catálogo crece y hay columnas que aún no están en `order`
  // (cae como warning para devs, no se muestra al usuario).
  if (process.env.NODE_ENV !== 'production') {
    const known = new Set(prefs.order)
    for (const c of TABLE_COLUMNS) {
      if (!known.has(c.id)) {
        console.warn(
          `[TableColumnsConfigurator] columna "${c.id}" no presente en prefs.order — normalizeColumnPrefs debería resolverlo`,
        )
      }
    }
  }

  return (
    <div
      className="w-72 rounded-lg border border-border bg-card p-3 shadow-xl"
      role="dialog"
      aria-label="Configurar columnas de la tabla"
    >
      <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
        <h3 className="text-sm font-semibold text-foreground">Columnas</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Restaurar columnas por defecto"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Cerrar"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Activa o desactiva. Arrastra para reordenar.
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={rows.map((r) => r.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {rows.map((row) => (
              <SortableRow
                key={row.id}
                id={row.id}
                label={row.label}
                visible={row.visible}
                alwaysVisible={row.alwaysVisible}
                onToggle={() => toggleVisible(row.id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableRow(props: {
  id: TableColumnId
  label: string
  visible: boolean
  alwaysVisible: boolean
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded border border-border/40 bg-background/40 px-2 py-1.5 text-sm hover:border-indigo-500/40"
    >
      <button
        type="button"
        {...attributes}
        {...(listeners as Record<string, unknown>)}
        aria-label={`Reordenar columna ${props.label}`}
        className="cursor-grab text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <input
        id={`col-${props.id}`}
        type="checkbox"
        checked={props.visible}
        disabled={props.alwaysVisible}
        onChange={props.onToggle}
        className="h-4 w-4 cursor-pointer accent-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <label
        htmlFor={`col-${props.id}`}
        className={
          props.alwaysVisible
            ? 'flex-1 cursor-not-allowed text-muted-foreground'
            : 'flex-1 cursor-pointer text-foreground'
        }
      >
        {props.label}
        {props.alwaysVisible && (
          <span className="ml-1 text-[10px] text-muted-foreground">
            (fija)
          </span>
        )}
      </label>
    </li>
  )
}
