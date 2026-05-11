import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * R3.0-F · Data Retention Policies — Tests de server actions.
 *
 * Cobertura:
 *   updatePolicy:
 *    1. valida retainDays >= 1 (rechaza 0 y -1 con INVALID_INPUT).
 *    2. valida retainDays <= 3650.
 *    3. lanza [POLICY_NOT_FOUND] si la policy no existe.
 *    4. permite actualizar solo `enabled` sin cambiar retainDays.
 *
 *   runPurgeNow:
 *    5. exige role manager (MEMBER recibe FORBIDDEN propagado del guard).
 *    6. invoca `runPurgeForWorkspace` y serializa el reporte.
 *
 *   getPurgeHistory:
 *    7. devuelve runs serializados con domain del join.
 */

const policyFindUnique = vi.fn()
const policyFindMany = vi.fn()
const policyUpdate = vi.fn()
const policyCreateMany = vi.fn()
const runFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    retentionPolicy: {
      findUnique: (...a: unknown[]) => policyFindUnique(...a),
      findMany: (...a: unknown[]) => policyFindMany(...a),
      update: (...a: unknown[]) => policyUpdate(...a),
      createMany: (...a: unknown[]) => policyCreateMany(...a),
    },
    retentionPurgeRun: {
      findMany: (...a: unknown[]) => runFindMany(...a),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

const requireWorkspaceManager = vi.fn(async () => ({
  user: {
    id: 'u-1',
    email: 'edwin@avante.com',
    name: 'Edwin',
    roles: ['SUPER_ADMIN'],
  },
  role: 'OWNER',
}))

vi.mock('@/lib/auth/check-workspace-access', () => ({
  requireWorkspaceManager: (...a: unknown[]) => requireWorkspaceManager(...a),
  requireWorkspaceAccess: vi.fn(),
}))

const recordAuditEventSafe = vi.fn(async () => undefined)
vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...a: unknown[]) => recordAuditEventSafe(...a),
}))

const runPurgeForWorkspace = vi.fn()
vi.mock('@/lib/retention/engine', () => ({
  runPurgeForWorkspace: (...a: unknown[]) => runPurgeForWorkspace(...a),
}))

vi.mock('server-only', () => ({}))

beforeEach(() => {
  policyFindUnique.mockReset()
  policyFindMany.mockReset()
  policyUpdate.mockReset()
  policyCreateMany.mockReset()
  runFindMany.mockReset()
  requireWorkspaceManager.mockClear()
  recordAuditEventSafe.mockClear()
  runPurgeForWorkspace.mockReset()

  policyCreateMany.mockResolvedValue({ count: 0 })
})

