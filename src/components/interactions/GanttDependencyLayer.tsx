'use client'

import { useMemo } from 'react'
import { clsx } from 'clsx'

/**
 * Posición pre-calculada de cada barra del Gantt en píxeles, lista para
 * que el SVG dibuje las flechas. El caller (página demo o GanttBoardClient)
 * la calcula y la pasa.
 */
export interface GanttTaskPosition {
  id: string
  /** Coordenada X del extremo izquierdo de la barra (px). */
  left: number
  /** Coordenada X del extremo derecho de la barra (px). */
  right: number
  /** Centro vertical de la fila de la tarea (px). */
  middleY: number
}

/** Dependencia entre dos tareas. POC sólo dibuja FS. */
export interface GanttDependencyEdge {
  /** Id de BD — necesario para que el editor (HU-1.4) pueda actualizar/borrar. */
  id: string
  predecessorId: string
  successorId: string
  type: 'FS' | 'SS' | 'FF' | 'SF'
  lagDays: number
  /** Si la dependencia forma parte de la ruta crítica (color rojo). */
  isCritical?: boolean
}

interface Props {
  tasks: GanttTaskPosition[]
  dependencies: GanttDependencyEdge[]
  /** Ancho total del lienzo (px) — coincide con el ancho del grid del Gantt. */
  width: number
  /** Alto total del lienzo (px) — coincide con (#filas * altura de fila). */
  height: number
  /**
   * HU-1.4 · Click derecho sobre la flecha. Recibe la dep y la posición
   * (clientX/clientY del evento, para anclar el menú/dialog en pantalla).
   */
  onDependencyContextMenu?: (
    dep: GanttDependencyEdge,
    event: { clientX: number; clientY: number },
  ) => void
}

/**
 * Capa SVG absolutamente posicionada que dibuja flechas entre tareas
 * dependientes. POC: sólo dependencias `FS` (Finish-to-Start).
 *
 * Diseño de la flecha (estilo MS Project):
 *   1. Sale del borde derecho del predecesor.
 *   2. Avanza horizontalmente un pequeño offset.
 *   3. Baja/sube verticalmente hasta la fila del sucesor.
 *   4. Entra horizontalmente al borde izquierdo del sucesor.
 *
 * Para mantener la prueba simple no usamos Bézier; trazos en L-shape son
 * más legibles con muchas filas. Se puede sustituir por bezier en sprint 6.
 */
export function GanttDependencyLayer({
  tasks,
  dependencies,
  width,
  height,
  onDependencyContextMenu,
}: Props) {
  const positionMap = useMemo(() => {
    const m = new Map<string, GanttTaskPosition>()
    for (const t of tasks) m.set(t.id, t)
    return m
  }, [tasks])

  const paths = useMemo(() => {
    const result: {
      d: string
      key: string
      isCritical: boolean
      dep: GanttDependencyEdge
    }[] = []
    const HORIZ_OFFSET = 12 // px de salida horizontal antes de doblar

    for (const dep of dependencies) {
      // POC: sólo FS. El resto se difiere a sprint 6.
      if (dep.type !== 'FS') continue
      const p = positionMap.get(dep.predecessorId)
      const s = positionMap.get(dep.successorId)
      if (!p || !s) continue

      const startX = p.right
      const startY = p.middleY
      const endX = s.left
      const endY = s.middleY

      // Caso típico: el sucesor está más a la derecha. Si no (lead/solapa),
      // dibujamos la flecha rodeando por debajo del predecesor.
      const midX = endX - HORIZ_OFFSET
      let d: string
      if (midX > startX + HORIZ_OFFSET / 2) {
        // L-shape: → ↓/↑ →
        d = `M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`
      } else {
        // Rodeo: ← ↓/↑ → (predecesor termina después del inicio del sucesor).
        const detourX = startX + HORIZ_OFFSET
        d = `M ${startX} ${startY} H ${detourX} V ${(startY + endY) / 2} H ${endX - HORIZ_OFFSET} V ${endY} H ${endX}`
      }
      result.push({
        d,
        key: dep.id || `${dep.predecessorId}->${dep.successorId}`,
        isCritical: !!dep.isCritical,
        dep,
      })
    }
    return result
  }, [dependencies, positionMap])

  // Si hay handler de menú, las flechas reciben pointer events (clic derecho).
  // En modo "view-only" la capa entera mantiene `pointer-events-none` para no
  // robar foco al canvas (drag, etc).
  const interactive = !!onDependencyContextMenu

  return (
    <svg
      aria-hidden={!interactive}
      className={clsx(
        'absolute left-0 top-0',
        // Modo view-only: el SVG entero ignora pointer events para no
        // robar foco al canvas. Modo interactivo: el SVG sí los recibe,
        // pero solo los `<path>` con `pointer-events-stroke` los procesan
        // (los demás restauran `pointer-events-none` explícitamente).
        interactive ? 'pointer-events-auto' : 'pointer-events-none',
      )}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <marker
          id="gantt-arrow-default"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-muted-foreground" />
        </marker>
        <marker
          id="gantt-arrow-critical"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="fill-red-500" />
        </marker>
      </defs>
      {paths.map((p) => (
        <g key={p.key}>
          {/* Path ancho transparente (hit-area) para que el clic derecho sea
              fácil de aterrizar — la flecha visible es de 1.5–2 px. */}
          {interactive && (
            <path
              d={p.d}
              fill="none"
              strokeWidth={12}
              stroke="transparent"
              className="pointer-events-stroke cursor-context-menu"
              data-dep-id={p.dep.id}
              onContextMenu={(e) => {
                e.preventDefault()
                onDependencyContextMenu?.(p.dep, {
                  clientX: e.clientX,
                  clientY: e.clientY,
                })
              }}
            />
          )}
          <path
            d={p.d}
            fill="none"
            strokeWidth={p.isCritical ? 2 : 1.5}
            className={
              p.isCritical
                ? 'stroke-red-500 pointer-events-none'
                : 'stroke-muted-foreground/70 pointer-events-none'
            }
            markerEnd={
              p.isCritical
                ? 'url(#gantt-arrow-critical)'
                : 'url(#gantt-arrow-default)'
            }
          />
        </g>
      ))}
    </svg>
  )
}
