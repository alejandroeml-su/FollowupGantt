/**
 * Ola P5 · Equipo P5-1 — Validación zod del payload `data` de cada
 * elemento. El server action despacha por `type` para no aceptar JSON
 * arbitrario que rompa el editor cliente.
 */

import { z } from 'zod'
import { SHAPE_VARIANTS, WHITEBOARD_ELEMENT_TYPES } from './types'
import type {
  ConnectorData,
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
  url: z.string().url().max(2048),
  alt: z.string().max(200).default(''),
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
