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
  'FREEHAND',
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
  /** HU-04 (2026-05-14) — Si el SHAPE fue creado por reconocimiento de
   *  un trazo libre, guardamos los puntos originales para soportar
   *  "Deshacer conversión" → vuelve a ser FREEHAND. */
  recognizedFromPoints?: { x: number; y: number }[]
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
  /** HU-02 (2026-05-14) — Tipo MIME del recurso. Si está presente, el
   *  renderer decide cómo embeberlo:
   *    image/* → <img>
   *    application/pdf → <embed> (preview inline)
   *    video/* → <video controls>
   *    audio/* → <audio controls>
   *  Sin mimeType (legacy) se asume imagen. */
  mimeType?: string
  /** HU-02 — Nombre original del archivo (para tooltip + accesibilidad). */
  filename?: string
}

// ─────────────────────────── Dibujo libre (HU-03) ────────────────────

/** Variantes de pincel disponibles. Cada una mapea a un patrón de
 *  trazo en el renderer (líneas básicas, mezclado, círculos suaves). */
export const FREEHAND_BRUSHES = [
  'pencil', // lápiz: trazo nítido, opacidad alta
  'marker', // marcador: trazo grueso, opacidad media
  'watercolor', // acuarela: trazo suave con alpha bajo
  'highlighter', // resaltador: muy alfa, color saturado
] as const
export type FreehandBrush = (typeof FREEHAND_BRUSHES)[number]

/** Punto del trazo. `p` (presión 0..1) opcional para HU-11 futuro. */
export type FreehandPoint = { x: number; y: number; p?: number }

export type FreehandData = {
  kind: 'freehand'
  brush: FreehandBrush
  stroke: string // color base CSS
  strokeWidth: number // grosor en px @zoom=1
  /**
   * Puntos relativos al origen del elemento `(x, y)`. El editor calcula
   * `(width, height)` a partir del bbox del path. Usar coordenadas
   * relativas hace los trazos invariantes a movimientos del elemento.
   */
  points: FreehandPoint[]
}

export type WhiteboardElementData =
  | StickyData
  | ShapeData
  | ConnectorData
  | TextData
  | ImageData
  | FreehandData

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
  /** HU-12 — Identificador del grupo al que pertenece (UUID). `null` = sin grupo. */
  groupId?: string | null
  /** HU-12 — `true` deshabilita movimiento/edición. Default false. */
  locked?: boolean
  /** HU-16 (2026-05-14) — Página a la que pertenece. Opcional para compat
   *  con elementos legacy serializados sin pageId. */
  pageId?: string | null
}

/** HU-16 — Página/sub-lienzo de una pizarra. */
export type WhiteboardPage = {
  id: string
  whiteboardId: string
  name: string
  order: number
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
