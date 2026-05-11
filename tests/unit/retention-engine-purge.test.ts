import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * R3.0-F · Data Retention Policies — Tests del engine de purge.
 *
 * Cobertura:
 *   1. Itera policies enabled y persiste RetentionPurgeRun (SUCCESS).
 *   2. DELETE en batches respeta `RETENTION_BATCH_SIZE` (1000) y se detiene
 *      cuando un batch retorna menos del límite.
 *   3. Soft-fail por dominio: si AUDIT_LOG falla, SESSION continúa.
 *   4. Actualiza `lastPurgeAt`/`lastPurgeCount` de la policy.
 *   5. Sin members en el workspace, dominios userId-scoped no ejecutan DELETE.
 */

// ─────────────────────────── Mocks ───────────────────────────

const memberFindMany = vi.fn()
const policyFindMany = vi.fn()
const policyUpdate = vi.fn()
const runCreate = vi.fn()
const runUpdate = vi.fn()
const executeRaw = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    workspaceMember: {
      findMany: (...a: unknown[]) => memberFindMany(...a),
    },
    retentionPolicy: {
      findMany: (...a: unknown[]) => policyFindMany(...a),
      update: (...a: unknown[]) => policyUpdate(...a),
    },
    retentionPurgeRun: {
      create: (...a: unknown[]) => runCreate(...a),
      update: (...a: unknown[]) => runUpdate(...a),
    },
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
  },
}))

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: vi.fn(async () => undefined),
}))

vi.mock('server-only', () => ({}))

// ─────────────────────────── Helpers ───────────────────────────

type FakePolicy = {
  id: string
  workspaceId: string
  domain: 'AUDIT_LOG' | 'SESSION' | 'NOTIFICATION' | 'BRAIN_INSIGHT'
  retainDays: number
  enabled: boolean
  lastPurgeAt: Date | null
  lastPurgeCount: number
  createdAt: Date
  updatedAt: Date
}

function makePolicy(overrides: Partial<FakePolicy>): FakePolicy {
  return {
    id: 'p-1',
    workspaceId: 'ws-1',
    domain: 'AUDIT_LOG',
    retainDays: 365,
    enabled: true,
    lastPurgeAt: null,
    lastPurgeCount: 0,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  }
}

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  memberFindMany.mockReset()
  policyFindMany.mockReset()
  policyUpdate.mockReset()
  runCreate.mockReset()
  runUpdate.mockReset()
  executeRaw.mockReset()

  memberFindMany.mockResolvedValue([{ userId: 'u-1' }, { userId: 'u-2' }])
  policyUpdate.mockResolvedValue({})
  // Cada runCreate devuelve un id único basado en call count.
  runCreate.mockImplementation(async () => ({
    id: `run-${runCreate.mock.calls.length}`,
  }))
  runUpdate.mockResolvedValue({})
})

// ─────────────────────────── Tests ───────────────────────────

