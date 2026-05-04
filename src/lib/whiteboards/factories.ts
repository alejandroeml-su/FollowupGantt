/**
 * Ola P5 · Equipo P5-1 — Factories puros para crear elementos en el
 * cliente sin hardcodear payloads en cada componente del toolbar.
 */

import { STICKY_COLORS } from './types'
import type {
  ConnectorData,
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
  }
}
