import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DOD_TEMPLATE,
  DEFAULT_DOR_TEMPLATE,
  hasTemplateContent,
  normalizeChecklistTemplate,
} from '@/lib/dor-dod/types'

describe('dor-dod · normalizeChecklistTemplate', () => {
  it('input no array → []', () => {
    expect(normalizeChecklistTemplate(null)).toEqual([])
    expect(normalizeChecklistTemplate(undefined)).toEqual([])
    expect(normalizeChecklistTemplate('string')).toEqual([])
    expect(normalizeChecklistTemplate(42)).toEqual([])
    expect(normalizeChecklistTemplate({})).toEqual([])
  })

  it('array vacío → []', () => {
    expect(normalizeChecklistTemplate([])).toEqual([])
  })

  it('descarta items no-string', () => {
    expect(
      normalizeChecklistTemplate(['ok', 42, null, undefined, { x: 1 }, 'otra']),
    ).toEqual(['ok', 'otra'])
  })

  it('trim aplicado', () => {
    expect(normalizeChecklistTemplate(['  uno  ', '\tdos\t'])).toEqual([
      'uno',
      'dos',
    ])
  })

  it('descarta strings vacíos / solo whitespace', () => {
    expect(normalizeChecklistTemplate(['', '   ', '\t', 'real'])).toEqual([
      'real',
    ])
  })

  it('dedupe case-insensitive', () => {
    expect(
      normalizeChecklistTemplate(['Tests pasan', 'tests pasan', 'TESTS PASAN']),
    ).toEqual(['Tests pasan'])
  })

  it('preserva orden de inserción', () => {
    expect(
      normalizeChecklistTemplate(['c', 'a', 'b', 'a', 'd']),
    ).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('dor-dod · hasTemplateContent', () => {
  it('plantilla vacía → false', () => {
    expect(hasTemplateContent(null)).toBe(false)
    expect(hasTemplateContent([])).toBe(false)
    expect(hasTemplateContent(['', '   '])).toBe(false)
  })

  it('plantilla con al menos 1 item válido → true', () => {
    expect(hasTemplateContent(['ok'])).toBe(true)
    expect(hasTemplateContent(['', 'ok', ''])).toBe(true)
  })
})

describe('dor-dod · DEFAULT templates', () => {
  it('DEFAULT_DOR_TEMPLATE tiene al menos 3 items', () => {
    expect(DEFAULT_DOR_TEMPLATE.length).toBeGreaterThanOrEqual(3)
  })

  it('DEFAULT_DOD_TEMPLATE tiene al menos 3 items', () => {
    expect(DEFAULT_DOD_TEMPLATE.length).toBeGreaterThanOrEqual(3)
  })

  it('default templates pasan normalize sin cambios', () => {
    expect(normalizeChecklistTemplate(Array.from(DEFAULT_DOR_TEMPLATE))).toEqual(
      Array.from(DEFAULT_DOR_TEMPLATE),
    )
    expect(normalizeChecklistTemplate(Array.from(DEFAULT_DOD_TEMPLATE))).toEqual(
      Array.from(DEFAULT_DOD_TEMPLATE),
    )
  })
})
