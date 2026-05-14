'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
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
  /** HU-12 (2026-05-14) — Conjunto de ids seleccionados (multi-select).
   *  Si no se pasa, el canvas opera en modo single-select clásico. */
  selectedIds?: Set<string>
  /** Elemento actualmente en modo edición inline (textarea visible). */
  editingId?: string | null
  /** HU-12 — segundo argumento `additive` (Shift/Ctrl/Cmd) → toggle del id
   *  en el set de seleccionados en vez de reemplazar. */
  onSelect: (id: string | null, additive?: boolean) => void
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
   *
   * HU-04 (2026-05-14) — segundo argumento `holdReleased` indica que el
   * usuario mantuvo el cursor inmóvil >400ms antes de soltar el botón.
   * El editor usa este flag para invocar `recognizeShape` y convertir
   * el trazo en una SHAPE perfecta cuando aplique.
   */
  onDrawingCommit?: (
    points: { x: number; y: number }[],
    holdReleased: boolean,
  ) => void
  /**
   * HU-02 (2026-05-14) — Drop de archivos sobre el lienzo. Recibe la
   * lista de File del DataTransfer + el punto en coordenadas mundo
   * donde se soltó (centro del primer archivo). El editor maneja el
   * upload/decode + creación de elementos IMAGE.
   */
  onFilesDropped?: (files: File[], worldPoint: { x: number; y: number }) => void
  /** HU-02 — Drop de texto (incluye URLs). El editor decide si crear
   *  un link-card o un TEXT plain. */
  onTextDropped?: (text: string, worldPoint: { x: number; y: number }) => void
  /** HU-07 (2026-05-14) — Override del viewport desde fuera. Si se
   *  provee, el canvas usa este viewport en vez de su state interno.
   *  Útil cuando el usuario está "siguiendo a un moderador" — el editor
   *  mantiene el viewport del host y lo pasa por aquí. */
  externalViewport?: ViewportState | null
  /** HU-07 — Notifica al editor cada cambio de viewport interno (pan,
   *  zoom). Permite al editor reenviar la posición via broadcast si el
   *  usuario es host. */
  onViewportChange?: (viewport: ViewportState) => void
  /** HU-15 (2026-05-14) — Resize de un elemento. Recibe el nuevo bbox.
   *  El editor aplica al state + autosave existente. */
  onResize?: (
    id: string,
    next: { x: number; y: number; width: number; height: number },
  ) => void
}

