import { describe, it, expect } from 'vitest'
import {
  snapToGrid,
  snapPoint,
  screenToWorld,
  worldToScreen,
  zoomAt,
  clamp,
  unionBounds,
  pointInBounds,
} from '@/lib/whiteboards/geometry'
import { DEFAULT_VIEWPORT, ZOOM_MAX, ZOOM_MIN } from '@/lib/whiteboards/types'

describe('whiteboards/geometry', () => {
  it('snapToGrid redondea al múltiplo más cercano', () => {
    expect(snapToGrid(0)).toBe(0)
    expect(snapToGrid(4)).toBe(0)
    expect(snapToGrid(5)).toBe(10)
    expect(snapToGrid(11)).toBe(10)
    expect(snapToGrid(99)).toBe(100)
    expect(snapToGrid(-7)).toBe(-10)
  })

  it('snapToGrid devuelve 0 para valores no finitos', () => {
    expect(snapToGrid(NaN)).toBe(0)
    expect(snapToGrid(Infinity)).toBe(0)
  })

  it('snapPoint identidad cuando enabled=false', () => {
    const p = { x: 7.5, y: 12.3 }
    expect(snapPoint(p, false)).toEqual(p)
  })

  it('snapPoint aplica snap a x y a y cuando enabled=true', () => {
    expect(snapPoint({ x: 7.5, y: 12.3 }, true)).toEqual({ x: 10, y: 10 })
  })

  it('screenToWorld y worldToScreen son inversos', () => {
    const vp = { zoom: 1.5, panX: 100, panY: 50 }
    const screen = { x: 250, y: 200 }
    const world = screenToWorld(screen, vp)
    const back = worldToScreen(world, vp)
    expect(back.x).toBeCloseTo(screen.x)
    expect(back.y).toBeCloseTo(screen.y)
  })

  it('zoomAt mantiene anclado el punto bajo el pivot', () => {
    const start = { ...DEFAULT_VIEWPORT, zoom: 1 }
    const pivot = { x: 200, y: 100 }
    const before = screenToWorld(pivot, start)
    const next = zoomAt(start, pivot, 0.5)
    const after = screenToWorld(pivot, next)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('zoomAt clampea al rango ZOOM_MIN/ZOOM_MAX', () => {
    const min = zoomAt({ ...DEFAULT_VIEWPORT, zoom: ZOOM_MIN }, { x: 0, y: 0 }, -10)
    expect(min.zoom).toBe(ZOOM_MIN)
    const max = zoomAt({ ...DEFAULT_VIEWPORT, zoom: ZOOM_MAX }, { x: 0, y: 0 }, 10)
    expect(max.zoom).toBe(ZOOM_MAX)
  })

  it('clamp respeta los límites', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('unionBounds devuelve bbox combinado', () => {
    const result = unionBounds([
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 80, y: 30, width: 20, height: 70 },
    ])
    expect(result).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('unionBounds devuelve bounds vacíos si no hay elementos', () => {
    expect(unionBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('pointInBounds detecta dentro/fuera', () => {
    const b = { x: 10, y: 10, width: 100, height: 100 }
    expect(pointInBounds({ x: 50, y: 50 }, b)).toBe(true)
    expect(pointInBounds({ x: 5, y: 50 }, b)).toBe(false)
    expect(pointInBounds({ x: 110, y: 110 }, b)).toBe(true) // borde inclusivo
    expect(pointInBounds({ x: 111, y: 50 }, b)).toBe(false)
  })
})
