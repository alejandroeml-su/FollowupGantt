'use client'

import { useMemo } from 'react'
import { clsx } from 'clsx'
import type { SerializedTask } from '@/lib/types'
import type { BaselineSnapshot } from '@/lib/scheduling/baseline-snapshot'
import {
  buildVarianceMap,
  describeBaselineBar,
  type TaskVariance,
} from '@/lib/scheduling/baseline-variance'

/**
 * HU-3.3 · Capa de barras fantasma de la línea base activa.
 *
 * Posición en la pila de capas del canvas Gantt (z-index ladder):
 *   z-0   grid background (weekend tinting)
 *   z-5   GanttBaselineLayer  ← este componente
 *   z-10  Filas + barras reales
 *   z-20  GanttDependencyLayer (flechas SVG)
 *   z-30  Pill leyenda flotante
 *   z-50  Modals (Dialog Radix)
 *
 * El componente es `pointer-events-none`: nunca intercepta clics. Cada
 * barra fantasma rinde como `<div role="img">` con `aria-label`
 * descriptivo (ver `describeBaselineBar`) para que el lector de
 * pantalla anuncie posición y delta.
 *
 * Doble codificación (WCAG 1.4.1):
 *   - patrón dashed (border-dashed)
 *   - opacidad reducida (60%)
 *   - altura distinta (12px vs 20px de la barra real)
 *   - posición vertical desplazada hacia abajo
 * No depende solo de color — el dashed + height son suficientes para
 * usuarios con daltonismo o monitores monocromos.
 *
 * Performance: el cálculo de varianza y posiciones está memoizado
 * keyed por (snapshot, dayWidth, rangeStart, tasks). Sin baseline
 * activa el componente no se monta (la decisión la toma el padre).
 */

const GHOST_HEIGHT_PX = 12

type GanttBaselineLayerProps = {
  tasks: readonly SerializedTask[]
  snapshot: BaselineSnapshot | null
  /** Versión visible al usuario (label "Línea base v.{N}"). */
  baselineVersion: number
  /** Ancho en píxeles de un día — coincide con DAY_WIDTH del board. */
  dayWidth: number
  /** Primera fecha visible (UTC, inclusive). */
  rangeStart: Date
  /** Días totales del rango horizontal. */
  rangeDays: number
  /** Altura de cada fila — coincide con ROW_HEIGHT del board. */
  rowHeight: number
}

const MS_PER_DAY = 86_400_000

function diffDaysUtc(from: Date, to: Date): number {
  return Math.round(
    (Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) /
      MS_PER_DAY,
  )
}

type GhostBar = {
  id: string
  left: number
  width: number
  top: number
  ariaLabel: string
  variance: TaskVariance
}

export function GanttBaselineLayer({
  tasks,
  snapshot,
  baselineVersion,
  dayWidth,
  rangeStart,
  rangeDays,
  rowHeight,
}: GanttBaselineLayerProps) {
  const ghostBars = useMemo<GhostBar[]>(() => {
    if (!snapshot) return []
    const variance = buildVarianceMap(
      tasks.map((t) => ({
        id: t.id,
        startDate: t.startDate ?? null,
        endDate: t.endDate ?? null,
      })),
      snapshot,
    )
    const out: GhostBar[] = []
    tasks.forEach((task, index) => {
      const v = variance.get(task.id)
      if (!v) return
      // Sin barra fantasma para tareas creadas después del baseline o
      // sin fechas planificadas — alivia ruido visual y respeta el spec.
      if (v.classification === 'missing') return
      if (!v.plannedStart || !v.plannedEnd) return
      const ps = new Date(v.plannedStart)
      const pe = new Date(v.plannedEnd)
      if (isNaN(ps.getTime()) || isNaN(pe.getTime())) return
      const startDay = diffDaysUtc(rangeStart, ps)
      const endDay = diffDaysUtc(rangeStart, pe) + 1 // exclusivo
      // Recortar al rango visible: si la barra cae fuera, no se renderiza.
      if (endDay <= 0 || startDay >= rangeDays) return
      const clampedStart = Math.max(0, startDay)
      const clampedEnd = Math.min(rangeDays, endDay)
      const left = clampedStart * dayWidth
      const width = Math.max(dayWidth, (clampedEnd - clampedStart) * dayWidth)
      // Posición vertical: la barra real está centrada en `rowHeight/2` y
      // mide 24px. La fantasma queda 4px debajo del centro (visualmente
      // "asomando" por debajo). Esto contribuye a la doble codificación.
      const top = index * rowHeight + rowHeight / 2 + 4
      out.push({
        id: task.id,
        left,
        width,
        top,
        variance: v,
        ariaLabel: describeBaselineBar({
          baselineVersion,
          mnemonic: task.mnemonic ?? null,
          plannedStart: v.plannedStart,
          plannedEnd: v.plannedEnd,
          deltaDays: v.deltaDays,
        }),
      })
    })
    return out
  }, [tasks, snapshot, dayWidth, rangeStart, rangeDays, rowHeight, baselineVersion])

  if (!snapshot || ghostBars.length === 0) return null

  return (
    <div
      data-testid="gantt-baseline-layer"
      aria-hidden={false}
      className="pointer-events-none absolute inset-0 z-[5]"
    >
      {ghostBars.map((b) => (
        <div
          key={b.id}
          role="img"
          aria-label={b.ariaLabel}
          title={b.ariaLabel}
          style={{
            left: b.left,
            top: b.top,
            width: b.width,
            height: GHOST_HEIGHT_PX,
          }}
          className={clsx(
            'absolute rounded-sm border-2 border-dashed opacity-60',
            'border-muted-foreground/40 bg-muted/30',
          )}
        />
      ))}
    </div>
  )
}
