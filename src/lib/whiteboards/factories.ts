/**
 * Ola P5 · Equipo P5-1 — Factories puros para crear elementos en el
 * cliente sin hardcodear payloads en cada componente del toolbar.
 */

import { STICKY_COLORS } from './types'
import type {
  ConnectorData,
  FreehandBrush,
  FreehandData,
  FreehandPoint,
  ShapeData,
  ShapeVariant,
  StickyData,
  TextData,
  WhiteboardElementData,
  WhiteboardElementTypeLiteral,
} from './types'

const DEFAULT_STICKY_COLOR = STICKY_COLORS[0]

export function makeStickyData(text: string = '', color: string = DEFAULT_STICKY_COLOR): StickyData {
  return { kind: 'sticky', color, text }
}

export function makeShapeData(variant: ShapeVariant = 'rectangle'): ShapeData {
  return {
    kind: 'shape',
    variant,
    fill: '#1e293b',
    stroke: '#94a3b8',
  }
}

export function makeTextData(text: string = 'Texto'): TextData {
  return { kind: 'text', text, color: '#f8fafc', fontSize: 18 }
}

export function makeConnectorData(): ConnectorData {
  return {
    kind: 'connector',
    fromId: null,
    toId: null,
    points: [
      { x: 0, y: 0 },
      { x: 120, y: 60 },
    ],
    stroke: '#94a3b8',
  }
}

/**
 * HU-03 (2026-05-14) — Factory para trazos de dibujo libre.
 * `points` se llena conforme el usuario dibuja, así que parte vacío.
 */
export function makeFreehandData(
  brush: FreehandBrush = 'pencil',
  stroke: string = '#0f172a',
  strokeWidth: number = 4,
  points: FreehandPoint[] = [],
): FreehandData {
  return { kind: 'freehand', brush, stroke, strokeWidth, points }
}

/** Presets de pincel — color + grosor + alpha (en el renderer). */
export const BRUSH_PRESETS: Record<
  FreehandBrush,
  { color: string; width: number; label: string; emoji: string }
> = {
  pencil: { color: '#0f172a', width: 2, label: 'Lápiz', emoji: '✏️' },
  marker: { color: '#1e3a8a', width: 6, label: 'Marcador', emoji: '🖊️' },
  watercolor: { color: '#7c3aed', width: 14, label: 'Acuarela', emoji: '🎨' },
  highlighter: { color: '#facc15', width: 18, label: 'Resaltador', emoji: '🖍️' },
}

/**
 * Default geometry per type — define ancho/alto inicial cuando el
 * usuario hace click en el toolbar para añadir un elemento.
 */
export function defaultGeometry(type: WhiteboardElementTypeLiteral): {
  width: number
  height: number
} {
  switch (type) {
    case 'STICKY':
      return { width: 160, height: 160 }
    case 'SHAPE':
      return { width: 180, height: 120 }
    case 'CONNECTOR':
      return { width: 120, height: 60 }
    case 'TEXT':
      return { width: 200, height: 40 }
    case 'IMAGE':
      return { width: 240, height: 160 }
    case 'FREEHAND':
      // El bbox real se recalcula al cerrar el trazo. Esto es un placeholder
      // mientras el usuario dibuja (también sirve para hit-test mínimo).
      return { width: 1, height: 1 }
  }
}

/**
 * Devuelve un payload `data` por defecto para un tipo. Útil al insertar
 * desde el toolbar.
 */
export function defaultDataFor(type: WhiteboardElementTypeLiteral): WhiteboardElementData {
  switch (type) {
    case 'STICKY':
      return makeStickyData()
    case 'SHAPE':
      return makeShapeData()
    case 'CONNECTOR':
      return makeConnectorData()
    case 'TEXT':
      return makeTextData()
    case 'IMAGE':
      return { kind: 'image', url: 'https://placehold.co/240x160', alt: '' }
    case 'FREEHAND':
      return makeFreehandData()
  }
}

/**
 * HU-03 — Recalcula el bounding box de un trazo libre. Devuelve `{x,y,
 * width, height}` en coordenadas absolutas, asumiendo que los `points`
 * vienen en coordenadas absolutas. El editor llama a esto al cerrar
 * el trazo para fijar la geometría del elemento.
 */
export function computeFreehandBounds(
  points: FreehandPoint[],
  padding: number = 8,
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2),
  }
}
