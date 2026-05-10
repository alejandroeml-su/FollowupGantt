import { describe, it, expect } from 'vitest'

import {
  shouldSeedKit,
  DEFAULT_ONBOARDING_TASKS,
  DEFAULT_COMM_PLAN_ITEMS,
} from '@/lib/onboarding/seed-kit'
import {
  DEFAULT_DOR_TEMPLATE,
  DEFAULT_DOD_TEMPLATE,
} from '@/lib/dor-dod/types'

/**
 * Wave P16-B · Tests del Onboarding Kit. Validan helper puro
 * `shouldSeedKit` y el shape de los templates default.
 */
describe('onboarding · seed-kit', () => {
  describe('shouldSeedKit', () => {
    it('aplica a SCRUM y HYBRID', () => {
      expect(shouldSeedKit('SCRUM')).toBe(true)
      expect(shouldSeedKit('HYBRID')).toBe(true)
    })
    it('NO aplica a PMI', () => {
      expect(shouldSeedKit('PMI')).toBe(false)
    })
    it('tolera null/undefined/strings vacíos', () => {
      expect(shouldSeedKit(null)).toBe(false)
      expect(shouldSeedKit(undefined)).toBe(false)
      expect(shouldSeedKit('')).toBe(false)
      expect(shouldSeedKit('SOMETHING_ELSE')).toBe(false)
    })
  })

  describe('DEFAULT_ONBOARDING_TASKS', () => {
    it('tiene exactamente 5 tasks', () => {
      expect(DEFAULT_ONBOARDING_TASKS).toHaveLength(5)
    })
    it('todas tienen título, descripción, priority y storyPoints', () => {
      for (const t of DEFAULT_ONBOARDING_TASKS) {
        expect(t.title).toBeTruthy()
        expect(t.description).toBeTruthy()
        expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).toContain(t.priority)
        expect([1, 2, 3, 5, 8, 13, 21]).toContain(t.storyPoints)
      }
    })
    it('incluye Kick-off + Retrospectiva inicial', () => {
      const titles = DEFAULT_ONBOARDING_TASKS.map((t) => t.title)
      expect(titles.some((t) => /Kick-off/i.test(t))).toBe(true)
      expect(titles.some((t) => /Retrospectiva/i.test(t))).toBe(true)
    })
  })

  describe('DEFAULT_COMM_PLAN_ITEMS', () => {
    it('tiene 3 audiencias canónicas', () => {
      expect(DEFAULT_COMM_PLAN_ITEMS).toHaveLength(3)
      const audiences = DEFAULT_COMM_PLAN_ITEMS.map((i) => i.audience)
      expect(audiences.some((a) => /Sponsor/i.test(a))).toBe(true)
      expect(audiences.some((a) => /Equipo/i.test(a))).toBe(true)
      expect(audiences.some((a) => /Stakeholders/i.test(a))).toBe(true)
    })
  })

  describe('DEFAULT_DOR/DOD templates (reuso)', () => {
    it('DoR tiene 5+ items', () => {
      expect(DEFAULT_DOR_TEMPLATE.length).toBeGreaterThanOrEqual(5)
    })
    it('DoD tiene 6+ items', () => {
      expect(DEFAULT_DOD_TEMPLATE.length).toBeGreaterThanOrEqual(6)
    })
  })
})
