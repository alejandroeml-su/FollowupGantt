import { describe, it, expect } from 'vitest'
import { pickFilters, filtersToQuery, hrefWithFilters } from '@/lib/filters'

describe('filters · pickFilters', () => {
  it('extrae sólo las claves reconocidas', () => {
    const sp = new URLSearchParams(
      'assignee=u1&status=TODO&foo=bar&priority=HIGH',
    )
    expect(pickFilters(sp)).toEqual({
      assignee: 'u1',
      status: 'TODO',
      priority: 'HIGH',
    })
  })

  it('acepta Record<string, string | string[] | undefined>', () => {
    expect(
      pickFilters({ status: 'DONE', q: ['hola'], unknown: 'x' }),
    ).toEqual({ status: 'DONE', q: 'hola' })
  })

  it('vacío si no hay filtros', () => {
    expect(pickFilters(new URLSearchParams())).toEqual({})
  })
})

describe('filters · filtersToQuery', () => {
  it('serializa con ? inicial y ampersand', () => {
    const qs = filtersToQuery({ status: 'TODO', assignee: 'u1' })
    expect(qs.startsWith('?')).toBe(true)
    expect(qs).toContain('status=TODO')
    expect(qs).toContain('assignee=u1')
  })

  it('cadena vacía si filtros = {}', () => {
    expect(filtersToQuery({})).toBe('')
  })

  it('ignora valores falsy', () => {
    expect(filtersToQuery({ status: '', priority: undefined })).toBe('')
  })
})

describe('filters · hrefWithFilters', () => {
  it('preserva filtros entre vistas', () => {
    const href = hrefWithFilters('/kanban', { status: 'DONE', assignee: 'u1' })
    expect(href.startsWith('/kanban?')).toBe(true)
    expect(href).toContain('status=DONE')
    expect(href).toContain('assignee=u1')
  })

  it('descarta `month` cuando el destino no es /gantt', () => {
    const href = hrefWithFilters('/list', { month: '2026-05', status: 'TODO' })
    expect(href).not.toContain('month=')
    expect(href).toContain('status=TODO')
  })

  it('mantiene `month` cuando el destino es /gantt', () => {
    const href = hrefWithFilters('/gantt', { month: '2026-05' })
    expect(href).toContain('month=2026-05')
  })
})
