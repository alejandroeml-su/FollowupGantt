import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P2 · Equipo P2-3 — Tests de `scheduleAll`.
 *
 * Mockeamos `prisma.recurrenceRule.findMany` y `generateOverdueOccurrences`
 * para validar:
 *   - itera sobre reglas activas
 *   - aísla errores por regla (failure no detiene el batch)
 *   - acumula contadores
 *   - idempotencia transitiva (segunda corrida con mismas reglas devuelve
 *     0 generated cuando todo está skipped)
 *   - no procesa reglas inactivas (filtro `where active=true`)
 */

const ruleFindMany = vi.fn()
const generateOverdueOccurrences = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    recurrenceRule: {
      findMany: (...a: unknown[]) => ruleFindMany(...a),
    },
  },
}))

vi.mock('@/lib/actions/recurrence', () => ({
  generateOverdueOccurrences: (...a: unknown[]) => generateOverdueOccurrences(...a),
}))

beforeEach(() => {
  ruleFindMany.mockReset().mockResolvedValue([])
  generateOverdueOccurrences.mockReset()
})

describe('scheduleAll', () => {
  it('procesa todas las reglas activas y suma contadores', async () => {
    ruleFindMany.mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }])
    generateOverdueOccurrences
      .mockResolvedValueOnce({ generated: 3, skipped: 0 })
      .mockResolvedValueOnce({ generated: 1, skipped: 2 })
    const { scheduleAll } = await import('@/lib/recurrence/scheduler')
    const summary = await scheduleAll(new Date('2026-05-10T00:00:00.000Z'))
    expect(summary.rulesProcessed).toBe(2)
    expect(summary.rulesFailed).toBe(0)
    expect(summary.totalGenerated).toBe(4)
    expect(summary.totalSkipped).toBe(2)
  })

  it('aísla errores por regla y reporta failures', async () => {
    ruleFindMany.mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }])
    generateOverdueOccurrences
      .mockRejectedValueOnce(new Error('[TEMPLATE_NOT_FOUND] template borrado'))
      .mockResolvedValueOnce({ generated: 2, skipped: 0 })
    const { scheduleAll } = await import('@/lib/recurrence/scheduler')
    const summary = await scheduleAll()
    expect(summary.rulesProcessed).toBe(1)
    expect(summary.rulesFailed).toBe(1)
    expect(summary.totalGenerated).toBe(2)
    expect(summary.failures).toEqual([
      { ruleId: 'r1', error: '[TEMPLATE_NOT_FOUND] template borrado' },
    ])
  })

  it('idempotencia: segunda corrida con todas las occurrencias ya hechas devuelve 0 generated', async () => {
    ruleFindMany.mockResolvedValue([{ id: 'r1' }])
    // primera corrida: genera 3
    generateOverdueOccurrences.mockResolvedValueOnce({ generated: 3, skipped: 0 })
    // segunda corrida: las 3 ya existen → skipped
    generateOverdueOccurrences.mockResolvedValueOnce({ generated: 0, skipped: 3 })
    const { scheduleAll } = await import('@/lib/recurrence/scheduler')
    const first = await scheduleAll()
    const second = await scheduleAll()
    expect(first.totalGenerated).toBe(3)
    expect(second.totalGenerated).toBe(0)
    expect(second.totalSkipped).toBe(3)
  })

  it('si no hay reglas activas, summary queda en cero', async () => {
    ruleFindMany.mockResolvedValueOnce([])
    const { scheduleAll } = await import('@/lib/recurrence/scheduler')
    const summary = await scheduleAll()
    expect(summary).toEqual({
      rulesProcessed: 0,
      rulesFailed: 0,
      totalGenerated: 0,
      totalSkipped: 0,
      failures: [],
    })
    expect(generateOverdueOccurrences).not.toHaveBeenCalled()
  })

  it('llama a findMany filtrando active=true', async () => {
    ruleFindMany.mockResolvedValueOnce([])
    const { scheduleAll } = await import('@/lib/recurrence/scheduler')
    await scheduleAll()
    expect(ruleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    )
  })
})
