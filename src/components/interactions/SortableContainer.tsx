'use client'

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'
import { useState } from 'react'

/**
 * Contenedor sortable vertical con soporte para:
 *  - pointer (mouse)
 *  - touch (long-press 150ms, tolerancia 5px para móviles/tablets)
 *  - keyboard (Space para pickup, flechas para mover, Space para confirmar)
 *
 * Accesible: expone anuncios WCAG automáticamente via dnd-kit.
 */
type Props<T extends { id: string }> = {
  items: T[]
  onReorder: (ids: string[], from: number, to: number) => void | Promise<void>
  renderItem: (item: T, handleProps: HandleProps) => ReactNode
  // announceLabel: callback para componer mensajes para screen reader
  announceLabel?: (active: string, over: string | null) => string
}

export type HandleProps = {
  attributes: ReturnType<typeof useSortable>['attributes']
  listeners: ReturnType<typeof useSortable>['listeners']
  setNodeRef: (node: HTMLElement | null) => void
  style: React.CSSProperties
  isDragging: boolean
}

export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  announceLabel,
}: Props<T>) {
  const [localItems, setLocalItems] = useState<T[]>(items)

  if (items !== localItems && items.length !== localItems.length) {
    // sync si el padre cambió la lista (revalidatePath)
    setLocalItems(items)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = localItems.findIndex((i) => i.id === active.id)
    const to = localItems.findIndex((i) => i.id === over.id)
    if (from < 0 || to < 0) return
    // optimistic
    const next = arrayMove(localItems, from, to)
    setLocalItems(next)
    await onReorder(
      next.map((i) => i.id),
      from,
      to,
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            announceLabel
              ? announceLabel(String(active.id), null)
              : `Tarea ${active.id} tomada`,
          onDragOver: ({ active, over }) =>
            announceLabel
              ? announceLabel(String(active.id), over ? String(over.id) : null)
              : `Sobre ${over?.id ?? 'nada'}`,
          onDragEnd: ({ active, over }) =>
            over
              ? `Tarea ${active.id} movida ${over.id === active.id ? 'al mismo lugar' : `cerca de ${over.id}`}`
              : `Movimiento cancelado`,
          onDragCancel: () => 'Cancelado',
        },
      }}
    >
      <SortableContext
        items={localItems.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        {localItems.map((item) => (
          <SortableNode key={item.id} id={item.id}>
            {(handleProps) => renderItem(item, handleProps)}
          </SortableNode>
        ))}
      </SortableContext>
    </DndContext>
  )
}

function SortableNode({
  id,
  children,
}: {
  id: string
  children: (h: HandleProps) => ReactNode
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <>
      {children({ attributes, listeners, setNodeRef, style, isDragging })}
    </>
  )
}
