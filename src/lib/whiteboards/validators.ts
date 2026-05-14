/**
 * Ola P5 · Equipo P5-1 — Validación zod del payload `data` de cada
 * elemento. El server action despacha por `type` para no aceptar JSON
 * arbitrario que rompa el editor cliente.
 */

import { z } from 'zod'
import { FREEHAND_BRUSHES, SHAPE_VARIANTS, WHITEBOARD_ELEMENT_TYPES } from './types'
import type {
  ConnectorData,
  FreehandData,
  ImageData,
  ShapeData,
  StickyData,
  TextData,
  WhiteboardElementData,
  WhiteboardElementTypeLiteral,
} from './types'

const stickyDataSchema = z.object({
  kind: z.literal('sticky'),
  color: z
    .string()
    .min(1)
    .max(32)
    .regex(/^#?[A-Za-z0-9]{3,12}$/, { message: 'color inválido' }),
  text: z.string().max(2000).default(''),
})

const shapeDataSchema = z.object({
  kind: z.literal('shape'),
  variant: z.enum(SHAPE_VARIANTS),
  fill: z.string().max(32),
  stroke: z.string().max(32),
  text: z.string().max(2000).optional(),
  // HU-04 (2026-05-14) — trazo original (puntos absolutos) cuando el
  // SHAPE proviene de reconocimiento de forma. Tope alto pero acotado.
  recognizedFromPoints: z
    .array(z.object({ x: z.number().finite(), y: z.number().finite() }))
    .max(4096)
    .optional(),
})

const connectorDataSchema = z.object({
  kind: z.literal('connector'),
  fromId: z.string().nullable(),
  toId: z.string().nullable(),
  points: z
    .array(z.object({ x: z.number().finite(), y: z.number().finite() }))
    .max(64),
  stroke: z.string().max(32),
})

const textDataSchema = z.object({
  kind: z.literal('text'),
  text: z.string().max(4000),
  color: z.string().max(32),
  fontSize: z.number().int().min(8).max(96),
})

const imageDataSchema = z.object({
  kind: z.literal('image'),
  // HU-02 (2026-05-14) — permitimos `url` larga porque ahora acepta
  // data: URLs (base64) hasta ~7MB tras tamaño post-encoding. La validez
  // semántica de "URL https vs data:" la respeta `safeUrl` que sólo
  // chequea schemes whitelisted en el renderer.
  url: z.string().min(1).max(10_000_000),
  alt: z.string().max(200).default(''),
  mimeType: z
    .string()
    .max(120)
    .regex(/^[\w.+-]+\/[\w.+-]+$/, 'mimeType inválido')
    .optional(),
  filename: z.string().max(255).optional(),
})

// HU-03 (2026-05-14) — Trazo libre. `points` con tope alto pero limitado
// (4096 puntos) para evitar payloads abusivos. Cada punto opcionalmente
// trae `p` (presión 0..1). El bbox real se reconstruye en el cliente.
const freehandDataSchema = z.object({
  kind: z.literal('freehand'),
  brush: z.enum(FREEHAND_BRUSHES),
  stroke: z.string().max(32),
  strokeWidth: z.number().finite().min(0.5).max(64),
  points: z
    .array(
      z.object({
        x: z.number().finite(),
        y: z.number().finite(),
        p: z.number().min(0).max(1).optional(),
      }),
    )
    .max(4096),
})

/**
 * Despacha la validación según `type`. Devuelve el payload normalizado o
 * lanza error tipado `[INVALID_INPUT] ...`.
 */
export function validateElementData(
  type: WhiteboardElementTypeLiteral,
  raw: unknown,
): WhiteboardElementData {
  switch (type) {
    case 'STICKY': {
      const parsed = stickyDataSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(
          `[INVALID_INPUT] sticky data inválida: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        )
      }
      return parsed.data satisfies StickyData
    }
    case 'SHAPE': {
      const parsed = shapeDataSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(
          `[INVALID_INPUT] shape data inválida: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        )
      }
      return parsed.data satisfies ShapeData
    }
    case 'CONNECTOR': {
      const parsed = connectorDataSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(
          `[INVALID_INPUT] connector data inválida: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        )
      }
      return parsed.data satisfies ConnectorData
    }
    case 'TEXT': {
      const parsed = textDataSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(
          `[INVALID_INPUT] text data inválida: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        )
      }
      return parsed.data satisfies TextData
    }
    case 'IMAGE': {
      const parsed = imageDataSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(
          `[INVALID_INPUT] image data inválida: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        )
      }
      return parsed.data satisfies ImageData
    }
    case 'FREEHAND': {
      const parsed = freehandDataSchema.safeParse(raw)
      if (!parsed.success) {
        throw new Error(
          `[INVALID_INPUT] freehand data inválida: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        )
      }
      return parsed.data satisfies FreehandData
    }
    default: {
      // Exhaustive switch — TypeScript debería marcarlo si añades un tipo
      // nuevo a WHITEBOARD_ELEMENT_TYPES sin añadir el case aquí.
      const _exhaustive: never = type
      throw new Error(`[INVALID_INPUT] tipo desconocido: ${String(_exhaustive)}`)
    }
  }
}

export const elementTypeSchema = z.enum(WHITEBOARD_ELEMENT_TYPES)

/**
 * Schema permisivo para batch updates (autosave debounced). Solo valida
 * los campos geométricos; el `data` se omite porque el cliente sólo
 * sincroniza posiciones por defecto. La validación profunda corre en
 * `setElementData` cuando el usuario cambia el contenido.
 */
export const elementPositionPatchSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().finite().min(1).max(10000).optional(),
  height: z.number().finite().min(1).max(10000).optional(),
  rotation: z.number().finite().optional(),
  zIndex: z.number().int().optional(),
})

export type ElementPositionPatch = z.infer<typeof elementPositionPatchSchema>

export const titleSchema = z
  .string()
  .trim()
  .min(1, 'El título es obligatorio')
  .max(120, 'El título no puede exceder 120 caracteres')