// HU-15 — Lados del bbox para resize. nw=northwest (esquina arriba-izq).
export type ResizeSide = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

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
  selectedIds,
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
  onFilesDropped,
  onTextDropped,
  externalViewport,
  onViewportChange,
  onResize,
}: Props) {
  const [internalViewport, setInternalViewport] = useState<ViewportState>(DEFAULT_VIEWPORT)
  // HU-07 — Si hay `externalViewport`, lo usamos (modo "siguiendo a un
  // moderador"). El usuario aún puede mover su rueda y eso emite
  // `onViewportChange` pero el editor decide si aplicar o no (típico:
  // mientras sigue, ignora sus inputs hasta que rompe el follow).
  const viewport = externalViewport ?? internalViewport
  const setViewport = useCallback(
    (next: ViewportState | ((prev: ViewportState) => ViewportState)) => {
      setInternalViewport((prev) => {
        const value = typeof next === 'function' ? next(prev) : next
        onViewportChange?.(value)
        return value
      })
    },
    [onViewportChange],
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{
    kind: 'pan' | 'element' | 'draw'
    elementId?: string
    startScreen: { x: number; y: number }
    startWorld: { x: number; y: number }
    startElementWorld?: { x: number; y: number }
    moved: boolean
    /** HU-03/11 — cuando kind='draw', va acumulando puntos en coords
     *  mundo. `p` (presión 0..1) opcional para pen events. */
    drawPoints?: { x: number; y: number; p?: number }[]
  } | null>(null)
  // HU-03 — estado del trazo en curso para repintar el preview en cada move.
  const [drawingPreview, setDrawingPreview] = useState<
    { x: number; y: number; p?: number }[] | null
  >(null)
  // HU-12 — Snapshot de la posición inicial de cada elemento durante un
  // drag de multi-selección. Se llena lazy en el primer mousemove para
  // que el cálculo del delta funcione con todos los elementos al mismo
  // delta (no acumulando errores de redondeo del snap).
  const dragOriginsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  // HU-04 (2026-05-14) — Timestamp del último mousemove durante un draw.
  // Si en mouseup el delta vs Date.now() supera 400ms, asumimos
  // "hold-on-release" y pedimos al editor que intente reconocer la forma.
  const lastDrawMoveTsRef = useRef<number>(0)
  // HU-15 (2026-05-14) — Resize state. Cuando el usuario hace mousedown
  // en un handle, almacenamos el lado (nw/n/ne/e/se/s/sw/w), el bbox
  // inicial del elemento y la posición inicial del mouse. El move
  // recalcula el nuevo bbox según el lado arrastrado.
  const resizeRef = useRef<{
    elementId: string
    side: ResizeSide
    startWorld: { x: number; y: number }
    startBox: { x: number; y: number; width: number; height: number }
  } | null>(null)
  // HU-11 (2026-05-14) — Palm rejection: si llega un pointer de tipo
  // 'pen', marcamos un timestamp; durante los siguientes 1500ms ignoramos
  // pointers de tipo 'touch' (típico: usuario apoya la palma mientras
  // dibuja con Apple Pencil / S Pen). En iPad/iPadOS la OS ya hace este
  // filtrado pero en otros dispositivos el browser puede no hacerlo.
  const lastPenActivityRef = useRef<number>(0)

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
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // HU-11 (2026-05-14) — Pointer Events para soportar presión + tilt
      // y permitir palm rejection. Si llega un 'pen', marcamos timestamp.
      // Si llega 'touch' dentro de 1500ms tras un evento 'pen', ignoramos
      // (el usuario apoyó la palma mientras dibuja con stylus).
      if (e.pointerType === 'pen') {
        lastPenActivityRef.current = Date.now()
      } else if (
        e.pointerType === 'touch' &&
        Date.now() - lastPenActivityRef.current < 1500
      ) {
        return
      }

      const target = e.target as HTMLElement
      const elementHandle = target.closest('[data-element-id]') as HTMLElement | null

      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      const world = screenToWorld(screen, viewport)

      // HU-15 (2026-05-14) — Resize handle. Si el click cayó sobre un
      // `data-resize-handle`, entramos modo resize antes que cualquier
      // otro flujo.
      const handleEl = target.closest('[data-resize-handle]') as HTMLElement | null
      if (handleEl && !panMode) {
        const elementId = handleEl.dataset.resizeElement!
        const side = handleEl.dataset.resizeHandle as ResizeSide
        const el = elements.find((x) => x.id === elementId)
        if (el && !el.locked) {
          resizeRef.current = {
            elementId,
            side,
            startWorld: world,
            startBox: { x: el.x, y: el.y, width: el.width, height: el.height },
          }
          e.stopPropagation()
          return
        }
      }

      // HU-03 — modo dibujo: cualquier mousedown sobre el lienzo inicia
      // un trazo nuevo. Tiene prioridad sobre la selección de elemento
      // (queremos dibujar encima sin seleccionar el sticky por error).
      if (drawingMode?.active && !panMode) {
        // HU-11 — guardamos la presión inicial. Para mouse el browser
        // reporta 0.5 (constante) → trazo de grosor uniforme. Para pen
        // varía 0..1 → grosor proporcional en el renderer.
        const initialPoint = { ...world, p: e.pressure || 0.5 }
        dragRef.current = {
          kind: 'draw',
          startScreen: screen,
          startWorld: world,
          moved: false,
          drawPoints: [initialPoint],
        }
        // HU-04 — marcamos timestamp inicial. Si el usuario presiona sin
        // moverse y suelta, la diferencia será >400ms y se intentará
        // reconocer forma (con un solo punto no se reconoce nada, pero
        // si el path es corto y estático sí podemos detectarlo).
        lastDrawMoveTsRef.current = Date.now()
        setDrawingPreview([world])
        return
      }

      if (elementHandle && !panMode) {
        const elementId = elementHandle.dataset.elementId!
        const el = elements.find((x) => x.id === elementId)
        if (!el) return
        // HU-12 — Elementos bloqueados no se pueden mover. Sí permitimos
        // seleccionarlos (con click) para mostrar la opción "Desbloquear".
        const additive = e.shiftKey || e.ctrlKey || e.metaKey
        if (el.locked) {
          onSelect(elementId, additive)
          return
        }
        dragRef.current = {
          kind: 'element',
          elementId,
          startScreen: screen,
          startWorld: world,
          startElementWorld: { x: el.x, y: el.y },
          moved: false,
        }
        onSelect(elementId, additive)
      } else {
        // Click en fondo SIN shift → deselecciona todo (en handleMouseUp).
        // Con shift, dejamos `pan` para no romper la selección actual.
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
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // HU-15 (2026-05-14) — Resize en progreso.
      const resize = resizeRef.current
      if (resize) {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
        const world = screenToWorld(screen, viewport)
        const dx = world.x - resize.startWorld.x
        const dy = world.y - resize.startWorld.y
        const box = { ...resize.startBox }
        // Aplica delta según el lado arrastrado. Esquinas mueven 2 ejes.
        if (resize.side.includes('e')) box.width = Math.max(20, resize.startBox.width + dx)
        if (resize.side.includes('s')) box.height = Math.max(20, resize.startBox.height + dy)
        if (resize.side.includes('w')) {
          const newW = Math.max(20, resize.startBox.width - dx)
          box.x = resize.startBox.x + (resize.startBox.width - newW)
          box.width = newW
        }
        if (resize.side.includes('n')) {
          const newH = Math.max(20, resize.startBox.height - dy)
          box.y = resize.startBox.y + (resize.startBox.height - newH)
          box.height = newH
        }
        onResize?.(resize.elementId, box)
        return
      }

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
          // HU-11 — capturamos presión del pointer. Mouse reporta 0.5
          // constante; pen reporta 0..1 según fuerza. Browser fallback
          // a 0.5 si no se reporta.
          drag.drawPoints.push({ ...world, p: e.pressure || 0.5 })
          // HU-04 — marcamos timestamp del último movimiento real para
          // detectar hold-on-release en mouseup.
          lastDrawMoveTsRef.current = Date.now()
          // Forzamos un re-render solo cada N puntos para no saturar React.
          if (drag.drawPoints.length % 2 === 0) {
            setDrawingPreview([...drag.drawPoints])
          }
        }
      } else if (drag.kind === 'element' && drag.elementId && drag.startElementWorld) {
        const world = screenToWorld(screen, viewport)
        // HU-12 — si el elemento arrastrado está en multi-selección O
        // tiene un grupo en común con el set, movemos todos en bloque
        // por el mismo delta. El editor (`onMove`) ya hace persistencia
        // y autosave por id; aquí solo notificamos cada cambio.
        const draggedEl = elements.find((e) => e.id === drag.elementId)
        const groupMates = draggedEl?.groupId
          ? elements.filter((e) => e.groupId === draggedEl.groupId).map((e) => e.id)
          : []
        const moveSet = new Set<string>([
          drag.elementId,
          ...groupMates,
          ...(selectedIds && selectedIds.has(drag.elementId)
            ? Array.from(selectedIds)
            : []),
        ])
        // Delta en coords mundo desde el start del drag.
        const deltaX = world.x - drag.startWorld.x
        const deltaY = world.y - drag.startWorld.y
        for (const id of moveSet) {
          const target = elements.find((e) => e.id === id)
          if (!target || target.locked) continue
          // Cada elemento se mueve desde SU posición original. Para
          // saberla, guardamos un snapshot en el primer move (lazy).
          const origin = dragOriginsRef.current.get(id) ?? { x: target.x, y: target.y }
          if (!dragOriginsRef.current.has(id)) {
            dragOriginsRef.current.set(id, origin)
          }
          const next = snapPoint(
            { x: origin.x + deltaX, y: origin.y + deltaY },
            snapEnabled,
          )
          onMove(id, next)
        }
      }
    },
    [onMove, snapEnabled, viewport],
  )

  const handleMouseUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // HU-15 — Cerrar resize.
      if (resizeRef.current) {
        resizeRef.current = null
        return
      }
      const drag = dragRef.current
      dragRef.current = null
      dragOriginsRef.current.clear()
      if (!drag) return
      // HU-03 — commit del trazo dibujado. Si el usuario hizo click sin
      // mover (drawPoints.length === 1), descartamos: probablemente fue
      // un click accidental (no queremos crear elementos con 1 punto).
      if (drag.kind === 'draw' && drag.drawPoints) {
        const points = drag.drawPoints
        setDrawingPreview(null)
        if (points.length >= 2 && onDrawingCommit) {
          // HU-04 — `holdReleased` = el usuario detuvo el cursor >400ms
          // antes de soltar. Es la señal UX para "convertir a forma".
          const idleMs = Date.now() - lastDrawMoveTsRef.current
          const holdReleased = idleMs > 400
          onDrawingCommit(points, holdReleased)
        }
        lastDrawMoveTsRef.current = 0
        return
      }
      // Click en fondo sin drag → deselecciona o emite onCanvasClick (insertar).
      // HU-12 — con Shift presionado NO deseleccionamos (permite hacer
      // shift+click en fondo sin perder el set actual).
      if (drag.kind === 'pan' && !drag.moved) {
        const world = eventToWorld(e)
        if (onCanvasClick) {
          onCanvasClick(world)
        } else if (!(e.shiftKey || e.ctrlKey || e.metaKey)) {
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
      // HU-11 (2026-05-14) — `touchAction: 'none'` evita el scroll del
      // browser cuando el usuario dibuja con dedo/stylus. Crítico para
      // que los pointer events de tipo 'touch'/'pen' lleguen a nuestros
      // handlers en lugar de ser tragados por el scroll nativo.
      style={{ ...gridStyle, touchAction: 'none' }}
      onWheel={handleWheel}
      onPointerDown={handleMouseDown}
      onPointerMove={handleMouseMove}
      onPointerUp={handleMouseUp}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onPointerLeave={() => {
        dragRef.current = null
      }}
      onDragOver={(e) => {
        // HU-02 — Habilitar drop. Necesario llamar preventDefault
        // tanto en dragover como en dragenter para que onDrop dispare.
        if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        const world = eventToWorld(e)
        const files = e.dataTransfer.files
        if (files && files.length > 0 && onFilesDropped) {
          onFilesDropped(Array.from(files), world)
          return
        }
        // Fallback: enlace o texto plain
        const uri = e.dataTransfer.getData('text/uri-list')
        const txt = e.dataTransfer.getData('text/plain')
        const dropped = uri || txt
        if (dropped && onTextDropped) {
          onTextDropped(dropped, world)
        }
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
              elements={elements}
              isSelected={
                el.id === selectedId ||
                (selectedIds ? selectedIds.has(el.id) : false)
              }
              isEditing={el.id === editingId}
              onCommitEdit={onCommitEdit}
            />
          ))}
        {/* HU-15 (2026-05-14) — Resize handles. Solo si hay un único
            element seleccionado, no está en modo edit, no está locked,
            y onResize está provisto. Multi-selection no muestra handles
            (deuda: bbox combinado del set + scale proporcional). */}
        {selectedId && onResize && !editingId && (() => {
          const sel = elements.find((e) => e.id === selectedId)
          if (!sel || sel.locked) return null
          return <ResizeHandles element={sel} />
        })()}
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
  elements,
  isSelected,
  isEditing,
  onCommitEdit,
}: {
  element: WhiteboardElement
  /** HU-05 (2026-05-14) — Necesitamos la lista completa para que los
   *  CONNECTOR con `fromId`/`toId` recalculen sus endpoints a partir
   *  de las posiciones actuales de los elementos vinculados. */
  elements: WhiteboardElement[]
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
    ? element.locked
      ? 'outline outline-2 outline-offset-2 outline-amber-400'
      : 'outline outline-2 outline-offset-2 outline-primary'
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
        fromId?: string | null
        toId?: string | null
      }

      // HU-05 (2026-05-14) — Si el conector tiene `fromId`/`toId` set
      // (smart connector), recalculamos los endpoints en coordenadas
      // mundo a partir del centro de los elementos vinculados. Esto
      // logra el "reajuste automático al mover el objeto" sin necesidad
      // de actualizar el conector en BD cada vez que un elemento se
      // mueve. Si el lookup falla (elemento borrado), caemos al
      // comportamiento legacy de `points` flotantes.
      const fromEl = data.fromId ? elements.find((e) => e.id === data.fromId) : null
      const toEl = data.toId ? elements.find((e) => e.id === data.toId) : null

      let absStart: { x: number; y: number } | null = null
      let absEnd: { x: number; y: number } | null = null
      if (fromEl) {
        absStart = { x: fromEl.x + fromEl.width / 2, y: fromEl.y + fromEl.height / 2 }
      }
      if (toEl) {
        absEnd = { x: toEl.x + toEl.width / 2, y: toEl.y + toEl.height / 2 }
      }

      // Si tenemos al menos un anchor smart, renderizamos como una
      // <line> en coords mundo (overlay) en lugar del SVG con viewBox.
      // Combinamos: si solo from está anchored, el otro endpoint sale
      // de los `points` (flotante) trasladados al sistema mundo.
      const localPts =
        data.points.length >= 2
          ? data.points
          : [
              { x: 0, y: 0 },
              { x: element.width, y: element.height },
            ]
      const fallbackStart = { x: element.x + localPts[0].x, y: element.y + localPts[0].y }
      const fallbackEnd = {
        x: element.x + localPts[localPts.length - 1].x,
        y: element.y + localPts[localPts.length - 1].y,
      }
      const finalStart = absStart ?? fallbackStart
      const finalEnd = absEnd ?? fallbackEnd

      // Bounding box del conector — abarca ambos endpoints con padding.
      const PAD = 6
      const minX = Math.min(finalStart.x, finalEnd.x) - PAD
      const minY = Math.min(finalStart.y, finalEnd.y) - PAD
      const maxX = Math.max(finalStart.x, finalEnd.x) + PAD
      const maxY = Math.max(finalStart.y, finalEnd.y) + PAD
      const bw = maxX - minX
      const bh = maxY - minY

      const smartStyle: CSSProperties = {
        position: 'absolute',
        left: minX,
        top: minY,
        width: bw,
        height: bh,
      }
      return (
        <div
          data-element-id={element.id}
          data-testid={`connector-${element.id}`}
          style={smartStyle}
          className={`pointer-events-none ${ringClass}`}
        >
          <svg
            viewBox={`0 0 ${bw} ${bh}`}
            className="h-full w-full"
            preserveAspectRatio="none"
          >
            <defs>
              <marker
                id={`arrow-${element.id}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={data.stroke} />
              </marker>
            </defs>
            <line
              x1={finalStart.x - minX}
              y1={finalStart.y - minY}
              x2={finalEnd.x - minX}
              y2={finalEnd.y - minY}
              stroke={data.stroke}
              strokeWidth={2}
              fill="none"
              markerEnd={`url(#arrow-${element.id})`}
              className="pointer-events-auto cursor-pointer"
            />
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
      const data = element.data as {
        url: string
        alt: string
        mimeType?: string
        filename?: string
      }
      // HU-02 (2026-05-14) — Render condicional por mimeType.
      const isPdf = data.mimeType === 'application/pdf'
      const isVideo = data.mimeType?.startsWith('video/') === true
      const isAudio = data.mimeType?.startsWith('audio/') === true
      if (isPdf) {
        return (
          <div
            data-element-id={element.id}
            data-testid={`pdf-${element.id}`}
            style={baseStyle}
            className={`overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm cursor-grab ${ringClass}`}
            title={data.filename ?? data.alt}
          >
            <embed
              src={data.url}
              type="application/pdf"
              className="pointer-events-none h-full w-full"
              aria-label={data.alt || data.filename || 'PDF'}
            />
          </div>
        )
      }
      if (isVideo) {
        return (
          <div
            data-element-id={element.id}
            data-testid={`video-${element.id}`}
            style={baseStyle}
            className={`overflow-hidden rounded-md bg-black cursor-grab ${ringClass}`}
            title={data.filename ?? data.alt}
          >
            <video
              src={data.url}
              controls
              className="h-full w-full object-contain"
              aria-label={data.alt || data.filename || 'Video'}
            />
          </div>
        )
      }
      if (isAudio) {
        return (
          <div
            data-element-id={element.id}
            data-testid={`audio-${element.id}`}
            style={baseStyle}
            className={`flex items-center rounded-md bg-slate-100 border border-slate-300 p-2 cursor-grab ${ringClass}`}
            title={data.filename ?? data.alt}
          >
            <audio
              src={data.url}
              controls
              className="w-full"
              aria-label={data.alt || data.filename || 'Audio'}
            />
          </div>
        )
      }
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-element-id={element.id}
          data-testid={`image-${element.id}`}
          style={baseStyle}
          src={data.url}
          alt={data.alt || data.filename || ''}
          className={`object-cover rounded-md cursor-grab ${ringClass}`}
        />
      )
    }
    case 'FREEHAND': {
      // HU-03 (2026-05-14) — Trazo renderizado como SVG path dentro de un
      // contenedor del tamaño del bbox. Los puntos vienen relativos al
      // origen del elemento.
      //
      // HU-11 (2026-05-14) — Si los puntos tienen variación de `p`
      // (presión > 0.1 de rango) renderizamos el trazo como múltiples
      // segmentos cortos, cada uno con strokeWidth proporcional al
      // promedio de la presión de los 2 puntos. Si todos los puntos
      // tienen presión similar (típico mouse), renderizamos un único
      // path para mantener performance.
      const data = element.data as {
        brush: 'pencil' | 'marker' | 'watercolor' | 'highlighter'
        stroke: string
        strokeWidth: number
        points: { x: number; y: number; p?: number }[]
      }
      const local = data.points.map((p) => ({
        x: p.x - element.x,
        y: p.y - element.y,
        p: p.p ?? 0.5,
      }))
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

      // Detección de variación de presión: si el rango max-min < 0.1
      // asumimos input uniforme (mouse) y renderizamos como single path.
      let minP = 1
      let maxP = 0
      for (const p of local) {
        if (p.p < minP) minP = p.p
        if (p.p > maxP) maxP = p.p
      }
      const hasPressureVariation = maxP - minP > 0.1

      if (!hasPressureVariation || local.length < 3) {
        // Single path — caso mouse o muy pocos puntos.
        const d = local
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(' ')
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

      // Variable-width — segmentamos pares de puntos. Cada segmento es
      // un <line> con strokeWidth = baseWidth * avg(p1.p, p2.p) * 2.
      // Multiplicamos por 2 para que p=1 → 2× width nominal, p=0 → 0.
      const segments: Array<{
        x1: number
        y1: number
        x2: number
        y2: number
        w: number
      }> = []
      for (let i = 1; i < local.length; i++) {
        const a = local[i - 1]
        const b = local[i]
        const avgP = (a.p + b.p) / 2
        segments.push({
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          w: data.strokeWidth * avgP * 2,
        })
      }
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
          {segments.map((s, i) => (
            <line
              key={i}
              x1={s.x1}
              y1={s.y1}
              x2={s.x2}
              y2={s.y2}
              stroke={data.stroke}
              strokeWidth={s.w}
              strokeLinecap="round"
              opacity={brushOpacity}
            />
          ))}
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

/**
 * HU-15 (2026-05-14) — Componente de handles de resize.
 *
 * Renderiza 8 cuadrados absolute-positioned alrededor del bbox del
 * elemento seleccionado. Cada handle tiene `data-resize-handle` con el
 * código del lado (nw, n, ne, e, se, s, sw, w) y `data-resize-element`
 * con el id. El canvas detecta el mousedown sobre estos atributos en
 * `handleMouseDown` y entra en modo resize.
 */
function ResizeHandles({ element }: { element: WhiteboardElement }) {
  const SIZE = 10
  const half = SIZE / 2
  const HANDLE_STYLE = (cursor: string): CSSProperties => ({
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    background: '#fff',
    border: '1.5px solid #4f46e5',
    borderRadius: 2,
    cursor,
    zIndex: 50,
  })
  const handles: Array<{
    side: ResizeSide
    style: CSSProperties
    cursor: string
  }> = [
    { side: 'nw', cursor: 'nwse-resize', style: { left: -half, top: -half } },
    { side: 'n', cursor: 'ns-resize', style: { left: element.width / 2 - half, top: -half } },
    { side: 'ne', cursor: 'nesw-resize', style: { left: element.width - half, top: -half } },
    { side: 'e', cursor: 'ew-resize', style: { left: element.width - half, top: element.height / 2 - half } },
    { side: 'se', cursor: 'nwse-resize', style: { left: element.width - half, top: element.height - half } },
    { side: 's', cursor: 'ns-resize', style: { left: element.width / 2 - half, top: element.height - half } },
    { side: 'sw', cursor: 'nesw-resize', style: { left: -half, top: element.height - half } },
    { side: 'w', cursor: 'ew-resize', style: { left: -half, top: element.height / 2 - half } },
  ]
  return (
    <div
      style={{
        position: 'absolute',
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    >
      {handles.map((h) => (
        <div
          key={h.side}
          data-resize-handle={h.side}
          data-resize-element={element.id}
          style={{
            ...HANDLE_STYLE(h.cursor),
            ...h.style,
            pointerEvents: 'auto',
          }}
        />
      ))}
    </div>
  )
}
