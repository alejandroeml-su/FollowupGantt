import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * R3-E · Engine de batching — cola in-memory + retry + persistencia.
 *
 * Cubre:
 *   - `enqueueEvent` jamás lanza ni bloquea.
 *   - `flushBatches` agrupa por target y persiste `AuditStreamDelivery`.
 *   - Retry exponencial: tras N fallos, el delivery queda `FAILED`.
 *   - `enqueueEvent(null, …)` se descarta silenciosamente.
 *   - Cola full → drop con warning (no rompe).
 */

// ─────────────────────── Mocks ───────────────────────

const targetsFindMany = vi.fn()
const deliveryCreate = vi.fn()
const deliveryUpdate = vi.fn()
const targetUpdate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    auditStreamTarget: {
      findMany: (...args: unknown[]) => targetsFindMany(...args),
      update: (...args: unknown[]) => targetUpdate(...args),
    },
    auditStreamDelivery: {
      create: (...args: unknown[]) => deliveryCreate(...args),
      update: (...args: unknown[]) => deliveryUpdate(...args),
      findMany: vi.fn(async () => []),
    },
  },
}))

// Mock dinámico del selector de adapter para inyectar comportamientos.
const adapterSendMock = vi.fn()
vi.mock('@/lib/audit/streaming/adapters', () => ({
  getAdapter: () => ({ send: adapterSendMock }),
  splunkAdapter: { send: adapterSendMock },
  datadogAdapter: { send: adapterSendMock },
  genericAdapter: { send: adapterSendMock },
}))

beforeEach(() => {
  targetsFindMany.mockReset()
  deliveryCreate.mockReset()
  deliveryUpdate.mockReset()
  targetUpdate.mockReset()
  adapterSendMock.mockReset()

  deliveryCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'd-' + Math.random().toString(36).slice(2, 8),
    attempt: 0,
    ...data,
  }))
  deliveryUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    ...data,
  }))
  targetUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    ...data,
  }))
})

// ─────────────────────── Tests ───────────────────────

describe('engine · enqueueEvent', () => {
  it('descarta silenciosamente eventos sin workspaceId', async () => {
    const { enqueueEvent, __queueSizeForTests, __resetQueueForTests } = await import(
      '@/lib/audit/streaming/engine'
    )
    __resetQueueForTests()
    enqueueEvent(null, {
      id: 'evt-1',
      action: 'task.created',
      entityType: 'task',
      entityId: null,
      actorId: null,
      workspaceId: null,
      before: null,
      after: null,
      metadata: null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date().toISOString(),
    })
    expect(__queueSizeForTests('ANY')).toBe(0)
  })

  it('encola eventos por workspace', async () => {
    const { enqueueEvent, __queueSizeForTests, __resetQueueForTests } = await import(
      '@/lib/audit/streaming/engine'
    )
    __resetQueueForTests()
    for (let i = 0; i < 5; i++) {
      enqueueEvent('w-1', {
        id: 'e' + i,
        action: 'task.created',
        entityType: 'task',
        entityId: null,
        actorId: null,
        workspaceId: 'w-1',
        before: null,
        after: null,
        metadata: null,
        ipAddress: null,
        userAgent: null,
        createdAt: new Date().toISOString(),
      })
    }
    expect(__queueSizeForTests('w-1')).toBe(5)
  })
})

