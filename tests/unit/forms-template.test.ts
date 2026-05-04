import { describe, it, expect } from 'vitest'
import { interpolateTemplate, extractPlaceholders } from '@/lib/forms/template'

/**
 * Ola P5 · Equipo P5-5 — Tests de interpolación de plantillas para títulos
 * de Task generados por submissions.
 */

describe('interpolateTemplate', () => {
  it('reemplaza placeholders simples', () => {
    expect(
      interpolateTemplate('Ticket de {nombre}', {
        slug: 's',
        payload: { nombre: 'Edwin' },
      }),
    ).toBe('Ticket de Edwin')
  })

  it('soporta múltiples placeholders', () => {
    expect(
      interpolateTemplate('{nombre} <{email}>', {
        slug: 's',
        payload: { nombre: 'X', email: 'a@b.c' },
      }),
    ).toBe('X <a@b.c>')
  })

  it('reemplaza placeholders no resueltos por cadena vacía', () => {
    expect(
      interpolateTemplate('Hola {falta}', {
        slug: 's',
        payload: {},
      }),
    ).toBe('Hola')
  })

  it('soporta {slug} especial', () => {
    expect(
      interpolateTemplate('Form {slug}', { slug: 'soporte', payload: {} }),
    ).toBe('Form soporte')
  })

  it('trunca títulos a 200 chars', () => {
    const long = 'x'.repeat(500)
    const out = interpolateTemplate('{x}', { slug: 's', payload: { x: long } })
    expect(out.length).toBeLessThanOrEqual(200)
  })

  it('extractPlaceholders devuelve nombres únicos', () => {
    const list = extractPlaceholders('{a}-{b}-{a}')
    expect(list.sort()).toEqual(['a', 'b'])
  })
})
