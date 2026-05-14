'use client'

import { useState, useEffect, useRef } from 'react'
import {
  StickyNote,
  Square,
  Circle,
  Type,
  ArrowRight,
  Triangle,
  Image as ImageIcon,
  Download,
  ChevronDown,
  Pencil,
  Eraser,
} from 'lucide-react'
import type {
  WhiteboardElementTypeLiteral,
  ShapeVariant,
  FreehandBrush,
} from '@/lib/whiteboards/types'
import { FREEHAND_BRUSHES } from '@/lib/whiteboards/types'
import { BRUSH_PRESETS } from '@/lib/whiteboards/factories'

export type ToolId =
  | { kind: 'STICKY' }
  | { kind: 'SHAPE'; variant: ShapeVariant }
  | { kind: 'TEXT' }
  | { kind: 'CONNECTOR' }
  | { kind: 'IMAGE' }
  | { kind: 'FREEHAND'; brush: FreehandBrush }
  /** HU-14 (2026-05-14) — Borrador. `size` en px define el radio del
   *  área que detecta colisión con elementos al hacer click/drag. */
  | { kind: 'ERASER'; size: number }

/** HU-14 — Tamaños de borrador disponibles (radio en px). */
export const ERASER_SIZES = [6, 12, 24, 48] as const

export type ExportKind = 'png' | 'png-hires' | 'pdf' | 'pdf-selection'