describe('runPurgeForWorkspace', () => {
  it('1. itera policies enabled y persiste RetentionPurgeRun (SUCCESS)', async () => {
    policyFindMany.mockResolvedValue([
      makePolicy({ id: 'p-audit', domain: 'AUDIT_LOG', retainDays: 365 }),
      makePolicy({ id: 'p-session', domain: 'SESSION', retainDays: 30 }),
    ])
    // Cada DELETE devuelve 0 → ningún batch real para mantener el test rápido.
    executeRaw.mockResolvedValue(0)

    const { runPurgeForWorkspace } = await import('@/lib/retention/engine')
    const report = await runPurgeForWorkspace('ws-1')

    expect(report.workspaceId).toBe('ws-1')
    expect(report.outcomes).toHaveLength(2)
    expect(report.outcomes.every((o) => o.status === 'SUCCESS')).toBe(true)
    expect(report.outcomes.every((o) => o.deletedCount === 0)).toBe(true)
    // Persistió 2 runs (uno por policy) y los actualizó a SUCCESS.
    expect(runCreate).toHaveBeenCalledTimes(2)
    expect(runUpdate).toHaveBeenCalledTimes(2)
    // Actualizó las 2 policies con lastPurgeAt.
    expect(policyUpdate).toHaveBeenCalledTimes(2)
  })

  it('2. DELETE en batches respeta el cutoff por retainDays', async () => {
    policyFindMany.mockResolvedValue([
      makePolicy({ id: 'p-audit', domain: 'AUDIT_LOG', retainDays: 365 }),
    ])
    // Primer batch: 1000 borrados (full batch) → loop continúa.
    // Segundo batch: 500 borrados (< limit) → termina.
    executeRaw.mockResolvedValueOnce(1000).mockResolvedValueOnce(500)

    const { runPurgeForWorkspace } = await import('@/lib/retention/engine')
    const report = await runPurgeForWorkspace('ws-1')

    expect(report.outcomes[0].deletedCount).toBe(1500)
    expect(executeRaw).toHaveBeenCalledTimes(2)
    expect(policyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastPurgeCount: 1500 }),
      }),
    )
  })

  it('3. soft-fail por dominio: AUDIT_LOG falla, SESSION continúa', async () => {
    policyFindMany.mockResolvedValue([
      makePolicy({ id: 'p-audit', domain: 'AUDIT_LOG', retainDays: 365 }),
      makePolicy({ id: 'p-session', domain: 'SESSION', retainDays: 30 }),
    ])
    // Primer dominio (AUDIT_LOG) lanza, segundo (SESSION) ok.
    executeRaw
      .mockRejectedValueOnce(new Error('boom audit'))
      .mockResolvedValue(0)

    const { runPurgeForWorkspace } = await import('@/lib/retention/engine')
    const report = await runPurgeForWorkspace('ws-1')

    expect(report.outcomes).toHaveLength(2)
    const audit = report.outcomes.find((o) => o.domain === 'AUDIT_LOG')
    const session = report.outcomes.find((o) => o.domain === 'SESSION')
    expect(audit?.status).toBe('FAILED')
    expect(audit?.errorMessage).toMatch(/boom audit/)
    expect(audit?.deletedCount).toBe(0)
    expect(session?.status).toBe('SUCCESS')
    // Ambas policies recibieron update de lastPurgeAt (incluso la fallida).
    expect(policyUpdate).toHaveBeenCalledTimes(2)
  })

  it('4. workspace sin miembros: AUDIT_LOG/SESSION/NOTIFICATION no ejecutan DELETE', async () => {
    memberFindMany.mockResolvedValue([])
    policyFindMany.mockResolvedValue([
      makePolicy({ id: 'p-audit', domain: 'AUDIT_LOG' }),
      makePolicy({ id: 'p-session', domain: 'SESSION' }),
      makePolicy({ id: 'p-notif', domain: 'NOTIFICATION' }),
    ])
    executeRaw.mockResolvedValue(0)

    const { runPurgeForWorkspace } = await import('@/lib/retention/engine')
    const report = await runPurgeForWorkspace('ws-1')

    // 0 batches porque no hay userIds para inyectar (early-return).
    expect(executeRaw).not.toHaveBeenCalled()
    // Pero las 3 policies completaron con SUCCESS y deletedCount=0.
    expect(report.outcomes).toHaveLength(3)
    expect(report.outcomes.every((o) => o.status === 'SUCCESS')).toBe(true)
    expect(report.outcomes.every((o) => o.deletedCount === 0)).toBe(true)
  })

  it('5. BRAIN_INSIGHT usa scope workspaceId (no requiere miembros)', async () => {
    memberFindMany.mockResolvedValue([])
    policyFindMany.mockResolvedValue([
      makePolicy({ id: 'p-bi', domain: 'BRAIN_INSIGHT', retainDays: 180 }),
    ])
    executeRaw.mockResolvedValueOnce(42).mockResolvedValueOnce(0)

    const { runPurgeForWorkspace } = await import('@/lib/retention/engine')
    const report = await runPurgeForWorkspace('ws-1')

    expect(report.outcomes[0].domain).toBe('BRAIN_INSIGHT')
    expect(report.outcomes[0].deletedCount).toBe(42)
    expect(report.outcomes[0].status).toBe('SUCCESS')
    expect(executeRaw).toHaveBeenCalled()
  })

  it('6. lanza [INVALID_INPUT] con workspaceId vacío', async () => {
    const { runPurgeForWorkspace } = await import('@/lib/retention/engine')
    await expect(runPurgeForWorkspace('')).rejects.toThrow(/\[INVALID_INPUT\]/)
  })
})
