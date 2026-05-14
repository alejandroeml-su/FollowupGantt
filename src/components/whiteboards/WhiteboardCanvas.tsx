'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react'
import {
  DEFAULT_VIEWPORT,
  type ViewportState,
  type WhiteboardElement,
} from '@/lib/whiteboards/types'
import { snapPoint, stepZoom, screenToWorld, worldToScreen } from '@/lib/whiteboards/geometry'
import { LiveCursorsLayer } from '@/components/realtime-cursors/LiveCursorsLayer'
import type { CurrentUserIdentity } from '@/lib/realtime-cursors/use-live-cursors'

type Props = {
  elements: WhiteboardElement[]
  selectedId: string | null
  /** Elemento actualmente en modo edición inline (textarea visible). */
  editingId?: string | null
  onSelect: (id: string | null) => void
  onMove: (id: string, next: { x: number; y: number }) => void
  /** Click sobre el lienzo vacío en coords mundo. Útil para insertar con tool activo. */
  onCanvasClick?: (worldPoint: { x: number; y: number }) => void
  /** Doble click sobre un elemento editable (sticky/text/shape). */
  onStartEdit?: (id: string) => void
  /** Commit del texto editado tras blur o Esc/Enter. */
  onCommitEdit?: (id: string, text: string) => void
  /** Right-click sobre un elemento. screen es relativo al contenedor del canvas. */
  onContextMenu?: (id: string, screen: { x: number; y: number }) => void
  snapEnabled: boolean
  /** Si está en true, el background usa cursor "grab" para indicar pan con space. */
  panMode?: boolean
  /** Wave P6 — id de la pizarra para suscribirse al canal realtime de cursores. */
  whiteboardId?: string
  /** Wave P6 — usuario actual para emitir su cursor en el canal. */
  currentUser?: CurrentUserIdentity | null
  /**
   * HU-03 (2026-05-14) — Modo dibujo libre activo. Si se provee, los
   * gestos de mouse en el lienzo capturan un trazo en lugar de pan/select.
   * `brush` define el preset visual (color + grosor) que se muestra como
   * preview.
   */
  drawingMode?: { active: boolean; brush: 'pencil' | 'marker' | 'watercolor' | 'highlighter' }
  /**
   * Callback que recibe los puntos del trazo en coordenadas mundo al
   * soltar el mouse. El editor crea el `WhiteboardElement` FREEHAND con
   * estos puntos y persiste.
   */
  onDrawingCommit?: (points: { x: number; y: number }[]) => void
}

/**
 * Canvas DOM-based — usamos divs absolutamente posicionados con un wrapper
 * `transform: translate + scale`. Esto evita librerías nuevas y se beneficia
 * de las optimizaciones de la GPU del navegador.
 *
 * Eventos clave:
 *   - wheel sin tecla: zoom anclado al puntero (ZOOM_STEP).
 *   - mousedown sobre fondo + space pressed: inicia pan.
 *   - mousedown sobre elemento: inicia drag.
 *   - mouseup sin movimiento sobre fondo: deselecciona o invoca onCanvasClick.
 */
