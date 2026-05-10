import { describe, it, expect } from 'vitest'

import {
  mapStatus,
  mapPriority,
  mapEstimateToStoryPoints,
  parseTags,
  MAX_CSV_ROWS,
} from '@/lib/migrate/csv-mappers'

/**
 * Wave P16-B · Tests unitarios de los mappers puros del Migration
 * Assistant. Validan tolerancia a variaciones (Jira / Trello / ClickUp)
 * sin tocar la BD.
 */
describe('migrate-csv · mappers', () => {
  describe('mapStatus', () => {
    it.each([
      ['Backlog', 'TODO'],
      ['To Do', 'TODO'],
      ['todo', 'TODO'],
      ['In Progress', 'IN_PROGRESS'],
      ['DOING', 'IN_PROGRESS'],
      ['Review', 'REVIEW'],
      ['QA', 'REVIEW'],
      ['Done', 'DONE'],
      ['Closed', 'DONE'],
      ['resolved', 'DONE'],
      ['Blocked', 'TODO'],
      ['', 'TODO'],
      ['xxx', 'TODO'],
    ])('mapea "%s" → %s', (input, expected) => {
      expect(mapStatus(input)).toBe(expected)
    })

    it('tolera null/undefined', () => {
      expect(mapStatus(null)).toBe('TODO')
      expect(mapStatus(undefined)).toBe('TODO')
    })
  })

  describe('mapPriority', () => {
    it.each([
      ['Highest', 'CRITICAL'],
      ['critical', 'CRITICAL'],
      ['urgent', 'CRITICAL'],
      ['High', 'HIGH'],
      ['Medium', 'MEDIUM'],
      ['Normal', 'MEDIUM'],
      ['Low', 'LOW'],
      ['Lowest', 'LOW'],
      ['', 'MEDIUM'],
      ['unknown', 'MEDIUM'],
    ])('mapea "%s" → %s', (input, expected) => {
      expect(mapPriority(input)).toBe(expected)
    })
  })

  describe('mapEstimateToStoryPoints', () => {
    it('snap a Fibonacci más cercano', () => {
      expect(mapEstimateToStoryPoints(1)).toBe(1)
      expect(mapEstimateToStoryPoints(2)).toBe(2)
      expect(mapEstimateToStoryPoints(3)).toBe(3)
      expect(mapEstimateToStoryPoints(4)).toBe(3)
      expect(mapEstimateToStoryPoints(5)).toBe(5)
      expect(mapEstimateToStoryPoints(6)).toBe(5)
      expect(mapEstimateToStoryPoints(7)).toBe(8)
      expect(mapEstimateToStoryPoints(8)).toBe(8)
      expect(mapEstimateToStoryPoints(13)).toBe(13)
      expect(mapEstimateToStoryPoints(21)).toBe(21)
      expect(mapEstimateToStoryPoints(50)).toBe(21)
    })

    it('acepta strings numéricos', () => {
      expect(mapEstimateToStoryPoints('5')).toBe(5)
      expect(mapEstimateToStoryPoints('  8  ')).toBe(8)
    })

    it('null/undefined/vacío → null', () => {
      expect(mapEstimateToStoryPoints(null)).toBeNull()
      expect(mapEstimateToStoryPoints(undefined)).toBeNull()
      expect(mapEstimateToStoryPoints('')).toBeNull()
      expect(mapEstimateToStoryPoints('abc')).toBeNull()
      expect(mapEstimateToStoryPoints(0)).toBeNull()
      expect(mapEstimateToStoryPoints(-1)).toBeNull()
    })
  })

  describe('parseTags', () => {
    it('split por coma + trim + lowercase + dedupe', () => {
      expect(parseTags('Auth, Frontend, frontend, BACKEND')).toEqual([
        'auth',
        'frontend',
        'backend',
      ])
    })
    it('strings vacías y huérfanos', () => {
      expect(parseTags('')).toEqual([])
      expect(parseTags(null)).toEqual([])
      expect(parseTags(undefined)).toEqual([])
      expect(parseTags(',,,')).toEqual([])
    })
  })

  describe('MAX_CSV_ROWS', () => {
    it('expone constante de límite', () => {
      expect(MAX_CSV_ROWS).toBe(500)
    })
  })
})
