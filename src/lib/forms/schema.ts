/**
 * Ola P5 · Equipo P5-5 — Schema validation para PublicForm.
 *
 * Define el shape del `schema` JSON de un PublicForm:
 *   - Cada campo tiene `name` (slug, único en el form), `type`, `label?`,
 *     `required`, `options?` (sólo para SELECT).
 *   - Tipos soportados: text, textarea, select, email, number.
 *
 * `parseFormSchema` se usa al crear/actualizar el form (bloquea shape inválido)
 * y al validar el payload de un submission contra los campos declarados.
 */

import { z } from 'zod'

export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  'email',
  'number',
] as const

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number]

const fieldNameSchema = z
  .string()
  .trim()
  .min(1, 'El nombre del campo es obligatorio')
  .max(64, 'El nombre del campo no puede exceder 64 caracteres')
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'El nombre del campo debe ser snake_case (lowercase + dígitos + guión bajo)',
  )

export const formFieldSchema = z
  .object({
    name: fieldNameSchema,
    type: z.enum(FORM_FIELD_TYPES),
    label: z.string().trim().max(120).optional(),
    required: z.boolean().default(false),
    options: z
      .array(z.string().trim().min(1).max(120))
      .optional(),
  })
  .refine(
    (f) => {
      if (f.type === 'select') {
        return Array.isArray(f.options) && f.options.length > 0
      }
      return true
    },
    { message: 'Los campos select deben declarar al menos una opción' },
  )

export type FormField = z.infer<typeof formFieldSchema>

export const formSchemaArray = z
  .array(formFieldSchema)
  .min(1, 'El formulario debe tener al menos un campo')
  .max(40, 'El formulario no puede exceder 40 campos')
  .superRefine((fields, ctx) => {
    const seen = new Set<string>()
    for (const f of fields) {
      if (seen.has(f.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Nombre duplicado: ${f.name}`,
          path: ['name'],
        })
      }
      seen.add(f.name)
    }
  })

export type FormSchema = z.infer<typeof formSchemaArray>

/**
 * Parser de seguridad. Devuelve el array tipado o lanza el error de zod.
 * Uso: bloquear schemas inválidos antes de persistir.
 */
export function parseFormSchema(input: unknown): FormSchema {
  return formSchemaArray.parse(input)
}

/**
 * Variante segura (sin throw) para callers que prefieren chequear `.success`.
 */
export function safeParseFormSchema(input: unknown) {
  return formSchemaArray.safeParse(input)
}

// ─────────────────────────── Validación de payload ───────────────────────

export type FormSubmissionPayload = Record<string, string | number | null>

/**
 * Valida un payload de submission contra el schema declarado.
 * Devuelve `{ ok: true, value }` con el payload normalizado, o
 * `{ ok: false, errors }` con la lista de errores legibles.
 *
 * Reglas:
 *  - Campos `required` deben venir con valor no vacío.
 *  - `email`: regex básico.
 *  - `number`: parseable a número finito.
 *  - `select`: el valor debe estar en `options`.
 *  - Campos no declarados se IGNORAN (whitelist) salvo el honeypot.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateSubmissionPayload(
  schema: FormSchema,
  rawPayload: Record<string, unknown>,
): { ok: true; value: FormSubmissionPayload } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const value: FormSubmissionPayload = {}

  for (const field of schema) {
    const raw = rawPayload[field.name]
    const isMissing =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim() === '')

    if (isMissing) {
      if (field.required) {
        errors.push(`Campo requerido: ${field.label ?? field.name}`)
      } else {
        value[field.name] = null
      }
      continue
    }

    switch (field.type) {
      case 'text':
      case 'textarea': {
        const str = String(raw).trim()
        if (str.length > 5000) {
          errors.push(`Campo ${field.name} excede 5000 caracteres`)
          break
        }
        value[field.name] = str
        break
      }
      case 'email': {
        const str = String(raw).trim()
        if (!EMAIL_RE.test(str)) {
          errors.push(`Email inválido: ${field.name}`)
          break
        }
        value[field.name] = str
        break
      }
      case 'number': {
        const num = Number(raw)
        if (!Number.isFinite(num)) {
          errors.push(`Número inválido: ${field.name}`)
          break
        }
        value[field.name] = num
        break
      }
      case 'select': {
        const str = String(raw).trim()
        if (!field.options || !field.options.includes(str)) {
          errors.push(`Opción inválida en ${field.name}: ${str}`)
          break
        }
        value[field.name] = str
        break
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value }
}
