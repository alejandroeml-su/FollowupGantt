import { describe, it, expect } from 'vitest'
import {
  countPendingCriteria,
  emptyUserStory,
  generateCriterionId,
  normalizeUserStory,
  userStoryCompletionRate,
} from '@/lib/user-story/types'

describe('user-story · emptyUserStory', () => {
  it('devuelve estructura válida pero vacía', () => {
    const us = emptyUserStory()
    expect(us.asA).toBe('')
    expect(us.iWant).toBe('')
    expect(us.soThat).toBe('')
    expect(us.criteria).toEqual([])
  })
})

describe('user-story · generateCriterionId', () => {
  it('genera id no vacío', () => {
    const id = generateCriterionId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(5)
  })

  it('genera ids distintos en llamadas seguidas', () => {
    const a = generateCriterionId()
    const b = generateCriterionId()
    expect(a).not.toBe(b)
  })
})

describe('user-story · normalizeUserStory', () => {
  it('null/undefined/no-objeto → null', () => {
    expect(normalizeUserStory(null)).toBeNull()
    expect(normalizeUserStory(undefined)).toBeNull()
    expect(normalizeUserStory('string')).toBeNull()
    expect(normalizeUserStory(42)).toBeNull()
  })

  it('objeto vacío → null (no perpetúa basura)', () => {
    expect(normalizeUserStory({})).toBeNull()
  })

  it('objeto con sólo strings vacíos → null', () => {
    expect(
      normalizeUserStory({ asA: '', iWant: '', soThat: '', criteria: [] }),
    ).toBeNull()
  })

  it('objeto válido → normaliza tal cual', () => {
    const r = normalizeUserStory({
      asA: 'PO',
      iWant: 'crear epics',
      soThat: 'agrupar',
      criteria: [
        { id: 'c1', text: 'CA1', done: false },
        { id: 'c2', text: 'CA2', done: true, doneAt: '2026-01-01' },
      ],
    })
    expect(r).not.toBeNull()
    expect(r?.asA).toBe('PO')
    expect(r?.criteria).toHaveLength(2)
    expect(r?.criteria[1].done).toBe(true)
    expect(r?.criteria[1].doneAt).toBe('2026-01-01')
  })

  it('descarta criteria mal-formados (sin id o sin text)', () => {
    const r = normalizeUserStory({
      asA: 'X',
      iWant: '',
      soThat: '',
      criteria: [
        { id: 'good', text: 'ok', done: false },
        { id: 'bad-no-text' },
        { text: 'bad-no-id' },
        'string-suelto',
        null,
      ],
    })
    expect(r?.criteria).toHaveLength(1)
    expect(r?.criteria[0].id).toBe('good')
  })

  it('coerce done falsy a false', () => {
    const r = normalizeUserStory({
      asA: 'X',
      iWant: '',
      soThat: '',
      criteria: [{ id: 'c1', text: 't', done: 'truthy-pero-no-true' }],
    })
    expect(r?.criteria[0].done).toBe(false)
  })
})

describe('user-story · countPendingCriteria', () => {
  it('null/undefined → 0', () => {
    expect(countPendingCriteria(null)).toBe(0)
    expect(countPendingCriteria(undefined)).toBe(0)
  })

  it('cuenta solo los no-done', () => {
    expect(
      countPendingCriteria({
        asA: '',
        iWant: '',
        soThat: '',
        criteria: [
          { id: '1', text: 'a', done: false },
          { id: '2', text: 'b', done: true },
          { id: '3', text: 'c', done: false },
        ],
      }),
    ).toBe(2)
  })

  it('todos done → 0', () => {
    expect(
      countPendingCriteria({
        asA: '',
        iWant: '',
        soThat: '',
        criteria: [
          { id: '1', text: 'a', done: true },
          { id: '2', text: 'b', done: true },
        ],
      }),
    ).toBe(0)
  })
})

describe('user-story · userStoryCompletionRate', () => {
  it('null o sin criterios → null', () => {
    expect(userStoryCompletionRate(null)).toBeNull()
    expect(
      userStoryCompletionRate({ asA: '', iWant: '', soThat: '', criteria: [] }),
    ).toBeNull()
  })

  it('porcentaje entero', () => {
    expect(
      userStoryCompletionRate({
        asA: '',
        iWant: '',
        soThat: '',
        criteria: [
          { id: '1', text: 'a', done: true },
          { id: '2', text: 'b', done: true },
          { id: '3', text: 'c', done: false },
          { id: '4', text: 'd', done: false },
        ],
      }),
    ).toBe(50)
  })

  it('todos marcados → 100', () => {
    expect(
      userStoryCompletionRate({
        asA: '',
        iWant: '',
        soThat: '',
        criteria: [
          { id: '1', text: 'a', done: true },
          { id: '2', text: 'b', done: true },
        ],
      }),
    ).toBe(100)
  })
})