describe('engine · flushBatches', () => {
  it('agrupa cola por target y persiste un AuditStreamDelivery SUCCESS', async () => {
    const { enqueueEvent, flushBatches, __resetQueueForTests } = await import(
      '@/lib/audit/streaming/engine'
    )
    __resetQueueForTests()

    targetsFindMany.mockResolvedValueOnce([
      {
        id: 't1',
        workspaceId: 'w-1',
        kind: 'SPLUNK',
        endpoint: 'https://hec/svc',
        secret: 'tok',
        batchSize: 100,
        enabled: true,
      },
    ])
    adapterSendMock.mockResolvedValue({ ok: true, statusCode: 200 })

    for (let i = 0; i < 3; i++) {
      enqueueEvent('w-1', {
        id: 'e' + i,
        action: 'task.created',
        entityType: 'task',
        entityId: null,
        actorId: null,
        workspaceId: 'w-1',
        before: null,
        after: null,
        metadata: null,
        ipAddress: null,
        userAgent: null,
        createdAt: new Date().toISOString(),
      })
    }

    const summary = await flushBatches({ noWait: true })
    expect(summary.targetsProcessed).toBe(1)
    expect(summary.batchesSent).toBe(1)
    expect(summary.eventsSent).toBe(3)
    expect(summary.batchesFailed).toBe(0)

    expect(deliveryCreate).toHaveBeenCalledTimes(1)
    const createArg = deliveryCreate.mock.calls[0][0] as { data: { count: number; status: string } }
    expect(createArg.data.count).toBe(3)
    expect(createArg.data.status).toBe('PENDING')

    // SUCCESS update
    const updateCalls = deliveryUpdate.mock.calls.map(
      (c) => (c[0] as { data: { status?: string } }).data.status,
    )
    expect(updateCalls).toContain('SUCCESS')
    // Target lastDeliveryAt updated
    expect(targetUpdate).toHaveBeenCalled()
  })

  it('reintenta hasta MAX_ATTEMPTS y marca FAILED cuando todos fallan', async () => {
    const { enqueueEvent, flushBatches, __resetQueueForTests, MAX_ATTEMPTS } =
      await import('@/lib/audit/streaming/engine')
    __resetQueueForTests()

    targetsFindMany.mockResolvedValueOnce([
      {
        id: 't2',
        workspaceId: 'w-2',
        kind: 'GENERIC_WEBHOOK',
        endpoint: 'https://siem',
        secret: 'shh',
        batchSize: 100,
        enabled: true,
      },
    ])
    adapterSendMock.mockResolvedValue({ ok: false, error: 'timeout', statusCode: 504 })

    enqueueEvent('w-2', {
      id: 'e0',
      action: 'task.created',
      entityType: 'task',
      entityId: null,
      actorId: null,
      workspaceId: 'w-2',
      before: null,
      after: null,
      metadata: null,
      ipAddress: null,
      userAgent: null,
      createdAt: new Date().toISOString(),
    })

    const summary = await flushBatches({ noWait: true })
    expect(summary.batchesFailed).toBe(1)
    expect(summary.batchesSent).toBe(0)
    expect(adapterSendMock).toHaveBeenCalledTimes(MAX_ATTEMPTS)

    const statuses = deliveryUpdate.mock.calls.map(
      (c) => (c[0] as { data: { status?: string } }).data.status,
    )
    // Último update debe ser FAILED
    expect(statuses[statuses.length - 1]).toBe('FAILED')
    // Target.lastError actualizado
    const lastTargetUpdate = targetUpdate.mock.calls.at(-1)?.[0] as {
      data: { lastError?: string }
    }
    expect(lastTargetUpdate.data.lastError).toContain('timeout')
  })

  it('respeta batchSize partiendo la cola en múltiples deliveries', async () => {
    const { enqueueEvent, flushBatches, __resetQueueForTests } = await import(
      '@/lib/audit/streaming/engine'
    )
    __resetQueueForTests()

    targetsFindMany.mockResolvedValueOnce([
      {
        id: 't3',
        workspaceId: 'w-3',
        kind: 'DATADOG',
        endpoint: 'https://dd',
        secret: 'k',
        batchSize: 2,
        enabled: true,
      },
    ])
    adapterSendMock.mockResolvedValue({ ok: true, statusCode: 202 })

    for (let i = 0; i < 5; i++) {
      enqueueEvent('w-3', {
        id: 'e' + i,
        action: 'task.created',
        entityType: 'task',
        entityId: null,
        actorId: null,
        workspaceId: 'w-3',
        before: null,
        after: null,
        metadata: null,
        ipAddress: null,
        userAgent: null,
        createdAt: new Date().toISOString(),
      })
    }

    const summary = await flushBatches({ noWait: true })
    // 5 eventos / batchSize 2 → 3 batches (2+2+1)
    expect(summary.batchesSent).toBe(3)
    expect(summary.eventsSent).toBe(5)
    expect(deliveryCreate).toHaveBeenCalledTimes(3)
  })
})