type Props = {
  /** Tool actualmente seleccionado (null = modo selección/cursor). */
  activeTool: ToolId | null
  onSelectTool: (tool: ToolId | null) => void
  snapEnabled: boolean
  onToggleSnap: (next: boolean) => void
  onExportPng: () => void
  /** HU-13 (2026-05-14) — opciones extendidas de export (PDF + hi-res +
   *  selección). Si no se pasan, solo se ofrece el botón legacy PNG. */
  onExport?: (kind: ExportKind) => void
  /** Si hay un elemento seleccionado se habilita "PDF de la selección". */
  hasSelection?: boolean
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
  onExport,
  hasSelection = false,
}: Props) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!exportMenuOpen) return
    function onDocClick(ev: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [exportMenuOpen])
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
    if (activeTool.kind === 'FREEHAND' && t.kind === 'FREEHAND') {
      return activeTool.brush === t.brush
    }
    return true
  }

  const isAnyFreehandActive = activeTool?.kind === 'FREEHAND'
  const activeBrush = isAnyFreehandActive
    ? (activeTool as { kind: 'FREEHAND'; brush: FreehandBrush }).brush
    : 'pencil'
  const [brushMenuOpen, setBrushMenuOpen] = useState(false)
  const brushMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!brushMenuOpen) return
    function onDoc(ev: MouseEvent) {
      if (brushMenuRef.current && !brushMenuRef.current.contains(ev.target as Node)) {
        setBrushMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [brushMenuOpen])

  // HU-14 (2026-05-14) — Sub-menú del Eraser para escoger tamaño.
  const isEraserActive = activeTool?.kind === 'ERASER'
  const activeEraserSize = isEraserActive
    ? (activeTool as { kind: 'ERASER'; size: number }).size
    : 12
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false)
  const eraserMenuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!eraserMenuOpen) return
    function onDoc(ev: MouseEvent) {
      if (eraserMenuRef.current && !eraserMenuRef.current.contains(ev.target as Node)) {
        setEraserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [eraserMenuOpen])

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

      {/* HU-03 — Herramienta Dibujo libre con sub-menú de pinceles. */}
      <div ref={brushMenuRef} className="relative">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => onSelectTool({ kind: 'FREEHAND', brush: activeBrush })}
            aria-pressed={isAnyFreehandActive}
            aria-label={`Dibujar a mano (${BRUSH_PRESETS[activeBrush].label})`}
            title={`Dibujar · ${BRUSH_PRESETS[activeBrush].label}`}
            className={`p-2 rounded-l-md transition-colors ${
              isAnyFreehandActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setBrushMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={brushMenuOpen}
            aria-label="Elegir pincel"
            className={`px-1 py-2 rounded-r-md transition-colors ${
              isAnyFreehandActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        {brushMenuOpen && (
          <ul
            role="menu"
            className="absolute right-0 mt-1 z-10 min-w-[180px] bg-card border border-border rounded-md shadow-lg py-1"
          >
            {FREEHAND_BRUSHES.map((brush) => (
              <li key={brush} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setBrushMenuOpen(false)
                    onSelectTool({ kind: 'FREEHAND', brush })
                  }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-secondary flex items-center gap-2 ${
                    activeBrush === brush && isAnyFreehandActive
                      ? 'text-primary font-semibold'
                      : 'text-foreground'
                  }`}
                >
                  <span aria-hidden>{BRUSH_PRESETS[brush].emoji}</span>
                  <span>{BRUSH_PRESETS[brush].label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* HU-14 — Borrador con sub-menú de tamaños. */}
      <div ref={eraserMenuRef} className="relative">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => onSelectTool({ kind: 'ERASER', size: activeEraserSize })}
            aria-pressed={isEraserActive}
            aria-label={`Borrador (${activeEraserSize}px)`}
            title={`Borrador · ${activeEraserSize}px`}
            className={`p-2 rounded-l-md transition-colors ${
              isEraserActive
                ? 'bg-rose-500 text-white'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            <Eraser className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setEraserMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={eraserMenuOpen}
            aria-label="Elegir tamaño del borrador"
            className={`px-1 py-2 rounded-r-md transition-colors ${
              isEraserActive
                ? 'bg-rose-500 text-white'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        {eraserMenuOpen && (
          <ul
            role="menu"
            className="absolute right-0 mt-1 z-10 min-w-[160px] bg-card border border-border rounded-md shadow-lg py-1"
          >
            {ERASER_SIZES.map((size) => (
              <li key={size} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setEraserMenuOpen(false)
                    onSelectTool({ kind: 'ERASER', size })
                  }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-secondary flex items-center gap-3 ${
                    activeEraserSize === size && isEraserActive
                      ? 'text-primary font-semibold'
                      : 'text-foreground'
                  }`}
                >
                  <span
                    aria-hidden
                    className="rounded-full bg-rose-300"
                    style={{ width: size / 2, height: size / 2, minWidth: 4, minHeight: 4 }}
                  />
                  <span>{size}px</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

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
      {onExport ? (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setExportMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-secondary"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar
            <ChevronDown className="h-3 w-3" />
          </button>
          {exportMenuOpen && (
            <ul
              role="menu"
              className="absolute right-0 mt-1 z-10 min-w-[220px] bg-card border border-border rounded-md shadow-lg py-1"
            >
              <ExportMenuItem
                label="PNG"
                hint="Imagen estándar"
                onClick={() => {
                  setExportMenuOpen(false)
                  onExport('png')
                }}
              />
              <ExportMenuItem
                label="PNG (alta resolución)"
                hint="3× — apto para impresión"
                onClick={() => {
                  setExportMenuOpen(false)
                  onExport('png-hires')
                }}
              />
              <ExportMenuItem
                label="PDF"
                hint="Documento de una página"
                onClick={() => {
                  setExportMenuOpen(false)
                  onExport('pdf')
                }}
              />
              <ExportMenuItem
                label="PDF (solo selección)"
                hint={
                  hasSelection
                    ? 'Exporta el elemento activo'
                    : 'Selecciona un elemento primero'
                }
                disabled={!hasSelection}
                onClick={() => {
                  setExportMenuOpen(false)
                  onExport('pdf-selection')
                }}
              />
            </ul>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={onExportPng}
          className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:bg-secondary"
        >
          Exportar PNG
        </button>
      )}
    </div>
  )
}

function ExportMenuItem({
  label,
  hint,
  onClick,
  disabled = false,
}: {
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        disabled={disabled}
        className="w-full text-left px-3 py-2 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <div className="text-xs font-medium text-foreground">{label}</div>
        {hint && (
          <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>
        )}
      </button>
    </li>
  )
}

/**
 * Helper externo para mapear el `kind` del tool al tipo Prisma. Permite
 * convertir un click del toolbar en un `createElement(...)` sin duplicar
 * la lógica en el editor.
 */
export function toolToElementType(t: ToolId): WhiteboardElementTypeLiteral | null {
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
    case 'FREEHAND':
      return 'FREEHAND'
    case 'ERASER':
      return null // no crea elementos
  }
}