describe('updatePolicy', () => {
  it('1. rechaza retainDays < 1 con [INVALID_INPUT]', async () => {
    const { updatePolicy } = await import('@/lib/actions/retention')
    await expect(
      updatePolicy({
        workspaceId: 'ws-1',
        domain: 'AUDIT_LOG',
        retainDays: 0,
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
    await expect(
      updatePolicy({
        workspaceId: 'ws-1',
        domain: 'AUDIT_LOG',
        retainDays: -5,
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
    expect(policyUpdate).not.toHaveBeenCalled()
  })

  it('2. rechaza retainDays > 3650 con [INVALID_INPUT]', async () => {
    const { updatePolicy } = await import('@/lib/actions/retention')
    await expect(
      updatePolicy({
        workspaceId: 'ws-1',
        domain: 'AUDIT_LOG',
        retainDays: 99999,
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('3. lanza [POLICY_NOT_FOUND] si la policy no existe', async () => {
    policyFindUnique.mockResolvedValue(null)
    const { updatePolicy } = await import('@/lib/actions/retention')
    await expect(
      updatePolicy({
        workspaceId: 'ws-orphan',
        domain: 'AUDIT_LOG',
        retainDays: 180,
      }),
    ).rejects.toThrow(/\[POLICY_NOT_FOUND\]/)
  })

  it('4. actualiza solo `enabled` y emite audit retention.policy.updated', async () => {
    policyFindUnique.mockResolvedValue({
      id: 'pol-1',
      workspaceId: 'ws-1',
      domain: 'AUDIT_LOG',
      retainDays: 365,
      enabled: true,
      lastPurgeAt: null,
      lastPurgeCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    policyUpdate.mockResolvedValue({
      id: 'pol-1',
      workspaceId: 'ws-1',
      domain: 'AUDIT_LOG',
      retainDays: 365,
      enabled: false,
      lastPurgeAt: null,
      lastPurgeCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { updatePolicy } = await import('@/lib/actions/retention')
    const out = await updatePolicy({
      workspaceId: 'ws-1',
      domain: 'AUDIT_LOG',
      enabled: false,
    })
    expect(out.enabled).toBe(false)
    expect(out.retainDays).toBe(365)
    // El update solo pasó { enabled: false } (no retainDays).
    const args = policyUpdate.mock.calls.at(-1)?.[0] as {
      data: Record<string, unknown>
    }
    expect(args.data).toEqual({ enabled: false })
    // Audit emitido con before/after correctos.
    expect(recordAuditEventSafe).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'retention.policy.updated',
        before: { retainDays: 365, enabled: true },
        after: { retainDays: 365, enabled: false },
      }),
    )
  })
})

describe('runPurgeNow', () => {
  it('5. requireWorkspaceManager se invoca antes del engine (guard ADMIN/OWNER)', async () => {
    runPurgeForWorkspace.mockResolvedValue({
      workspaceId: 'ws-1',
      startedAt: '2026-05-11T00:00:00Z',
      completedAt: '2026-05-11T00:00:01Z',
      outcomes: [],
    })
    // Si el guard lanza FORBIDDEN, runPurgeForWorkspace nunca se invoca.
    requireWorkspaceManager.mockRejectedValueOnce(
      new Error('[FORBIDDEN] Sólo OWNER o ADMIN del workspace pueden gestionar'),
    )
    const { runPurgeNow } = await import('@/lib/actions/retention')
    await expect(runPurgeNow({ workspaceId: 'ws-1' })).rejects.toThrow(
      /\[FORBIDDEN\]/,
    )
    expect(runPurgeForWorkspace).not.toHaveBeenCalled()
  })

  it('6. invoca runPurgeForWorkspace y serializa outcomes', async () => {
    runPurgeForWorkspace.mockResolvedValue({
      workspaceId: 'ws-1',
      startedAt: '2026-05-11T00:00:00Z',
      completedAt: '2026-05-11T00:00:01Z',
      outcomes: [
        {
          domain: 'AUDIT_LOG',
          status: 'SUCCESS',
          deletedCount: 42,
          errorMessage: null,
          runId: 'r-1',
        },
      ],
    })
    const { runPurgeNow } = await import('@/lib/actions/retention')
    const out = await runPurgeNow({ workspaceId: 'ws-1' })
    expect(out.workspaceId).toBe('ws-1')
    expect(out.outcomes).toHaveLength(1)
    expect(out.outcomes[0].deletedCount).toBe(42)
    expect(runPurgeForWorkspace).toHaveBeenCalledWith('ws-1')
  })
})

describe('getPurgeHistory', () => {
  it('7. devuelve runs serializados con domain', async () => {
    runFindMany.mockResolvedValue([
      {
        id: 'r-1',
        policyId: 'p-1',
        startedAt: new Date('2026-05-11T00:00:00Z'),
        completedAt: new Date('2026-05-11T00:00:30Z'),
        deletedCount: 100,
        status: 'SUCCESS',
        errorMessage: null,
        policy: { domain: 'AUDIT_LOG' },
      },
    ])
    const { getPurgeHistory } = await import('@/lib/actions/retention')
    const rows = await getPurgeHistory({ workspaceId: 'ws-1', limit: 10 })
    expect(rows).toHaveLength(1)
    expect(rows[0].domain).toBe('AUDIT_LOG')
    expect(rows[0].status).toBe('SUCCESS')
    expect(rows[0].deletedCount).toBe(100)
    expect(rows[0].startedAt).toBe('2026-05-11T00:00:00.000Z')
  })
})
