/**
 * Ola P5 · Equipo P5-1 — Utilidades geométricas puras del editor de
 * Whiteboards. Sin dependencias del DOM ni de Prisma para que sean
 * testeables sin jsdom.
 */

import { SNAP_GRID_PX, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './types'
import type { ViewportState } from './types'

/**
 * Redondea un valor `x` al múltiplo de `grid` más cercano. Usado por el
 * autosnap del drag.
 */
export function snapToGrid(value: number, grid: number = SNAP_GRID_PX): number {
  if (!Number.isFinite(value)) return 0
  if (grid <= 0) return value
  return Math.round(value / grid) * grid
}

/**
 * Aplica snap a una pareja {x, y}. `enabled = false` la convierte en
 * identidad (útil para el toggle Shift / botón "snap off").
 */
export function snapPoint(
  point: { x: number; y: number },
  enabled: boolean = true,
  grid: number = SNAP_GRID_PX,
): { x: number; y: number } {
  if (!enabled) return { x: point.x, y: point.y }
  return { x: snapToGrid(point.x, grid), y: snapToGrid(point.y, grid) }
}

/**
 * Convierte coordenadas de la pantalla a coordenadas del mundo del canvas
 * teniendo en cuenta el zoom y el pan actuales.
 */
export function screenToWorld(
  screen: { x: number; y: number },
  viewport: ViewportState,
): { x: number; y: number } {
  const z = viewport.zoom || 1
  return {
    x: (screen.x - viewport.panX) / z,
    y: (screen.y - viewport.panY) / z,
  }
}

/**
 * Convierte coordenadas del mundo a coordenadas de pantalla.
 */
export function worldToScreen(
  world: { x: number; y: number },
  viewport: ViewportState,
): { x: number; y: number } {
  return {
    x: world.x * viewport.zoom + viewport.panX,
    y: world.y * viewport.zoom + viewport.panY,
  }
}

/**
 * Aplica zoom centrado en un punto de pantalla `pivot`. Devuelve el
 * viewport actualizado tal que el punto del mundo bajo el pivot
 * permanece anclado (igual que Miro/Figma).
 */
export function zoomAt(
  viewport: ViewportState,
  pivot: { x: number; y: number },
  delta: number,
): ViewportState {
  const next = clamp(viewport.zoom + delta, ZOOM_MIN, ZOOM_MAX)
  if (next === viewport.zoom) return viewport
  // Anchor: world point under pivot debe permanecer estable.
  const world = screenToWorld(pivot, viewport)
  const panX = pivot.x - world.x * next
  const panY = pivot.y - world.y * next
  return { zoom: next, panX, panY }
}

/**
 * Clamp helper — sin dependencias.
 */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * Step de zoom canónico (rueda del mouse). `direction = 1` acerca,
 * `-1` aleja. Usado por el handler de wheel del canvas.
 */
export function stepZoom(
  viewport: ViewportState,
  pivot: { x: number; y: number },
  direction: 1 | -1,
): ViewportState {
  return zoomAt(viewport, pivot, direction * ZOOM_STEP)
}

/**
 * AABB (axis-aligned bounding box) de un elemento — útil para
 * selecciones rectangulares, hit-testing y export PNG.
 */
export type Bounds = { x: number; y: number; width: number; height: number }

export function elementBounds(el: {
  x: number
  y: number
  width: number
  height: number
}): Bounds {
  return { x: el.x, y: el.y, width: el.width, height: el.height }
}

/**
 * Bounds combinado de múltiples elementos — usado por "Exportar PNG"
 * para fittear el viewport al contenido total.
 */
export function unionBounds(elements: Bounds[]): Bounds {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const e of elements) {
    if (e.x < minX) minX = e.x
    if (e.y < minY) minY = e.y
    const ex = e.x + e.width
    const ey = e.y + e.height
    if (ex > maxX) maxX = ex
    if (ey > maxY) maxY = ey
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Hit-test simple — true si el punto cae dentro del bbox. No
 * contempla rotación (los stickies del MVP no rotan).
 */
export function pointInBounds(point: { x: number; y: number }, b: Bounds): boolean {
  return (
    point.x >= b.x &&
    point.x <= b.x + b.width &&
    point.y >= b.y &&
    point.y <= b.y + b.height
  )
}
