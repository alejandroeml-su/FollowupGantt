'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from 'react'
import {
  DEFAULT_VIEWPORT,
  type ViewportState,
  type WhiteboardElement,
} from '@/lib/whiteboards/types'
import { snapPoint, stepZoom, screenToWorld, worldToScreen } from '@/lib/whiteboards/geometry'

type Props = {
  elements: WhiteboardElement[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMove: (id: string, next: { x: number; y: number }) => void
  /** Click sobre el lienzo vacío en coords mundo. Útil para insertar con tool activo. */
  onCanvasClick?: (worldPoint: { x: number; y: number }) => void
  snapEnabled: boolean
  /** Si está en true, el background usa cursor "grab" para indicar pan con space. */
  panMode?: boolean
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
  onSelect,
  onMove,
  onCanvasClick,
  snapEnabled,
  panMode = false,
}: Props) {
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    kind: 'pan' | 'element'
    elementId?: string
    startScreen: { x: number; y: number }
    startWorld: { x: number; y: number }
    startElementWorld?: { x: number; y: number }
    moved: boolean
  } | null>(null)

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
    [elements, onSelect, panMode, viewport],
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
    [eventToWorld, onCanvasClick, onSelect],
  )

  const transformStyle: CSSProperties = useMemo(
    () => ({
      transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
      transformOrigin: '0 0',
    }),
    [viewport],
  )

  // Build grid background — pattern con CSS background-image (gradients).
  const gridStyle: CSSProperties = useMemo(() => {
    const size = 40 * viewport.zoom
    return {
      backgroundImage:
        'radial-gradient(circle, rgba(148,163,184,0.18) 1px, transparent 1px)',
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
      onMouseLeave={() => {
        dragRef.current = null
      }}
      className={`relative h-full w-full overflow-hidden bg-slate-950 ${
        panMode ? 'cursor-grab' : 'cursor-default'
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
            />
          ))}
      </div>
      <ZoomIndicator viewport={viewport} onReset={() => setViewport(DEFAULT_VIEWPORT)} />
    </div>
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
}: {
  element: WhiteboardElement
  isSelected: boolean
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
          className={`shadow-lg rounded-md p-3 cursor-grab text-slate-900 text-sm overflow-hidden ${ringClass}`}
        >
          <div className="whitespace-pre-wrap break-words">{data.text || 'Sticky vacío'}</div>
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
          {data.text && <span className="relative">{data.text}</span>}
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
          className={`cursor-grab leading-tight ${ringClass}`}
        >
          {data.text}
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
  }
}

export { worldToScreen }
