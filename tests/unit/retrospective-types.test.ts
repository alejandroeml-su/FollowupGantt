import { describe, it, expect } from 'vitest'
import {
  FORMAT_DEFINITIONS,
  countItems,
  emptyData,
  formatLabel,
  generateItemId,
  isValidFormat,
  normalizeData,
} from '@/lib/retrospective/types'

describe('retrospective · isValidFormat', () => {
  it('reconoce los 3 formats canónicos', () => {
    expect(isValidFormat('FOUR_LS')).toBe(true)
    expect(isValidFormat('START_STOP_CONTINUE')).toBe(true)
    expect(isValidFormat('MAD_SAD_GLAD')).toBe(true)
  })

  it('rechaza valores inválidos', () => {
    expect(isValidFormat('OTHER')).toBe(false)
    expect(isValidFormat(null)).toBe(false)
    expect(isValidFormat(undefined)).toBe(false)
    expect(isValidFormat(42)).toBe(false)
  })
})

describe('retrospective · emptyData', () => {
  it('genera 4 categorías para FOUR_LS', () => {
    const d = emptyData('FOUR_LS')
    expect(Object.keys(d.categories)).toHaveLength(4)
    expect(d.categories.liked).toBeDefined()
    expect(d.categories.lacked).toBeDefined()
    expect(d.categories.learned).toBeDefined()
    expect(d.categories.longed_for).toBeDefined()
  })

  it('genera 3 categorías para START_STOP_CONTINUE', () => {
    const d = emptyData('START_STOP_CONTINUE')
    expect(Object.keys(d.categories)).toHaveLength(3)
    expect(d.categories.start).toBeDefined()
    expect(d.categories.stop).toBeDefined()
    expect(d.categories.continue).toBeDefined()
  })

  it('genera 3 categorías para MAD_SAD_GLAD', () => {
    const d = emptyData('MAD_SAD_GLAD')
    expect(Object.keys(d.categories)).toHaveLength(3)
    expect(d.categories.mad).toBeDefined()
    expect(d.categories.sad).toBeDefined()
    expect(d.categories.glad).toBeDefined()
  })

  it('todas las categorías inician con items vacío', () => {
    const d = emptyData('FOUR_LS')
    for (const cat of Object.values(d.categories)) {
      expect(cat.items).toEqual([])
    }
  })
})

describe('retrospective · normalizeData', () => {
  it('null/undefined → empty data del format', () => {
    const r = normalizeData(null, 'FOUR_LS')
    expect(Object.keys(r.categories)).toHaveLength(4)
    for (const cat of Object.values(r.categories)) {
      expect(cat.items).toEqual([])
    }
  })

  it('descarta categorías que no aplican al format', () => {
    const raw = {
      categories: {
        liked: { label: 'L', items: [{ id: 'a', text: 'ok', votes: [] }] },
        zombie_cat: { label: 'Z', items: [{ id: 'b', text: 'kill', votes: [] }] },
      },
    }
    const r = normalizeData(raw, 'FOUR_LS')
    expect(r.categories.liked.items).toHaveLength(1)
    expect(r.categories['zombie_cat']).toBeUndefined()
  })

  it('descarta items sin id o sin text', () => {
    const raw = {
      categories: {
        liked: {
          label: 'L',
          items: [
            { id: 'a', text: 'ok', votes: [] },
            { id: 'b' },
            { text: 'no-id' },
            null,
          ],
        },
      },
    }
    const r = normalizeData(raw, 'FOUR_LS')
    expect(r.categories.liked.items).toHaveLength(1)
    expect(r.categories.liked.items[0].id).toBe('a')
  })

  it('dedupe votes', () => {
    const raw = {
      categories: {
        liked: {
          label: 'L',
          items: [{ id: 'a', text: 'ok', votes: ['u1', 'u2', 'u1', 'u3'] }],
        },
      },
    }
    const r = normalizeData(raw, 'FOUR_LS')
    const item = r.categories.liked.items[0]
    expect(item.votes.sort()).toEqual(['u1', 'u2', 'u3'])
  })

  it('preserva taskId', () => {
    const raw = {
      categories: {
        liked: {
          label: 'L',
          items: [{ id: 'a', text: 'ok', votes: [], taskId: 'task-123' }],
        },
      },
    }
    const r = normalizeData(raw, 'FOUR_LS')
    expect(r.categories.liked.items[0].taskId).toBe('task-123')
  })

  it('coerce taskId no-string a null', () => {
    const raw = {
      categories: {
        liked: {
          label: 'L',
          items: [{ id: 'a', text: 'ok', votes: [], taskId: 42 }],
        },
      },
    }
    const r = normalizeData(raw, 'FOUR_LS')
    expect(r.categories.liked.items[0].taskId).toBeNull()
  })
})

describe('retrospective · countItems', () => {
  it('null → 0', () => {
    expect(countItems(null)).toBe(0)
    expect(countItems(undefined)).toBe(0)
  })

  it('suma items de todas las categorías', () => {
    const d = emptyData('FOUR_LS')
    d.categories.liked.items.push({ id: '1', text: 'a', votes: [], authorId: null })
    d.categories.learned.items.push(
      { id: '2', text: 'b', votes: [], authorId: null },
      { id: '3', text: 'c', votes: [], authorId: null },
    )
    expect(countItems(d)).toBe(3)
  })
})

describe('retrospective · FORMAT_DEFINITIONS', () => {
  it('cada format tiene al menos 3 columnas', () => {
    expect(FORMAT_DEFINITIONS.FOUR_LS.length).toBeGreaterThanOrEqual(4)
    expect(FORMAT_DEFINITIONS.START_STOP_CONTINUE.length).toBeGreaterThanOrEqual(3)
    expect(FORMAT_DEFINITIONS.MAD_SAD_GLAD.length).toBeGreaterThanOrEqual(3)
  })

  it('cada columna tiene id+label+emoji+tone', () => {
    for (const cols of Object.values(FORMAT_DEFINITIONS)) {
      for (const col of cols) {
        expect(col.id).toBeTruthy()
        expect(col.label).toBeTruthy()
        expect(col.emoji).toBeTruthy()
        expect(col.tone).toBeTruthy()
      }
    }
  })
})

describe('retrospective · formatLabel', () => {
  it('mapea cada format a string es-MX', () => {
    expect(formatLabel('FOUR_LS')).toContain('4Ls')
    expect(formatLabel('START_STOP_CONTINUE')).toContain('Start')
    expect(formatLabel('MAD_SAD_GLAD')).toContain('Mad')
  })
})

describe('retrospective · generateItemId', () => {
  it('genera ids únicos', () => {
    const a = generateItemId()
    const b = generateItemId()
    expect(a).not.toBe(b)
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(5)
  })
})