export function WhiteboardCanvas({
  elements,
  selectedId,
  editingId,
  onSelect,
  onMove,
  onCanvasClick,
  onStartEdit,
  onCommitEdit,
  onContextMenu,
  snapEnabled,
  panMode = false,
  whiteboardId,
  currentUser,
  drawingMode,
  onDrawingCommit,
}: Props) {
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    kind: 'pan' | 'element' | 'draw'
    elementId?: string
    startScreen: { x: number; y: number }
    startWorld: { x: number; y: number }
    startElementWorld?: { x: number; y: number }
    moved: boolean
    /** HU-03 — cuando kind='draw', va acumulando puntos en coords mundo. */
    drawPoints?: { x: number; y: number }[]
  } | null>(null)
  // HU-03 — estado del trazo en curso para repintar el preview en cada move.
  const [drawingPreview, setDrawingPreview] = useState<
    { x: number; y: number }[] | null
  >(null)

  /** Convierte un MouseEvent del DOM a coords del mundo. */
  const eventToWorld = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return screenToWorld(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        viewport,
      )
    },
    [viewport],
  )

  const handleWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      // Pan con Shift+wheel (UX típica) — sólo zoom por defecto.
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const pivot = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const direction = e.deltaY < 0 ? 1 : -1
      setViewport((prev) => stepZoom(prev, pivot, direction))
    },
    [],
  )

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const elementHandle = target.closest('[data-element-id]') as HTMLElement | null

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const world = screenToWorld(screen, viewport)

      // HU-03 — modo dibujo: cualquier mousedown sobre el lienzo inicia
      // un trazo nuevo. Tiene prioridad sobre la selección de elemento
      // (queremos dibujar encima sin seleccionar el sticky por error).
      if (drawingMode?.active && !panMode) {
        dragRef.current = {
          kind: 'draw',
          startScreen: screen,
          startWorld: world,
          moved: false,
          drawPoints: [world],
        }
        setDrawingPreview([world])
        return
      }

      if (elementHandle && !panMode) {
        const elementId = elementHandle.dataset.elementId!
        const el = elements.find((x) => x.id === elementId)
        if (!el) return
        dragRef.current = {
          kind: 'element',
          elementId,
          startScreen: screen,
          startWorld: world,
          startElementWorld: { x: el.x, y: el.y },
          moved: false,
        }
        onSelect(elementId)
      } else {
        dragRef.current = {
          kind: 'pan',
          startScreen: screen,
          startWorld: world,
          moved: false,
        }
      }
    },
    [elements, onSelect, panMode, viewport, drawingMode],
  )

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const dx = screen.x - drag.startScreen.x
      const dy = screen.y - drag.startScreen.y
      if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true

      if (drag.kind === 'pan') {
        setViewport((prev) => ({
          ...prev,
          panX: prev.panX + (screen.x - drag.startScreen.x),
          panY: prev.panY + (screen.y - drag.startScreen.y),
        }))
        // El "start" se reposiciona para que el delta sea relativo al frame anterior.
        drag.startScreen = screen
      } else if (drag.kind === 'draw' && drag.drawPoints) {
        // HU-03 — acumular punto si el delta supera 1px en pantalla (al
        // zoom actual). Evita acumular cientos de puntos casi idénticos
        // y mantiene el path liviano sin perder fidelidad.
        const world = screenToWorld(screen, viewport)
        const last = drag.drawPoints[drag.drawPoints.length - 1]
        const dWorld = Math.hypot(world.x - last.x, world.y - last.y)
        if (dWorld * viewport.zoom > 1.5) {
          drag.drawPoints.push(world)
          // Forzamos un re-render solo cada N puntos para no saturar React.
          if (drag.drawPoints.length % 2 === 0) {
            setDrawingPreview([...drag.drawPoints])
          }
        }
      } else if (drag.kind === 'element' && drag.elementId && drag.startElementWorld) {
        const world = screenToWorld(screen, viewport)
        const next = snapPoint(
          {
            x: drag.startElementWorld.x + (world.x - drag.startWorld.x),
            y: drag.startElementWorld.y + (world.y - drag.startWorld.y),
          },
          snapEnabled,
        )
        onMove(drag.elementId, next)
      }
    },
    [onMove, snapEnabled, viewport],
  )

  const handleMouseUp = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return
      // HU-03 — commit del trazo dibujado. Si el usuario hizo click sin
      // mover (drawPoints.length === 1), descartamos: probablemente fue
      // un click accidental (no queremos crear elementos con 1 punto).
      if (drag.kind === 'draw' && drag.drawPoints) {
        const points = drag.drawPoints
        setDrawingPreview(null)
        if (points.length >= 2 && onDrawingCommit) {
          onDrawingCommit(points)
        }
        return
      }
      // Click en fondo sin drag → deselecciona o emite onCanvasClick (insertar).
      if (drag.kind === 'pan' && !drag.moved) {
        const world = eventToWorld(e)
        if (onCanvasClick) {
          onCanvasClick(world)
        } else {
          onSelect(null)
        }
      }
    },
    [eventToWorld, onCanvasClick, onDrawingCommit, onSelect],
  )

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const elementHandle = target.closest('[data-element-id]') as HTMLElement | null
      if (!elementHandle || !onContextMenu) return
      e.preventDefault()
      const id = elementHandle.dataset.elementId
      if (!id) return
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      onContextMenu(id, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    },
    [onContextMenu],
  )

  const handleDoubleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const elementHandle = target.closest('[data-element-id]') as HTMLElement | null
      if (!elementHandle || !onStartEdit) return
      const id = elementHandle.dataset.elementId
      if (!id) return
      const el = elements.find((x) => x.id === id)
      if (!el) return
      if (el.type === 'STICKY' || el.type === 'TEXT' || el.type === 'SHAPE') {
        e.stopPropagation()
        onStartEdit(id)
      }
    },
    [elements, onStartEdit],
  )

  const transformStyle: CSSProperties = useMemo(
    () => ({
      transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
      transformOrigin: '0 0',
    }),
    [viewport],
  )

  // Build grid background — pattern con CSS background-image (gradients).
  // 2026-05-14 · Edwin pidió lienzo blanco (estándar tipo Miro/Figma —
  // el chrome de la app puede estar en dark mode, pero el lienzo siempre
  // blanco para que los exports/impresiones sean consistentes y los
  // colores de stickies/dibujos se vean como están diseñados).
  const gridStyle: CSSProperties = useMemo(() => {
    const size = 40 * viewport.zoom
    return {
      backgroundColor: '#ffffff',
      backgroundImage:
        'radial-gradient(circle, rgba(15,23,42,0.12) 1px, transparent 1px)',
      backgroundSize: `${size}px ${size}px`,
      backgroundPosition: `${viewport.panX}px ${viewport.panY}px`,
    }
  }, [viewport])

  return (
    <div
      ref={containerRef}
      data-testid="whiteboard-canvas"
      role="application"
      aria-label="Lienzo de la pizarra"
      style={gridStyle}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onMouseLeave={() => {
        dragRef.current = null
      }}
      className={`relative h-full w-full overflow-hidden ${
        drawingMode?.active
          ? 'cursor-crosshair'
          : panMode
            ? 'cursor-grab'
            : 'cursor-default'
      }`}
    >
      <div className="absolute inset-0" style={transformStyle}>
        {[...elements]
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((el) => (
            <WhiteboardElementView
              key={el.id}
              element={el}
              isSelected={el.id === selectedId}
              isEditing={el.id === editingId}
              onCommitEdit={onCommitEdit}
            />
          ))}
      </div>
      {/* HU-03 — Preview del trazo en curso. SVG overlay con
          transformación inversa para que los puntos en coords mundo se
          rendericen alineados con el contenido. */}
      {drawingPreview && drawingPreview.length > 1 && drawingMode && (
        <svg
          className="pointer-events-none absolute inset-0"
          style={transformStyle}
          width="100%"
          height="100%"
          overflow="visible"
        >
          <DrawingPreviewPath points={drawingPreview} brush={drawingMode.brush} />
        </svg>
      )}
      <ZoomIndicator viewport={viewport} onReset={() => setViewport(DEFAULT_VIEWPORT)} />
      {whiteboardId && (
        <LiveCursorsLayer
          channelName={`whiteboard:${whiteboardId}`}
          currentUser={currentUser ?? null}
        />
      )}
    </div>
  )
}

