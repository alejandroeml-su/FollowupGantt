import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * R3.0-F · Data Retention Policies — Tests de `ensureDefaultPolicies`.
 *
 * Cobertura:
 *   1. Crea las 4 policies con días default cuando no existen.
 *   2. Idempotente: `skipDuplicates` no falla si ya existen.
 *   3. Rechaza workspaceId vacío con [INVALID_INPUT].
 */

const createMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    retentionPolicy: {
      createMany: (...a: unknown[]) => createMany(...a),
    },
  },
}))

beforeEach(() => {
  createMany.mockReset()
  createMany.mockResolvedValue({ count: 4 })
})

describe('ensureDefaultPolicies', () => {
  it('1. crea las 4 policies con días default cuando faltan', async () => {
    const { ensureDefaultPolicies, RETENTION_DEFAULT_DAYS } = await import(
      '@/lib/retention/defaults'
    )

    const result = await ensureDefaultPolicies('ws-1')
    expect(result.created).toBe(4)
    expect(createMany).toHaveBeenCalledTimes(1)
    const args = createMany.mock.calls.at(-1)?.[0] as {
      data: Array<{ workspaceId: string; domain: string; retainDays: number; enabled: boolean }>
      skipDuplicates: boolean
    }
    expect(args.skipDuplicates).toBe(true)
    expect(args.data).toHaveLength(4)

    const byDomain = Object.fromEntries(args.data.map((p) => [p.domain, p]))
    expect(byDomain.AUDIT_LOG.retainDays).toBe(RETENTION_DEFAULT_DAYS.AUDIT_LOG)
    expect(byDomain.AUDIT_LOG.retainDays).toBe(365)
    expect(byDomain.SESSION.retainDays).toBe(30)
    expect(byDomain.NOTIFICATION.retainDays).toBe(90)
    expect(byDomain.BRAIN_INSIGHT.retainDays).toBe(180)

    for (const p of args.data) {
      expect(p.workspaceId).toBe('ws-1')
      expect(p.enabled).toBe(true)
    }
  })

  it('2. idempotente: con count=0 no rompe', async () => {
    createMany.mockResolvedValueOnce({ count: 0 })
    const { ensureDefaultPolicies } = await import('@/lib/retention/defaults')
    const result = await ensureDefaultPolicies('ws-1')
    expect(result.created).toBe(0)
  })

  it('3. rechaza workspaceId vacío con [INVALID_INPUT]', async () => {
    const { ensureDefaultPolicies } = await import('@/lib/retention/defaults')
    await expect(ensureDefaultPolicies('')).rejects.toThrow(/\[INVALID_INPUT\]/)
    expect(createMany).not.toHaveBeenCalled()
  })
})
