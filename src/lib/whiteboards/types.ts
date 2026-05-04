/**
 * Ola P5 · Equipo P5-1 — Tipos de dominio del módulo Whiteboards.
 *
 * Mantenemos los tipos cliente fuera de `actions/whiteboards.ts` para que
 * los componentes (`'use client'`) puedan importarlos sin arrastrar el
 * `'use server'` ni dependencias de Prisma/Auth.
 */

import type { WhiteboardElementType } from '@prisma/client'

export const WHITEBOARD_ELEMENT_TYPES = [
  'STICKY',
  'SHAPE',
  'CONNECTOR',
  'TEXT',
  'IMAGE',
] as const satisfies readonly WhiteboardElementType[]

export type WhiteboardElementTypeLiteral = (typeof WHITEBOARD_ELEMENT_TYPES)[number]

/** Variantes válidas para elementos de tipo SHAPE. */
export const SHAPE_VARIANTS = ['rectangle', 'circle', 'triangle'] as const
export type ShapeVariant = (typeof SHAPE_VARIANTS)[number]

/** Paleta canónica de stickies (paridad con paleta Miro). */
export const STICKY_COLORS = [
  '#FEF08A', // amarillo
  '#FCA5A5', // rosa
  '#86EFAC', // verde menta
  '#93C5FD', // azul cielo
  '#C4B5FD', // lila
  '#FDBA74', // naranja
] as const
export type StickyColor = (typeof STICKY_COLORS)[number]

// ─────────────────────────── Shapes específicos ──────────────────────

export type StickyData = {
  kind: 'sticky'
  color: string // libre, validado contra STICKY_COLORS en server action
  text: string
}

export type ShapeData = {
  kind: 'shape'
  variant: ShapeVariant
  fill: string
  stroke: string
  text?: string
}

export type ConnectorData = {
  kind: 'connector'
  fromId: string | null // referencia a otro elemento (snap) o null si flotante
  toId: string | null
  // Para conectores flotantes guardamos puntos relativos al element box.
  points: { x: number; y: number }[]
  stroke: string
}

export type TextData = {
  kind: 'text'
  text: string
  color: string
  fontSize: number
}

export type ImageData = {
  kind: 'image'
  url: string
  alt: string
}

export type WhiteboardElementData =
  | StickyData
  | ShapeData
  | ConnectorData
  | TextData
  | ImageData

/** Elemento serializado del cliente — coincide con el Prisma model. */
export type WhiteboardElement = {
  id: string
  whiteboardId: string
  type: WhiteboardElementTypeLiteral
  x: number
  y: number
  width: number
  height: number
  rotation: number
  data: WhiteboardElementData
  zIndex: number
}

/** Snapshot ligero de la pizarra para listas. */
export type WhiteboardListItem = {
  id: string
  title: string
  description: string | null
  projectId: string | null
  projectName: string | null
  createdByName: string | null
  elementCount: number
  isArchived: boolean
  updatedAt: string // ISO
}

/** Camera state para zoom + pan. */
export type ViewportState = {
  zoom: number
  panX: number
  panY: number
}

export const DEFAULT_VIEWPORT: ViewportState = {
  zoom: 1,
  panX: 0,
  panY: 0,
}

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4
export const ZOOM_STEP = 0.1
export const SNAP_GRID_PX = 10
