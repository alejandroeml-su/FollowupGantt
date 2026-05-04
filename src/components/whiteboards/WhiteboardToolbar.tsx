'use client'

import { StickyNote, Square, Circle, Type, ArrowRight, Triangle, Image as ImageIcon } from 'lucide-react'
import type { WhiteboardElementTypeLiteral, ShapeVariant } from '@/lib/whiteboards/types'

export type ToolId =
  | { kind: 'STICKY' }
  | { kind: 'SHAPE'; variant: ShapeVariant }
  | { kind: 'TEXT' }
  | { kind: 'CONNECTOR' }
  | { kind: 'IMAGE' }

type Props = {
  /** Tool actualmente seleccionado (null = modo selección/cursor). */
  activeTool: ToolId | null
  onSelectTool: (tool: ToolId | null) => void
  snapEnabled: boolean
  onToggleSnap: (next: boolean) => void
  onExportPng: () => void
}

/**
 * Toolbar superior del editor. Cada botón inserta un elemento al hacer
 * click en el canvas (o, en modo "drop", al click directo sobre el lienzo
 * con el tool activo).
 */
export function WhiteboardToolbar({
  activeTool,
  onSelectTool,
  snapEnabled,
  onToggleSnap,
  onExportPng,
}: Props) {
  const tools: { id: ToolId; label: string; Icon: typeof StickyNote }[] = [
    { id: { kind: 'STICKY' }, label: 'Sticky', Icon: StickyNote },
    { id: { kind: 'SHAPE', variant: 'rectangle' }, label: 'Rectángulo', Icon: Square },
    { id: { kind: 'SHAPE', variant: 'circle' }, label: 'Círculo', Icon: Circle },
    { id: { kind: 'SHAPE', variant: 'triangle' }, label: 'Triángulo', Icon: Triangle },
    { id: { kind: 'TEXT' }, label: 'Texto', Icon: Type },
    { id: { kind: 'CONNECTOR' }, label: 'Conector', Icon: ArrowRight },
    { id: { kind: 'IMAGE' }, label: 'Imagen', Icon: ImageIcon },
  ]

  const isActive = (t: ToolId) => {
    if (!activeTool) return false
    if (activeTool.kind !== t.kind) return false
    if (activeTool.kind === 'SHAPE' && t.kind === 'SHAPE') {
      return activeTool.variant === t.variant
    }
    return true
  }

  return (
    <div
      role="toolbar"
      aria-label="Herramientas de pizarra"
      className="flex items-center gap-1 rounded-xl border border-border bg-card px-2 py-1.5 shadow-md"
    >
      <button
        type="button"
        onClick={() => onSelectTool(null)}
        aria-pressed={activeTool === null}
        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
          activeTool === null
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-secondary'
        }`}
      >
        Seleccionar
      </button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      {tools.map(({ id, label, Icon }) => (
        <button
          key={`${id.kind}-${id.kind === 'SHAPE' ? id.variant : ''}`}
          type="button"
          onClick={() => onSelectTool(id)}
          aria-pressed={isActive(id)}
          aria-label={`Añadir ${label}`}
          title={label}
          className={`p-2 rounded-md transition-colors ${
            isActive(id)
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary'
          }`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <label className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground select-none">
        <input
          type="checkbox"
          checked={snapEnabled}
          onChange={(e) => onToggleSnap(e.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
          aria-label="Activar snap a grid"
        />
        Snap 10px
      </label>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <button
        type="button"
        onClick={onExportPng}
        className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-secondary"
      >
        Exportar PNG
      </button>
    </div>
  )
}

/**
 * Helper externo para mapear el `kind` del tool al tipo Prisma. Permite
 * convertir un click del toolbar en un `createElement(...)` sin duplicar
 * la lógica en el editor.
 */
export function toolToElementType(t: ToolId): WhiteboardElementTypeLiteral {
  switch (t.kind) {
    case 'STICKY':
      return 'STICKY'
    case 'SHAPE':
      return 'SHAPE'
    case 'TEXT':
      return 'TEXT'
    case 'CONNECTOR':
      return 'CONNECTOR'
    case 'IMAGE':
      return 'IMAGE'
  }
}
