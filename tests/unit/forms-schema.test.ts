import { describe, it, expect } from 'vitest'
import {
  parseFormSchema,
  safeParseFormSchema,
  validateSubmissionPayload,
  FORM_FIELD_TYPES,
  type FormField,
} from '@/lib/forms/schema'

/**
 * Ola P5 · Equipo P5-5 — Tests de validación de schema y payload.
 */

describe('parseFormSchema', () => {
  it('acepta un schema válido con campos básicos', () => {
    const schema = parseFormSchema([
      { name: 'nombre', type: 'text', label: 'Nombre', required: true },
      { name: 'email', type: 'email', required: true },
      { name: 'mensaje', type: 'textarea', required: false },
    ])
    expect(schema).toHaveLength(3)
    expect(schema[0].name).toBe('nombre')
  })

  it('rechaza schema vacío', () => {
    expect(() => parseFormSchema([])).toThrow()
  })

  it('rechaza nombres duplicados', () => {
    expect(() =>
      parseFormSchema([
        { name: 'foo', type: 'text', required: false },
        { name: 'foo', type: 'text', required: false },
      ]),
    ).toThrow(/duplicado/i)
  })

  it('rechaza nombres no snake_case', () => {
    expect(() => parseFormSchema([{ name: 'NombreInvalido', type: 'text', required: false }])).toThrow()
    expect(() => parseFormSchema([{ name: '123abc', type: 'text', required: false }])).toThrow()
  })

  it('rechaza campos select sin opciones', () => {
    expect(() =>
      parseFormSchema([{ name: 'tipo', type: 'select', required: true } as FormField]),
    ).toThrow(/opci/i)
  })

  it('acepta campos select con opciones', () => {
    const s = parseFormSchema([
      { name: 'tipo', type: 'select', options: ['A', 'B'], required: false },
    ])
    expect(s[0].options).toEqual(['A', 'B'])
  })

  it('expone tipos soportados en FORM_FIELD_TYPES', () => {
    expect(FORM_FIELD_TYPES).toContain('text')
    expect(FORM_FIELD_TYPES).toContain('email')
    expect(FORM_FIELD_TYPES).toContain('select')
  })

  it('safeParseFormSchema devuelve {success:false} sin throw cuando es inválido', () => {
    const r = safeParseFormSchema('no es array')
    expect(r.success).toBe(false)
  })
})

describe('validateSubmissionPayload', () => {
  const schema: FormField[] = [
    { name: 'nombre', type: 'text', required: true },
    { name: 'email', type: 'email', required: true },
    { name: 'edad', type: 'number', required: false },
    { name: 'tipo', type: 'select', required: false, options: ['A', 'B'] },
  ]

  it('acepta payload completo válido', () => {
    const r = validateSubmissionPayload(schema, {
      nombre: 'Edwin',
      email: 'e@x.com',
      edad: '35',
      tipo: 'A',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.edad).toBe(35)
      expect(r.value.email).toBe('e@x.com')
    }
  })

  it('rechaza email inválido', () => {
    const r = validateSubmissionPayload(schema, {
      nombre: 'Edwin',
      email: 'no-email',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/email/i)
  })

  it('rechaza requerido faltante', () => {
    const r = validateSubmissionPayload(schema, { email: 'e@x.com' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => /nombre/i.test(e))).toBe(true)
  })

  it('rechaza opción no permitida en select', () => {
    const r = validateSubmissionPayload(schema, {
      nombre: 'X',
      email: 'e@x.com',
      tipo: 'Z',
    })
    expect(r.ok).toBe(false)
  })

  it('ignora campos no declarados (whitelist)', () => {
    const r = validateSubmissionPayload(schema, {
      nombre: 'X',
      email: 'e@x.com',
      campo_extra: 'malicioso',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).not.toHaveProperty('campo_extra')
  })

  it('coerciona números desde strings', () => {
    const r = validateSubmissionPayload(schema, {
      nombre: 'X',
      email: 'e@x.com',
      edad: '42',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.edad).toBe(42)
  })

  it('rechaza números no parseables', () => {
    const r = validateSubmissionPayload(schema, {
      nombre: 'X',
      email: 'e@x.com',
      edad: 'abc',
    })
    expect(r.ok).toBe(false)
  })

  it('trunca / valida texto extra largo', () => {
    const r = validateSubmissionPayload(schema, {
      nombre: 'a'.repeat(6000),
      email: 'e@x.com',
    })
    expect(r.ok).toBe(false)
  })
})