function DrawingPreviewPath({
  points,
  brush,
}: {
  points: { x: number; y: number }[]
  brush: 'pencil' | 'marker' | 'watercolor' | 'highlighter'
}) {
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')
  const style = (() => {
    switch (brush) {
      case 'pencil':
        return { stroke: '#0f172a', width: 2, opacity: 0.95 }
      case 'marker':
        return { stroke: '#1e3a8a', width: 6, opacity: 0.85 }
      case 'watercolor':
        return { stroke: '#7c3aed', width: 14, opacity: 0.45 }
      case 'highlighter':
        return { stroke: '#facc15', width: 18, opacity: 0.35 }
    }
  })()
  return (
    <path
      d={d}
      fill="none"
      stroke={style.stroke}
      strokeWidth={style.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={style.opacity}
    />
  )
}

function ZoomIndicator({
  viewport,
  onReset,
}: {
  viewport: ViewportState
  onReset: () => void
}) {
  return (
    <div className="absolute bottom-3 right-3 flex items-center gap-2 rounded-lg bg-card border border-border px-2 py-1 text-xs shadow-md">
      <span className="text-muted-foreground tabular-nums">
        {Math.round(viewport.zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={onReset}
        className="px-2 py-0.5 rounded hover:bg-secondary text-muted-foreground"
        aria-label="Restablecer zoom"
      >
        100%
      </button>
    </div>
  )
}

/**
 * Renderer per element. Mantiene el DOM ligero usando solo divs;
 * las shapes circulares usan `border-radius:100%` y los conectores
 * SVGs en línea con coords relativas.
 */
function WhiteboardElementView({
  element,
  isSelected,
  isEditing,
  onCommitEdit,
}: {
  element: WhiteboardElement
  isSelected: boolean
  isEditing?: boolean
  onCommitEdit?: (id: string, text: string) => void
}) {
  const baseStyle: CSSProperties = {
    position: 'absolute',
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
  }

  const ringClass = isSelected
    ? 'outline outline-2 outline-offset-2 outline-primary'
    : ''

  switch (element.type) {
    case 'STICKY': {
      const data = element.data as { color: string; text: string }
      return (
        <div
          data-element-id={element.id}
          data-testid={`sticky-${element.id}`}
          style={{ ...baseStyle, backgroundColor: data.color }}
          className={`shadow-lg rounded-md p-3 ${isEditing ? 'cursor-text' : 'cursor-grab'} text-slate-900 text-sm overflow-hidden ${ringClass}`}
        >
          {isEditing ? (
            <InlineEditor
              initial={data.text}
              onCommit={(t) => onCommitEdit?.(element.id, t)}
              multiline
              className="h-full w-full bg-transparent text-slate-900"
              placeholder="Escribe aquí…"
            />
          ) : (
            <div className="whitespace-pre-wrap break-words">
              {data.text || 'Doble click para escribir'}
            </div>
          )}
        </div>
      )
    }
    case 'SHAPE': {
      const data = element.data as { variant: string; fill: string; stroke: string; text?: string }
      const isCircle = data.variant === 'circle'
      const isTriangle = data.variant === 'triangle'
      return (
        <div
          data-element-id={element.id}
          data-testid={`shape-${element.id}`}
          style={{
            ...baseStyle,
            backgroundColor: isTriangle ? 'transparent' : data.fill,
            border: isTriangle ? 'none' : `2px solid ${data.stroke}`,
            borderRadius: isCircle ? '100%' : 6,
          }}
          className={`flex items-center justify-center text-foreground text-xs cursor-grab ${ringClass}`}
        >
          {isTriangle && (
            <svg
              viewBox={`0 0 ${element.width} ${element.height}`}
              className="absolute inset-0"
              preserveAspectRatio="none"
            >
              <polygon
                points={`${element.width / 2},0 0,${element.height} ${element.width},${element.height}`}
                fill={data.fill}
                stroke={data.stroke}
                strokeWidth={2}
              />
            </svg>
          )}
          {isEditing ? (
            <InlineEditor
              initial={data.text ?? ''}
              onCommit={(t) => onCommitEdit?.(element.id, t)}
              className="relative w-full bg-transparent text-center text-foreground"
              placeholder="Texto…"
            />
          ) : (
            data.text && <span className="relative">{data.text}</span>
          )}
        </div>
      )
    }
    case 'CONNECTOR': {
      const data = element.data as {
        points: { x: number; y: number }[]
        stroke: string
      }
      const pts = data.points.length >= 2
        ? data.points
        : [
            { x: 0, y: 0 },
            { x: element.width, y: element.height },
          ]
      const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
      return (
        <div
          data-element-id={element.id}
          data-testid={`connector-${element.id}`}
          style={baseStyle}
          className={`cursor-grab ${ringClass}`}
        >
          <svg
            viewBox={`0 0 ${element.width} ${element.height}`}
            className="h-full w-full"
            preserveAspectRatio="none"
          >
            <path d={path} stroke={data.stroke} strokeWidth={2} fill="none" />
          </svg>
        </div>
      )
    }
    case 'TEXT': {
      const data = element.data as { text: string; color: string; fontSize: number }
      return (
        <div
          data-element-id={element.id}
          data-testid={`text-${element.id}`}
          style={{ ...baseStyle, color: data.color, fontSize: data.fontSize }}
          className={`${isEditing ? 'cursor-text' : 'cursor-grab'} leading-tight ${ringClass}`}
        >
          {isEditing ? (
            <InlineEditor
              initial={data.text}
              onCommit={(t) => onCommitEdit?.(element.id, t)}
              multiline
              className="h-full w-full bg-transparent"
              style={{ color: data.color, fontSize: data.fontSize }}
              placeholder="Escribe aquí…"
            />
          ) : (
            data.text || 'Doble click para escribir'
          )}
        </div>
      )
    }
    case 'IMAGE': {
      const data = element.data as { url: string; alt: string }
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-element-id={element.id}
          data-testid={`image-${element.id}`}
          style={baseStyle}
          src={data.url}
          alt={data.alt || ''}
          className={`object-cover rounded-md cursor-grab ${ringClass}`}
        />
      )
    }
    case 'FREEHAND': {
      // HU-03 (2026-05-14) — Trazo renderizado como SVG path dentro de un
      // contenedor del tamaño del bbox. Los puntos vienen relativos al
      // origen del elemento.
      const data = element.data as {
        brush: 'pencil' | 'marker' | 'watercolor' | 'highlighter'
        stroke: string
        strokeWidth: number
        points: { x: number; y: number; p?: number }[]
      }
      // Path traducido a coords del SVG local (restamos element.x/y).
      const local = data.points.map((p) => ({
        x: p.x - element.x,
        y: p.y - element.y,
      }))
      const d = local
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ')
      const brushOpacity = {
        pencil: 0.95,
        marker: 0.85,
        watercolor: 0.45,
        highlighter: 0.35,
      }[data.brush]
      const brushBlend: React.CSSProperties['mixBlendMode'] | undefined =
        data.brush === 'watercolor' || data.brush === 'highlighter'
          ? 'multiply'
          : undefined
      return (
        <svg
          data-element-id={element.id}
          data-testid={`freehand-${element.id}`}
          style={{
            ...baseStyle,
            overflow: 'visible',
            mixBlendMode: brushBlend,
            cursor: 'grab',
          }}
          className={ringClass}
        >
          <path
            d={d}
            fill="none"
            stroke={data.stroke}
            strokeWidth={data.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={brushOpacity}
          />
        </svg>
      )
    }
  }
}

/**
 * Editor inline de texto · se monta cuando `isEditing` es true sobre un
 * elemento (sticky/text/shape). Auto-focus al montar, commit en blur o
 * Enter (sin Shift), cancela con Esc.
 */
function InlineEditor({
  initial,
  onCommit,
  multiline,
  className,
  style,
  placeholder,
}: {
  initial: string
  onCommit: (text: string) => void
  multiline?: boolean
  className?: string
  style?: CSSProperties
  placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const [value, setValue] = useState(initial)

  // Auto-focus + select-all al montar — patrón de Miro/Figma para edición.
  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.focus()
    if ('select' in node) node.select()
  }, [])

  const commit = useCallback(() => {
    onCommit(value.trim())
  }, [onCommit, value])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCommit(initial)
    } else if (e.key === 'Enter' && !e.shiftKey && !multiline) {
      e.preventDefault()
      commit()
    } else if (e.key === 'Enter' && !e.shiftKey && multiline && e.metaKey) {
      e.preventDefault()
      commit()
    }
  }

  // Evita que mousedown sobre el editor propague al canvas (no inicia drag).
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation()

  if (multiline) {
    return (
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        onMouseDown={stopPropagation}
        placeholder={placeholder}
        style={style}
        className={`resize-none border-0 outline-none ring-0 ${className ?? ''}`}
      />
    )
  }

  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onMouseDown={stopPropagation}
      placeholder={placeholder}
      style={style}
      className={`border-0 outline-none ring-0 ${className ?? ''}`}
    />
  )
}

export { worldToScreen }
