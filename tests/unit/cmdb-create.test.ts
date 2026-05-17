import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave R5 · US-9.3 — Tests del server action `createCI`.
 *
 * Cobertura:
 *   1. Crea un CI con valores por defecto + auto-genera código CI-001.
 *   2. Auto-incrementa el código respetando el último existente.
 *   3. Valida `INVALID_INPUT` cuando faltan campos requeridos.
 *   4. Registra audit event `ci.created` con metadata workspaceId.
 *
 * Mockeamos prisma + auth + audit para no depender de BD ni de la sesión real.
 */

// ─────────────────────────── Mocks ───────────────────────────

const ciCreate = vi.fn()
const ciFindFirst = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    configurationItem: {
      create: (...a: unknown[]) => ciCreate(...a),
      findFirst: (...a: unknown[]) => ciFindFirst(...a),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

const sessionUser = {
  id: 'user-1',
  email: 'edwin@avante.com',
  name: 'Edwin',
  roles: ['SUPER_ADMIN'],
  workspaceId: 'ws-avante',
}

vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: async () => sessionUser,
  requireUser: async () => sessionUser,
}))

const recordAuditEventSafe = vi.fn(async () => undefined)
vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...a: unknown[]) => recordAuditEventSafe(...a),
}))

// Stubeamos withMetrics para que sea passthrough.
vi.mock('@/lib/observability/metrics', () => ({
  withMetrics: <T,>(_name: string, fn: () => Promise<T>) => fn(),
}))

vi.mock('server-only', () => ({}))

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  ciCreate.mockReset()
  ciFindFirst.mockReset()
  recordAuditEventSafe.mockReset()
})

// ─────────────────────────── Tests ───────────────────────────

describe('createCI', () => {
  it('crea CI con defaults y código CI-001 cuando no hay previos', async () => {
    ciFindFirst.mockResolvedValueOnce(null)
    ciCreate.mockResolvedValueOnce({ id: 'ci-1', code: 'CI-001' })

    const { createCI } = await import('@/lib/actions/cmdb')
    const out = await createCI({ name: 'Servidor de Correo' })

    expect(out).toEqual({ id: 'ci-1', code: 'CI-001' })
    const arg = ciCreate.mock.calls.at(-1)?.[0] as {
      data: Record<string, unknown>
    }
    expect(arg.data.code).toBe('CI-001')
    expect(arg.data.workspaceId).toBe('ws-avante')
    expect(arg.data.type).toBe('OTHER')
    expect(arg.data.status).toBe('ACTIVE')
    expect(arg.data.criticality).toBe('MEDIUM')
    expect(arg.data.createdById).toBe('user-1')
    expect(arg.data.ownerId).toBeNull()
  })

  it('auto-incrementa el código a partir del último (CI-042 → CI-043)', async () => {
    ciFindFirst.mockResolvedValueOnce({ code: 'CI-042' })
    ciCreate.mockResolvedValueOnce({ id: 'ci-43', code: 'CI-043' })

    const { createCI } = await import('@/lib/actions/cmdb')
    const out = await createCI({
      name: 'API Gateway',
      type: 'APPLICATION',
      criticality: 'HIGH',
    })

    expect(out.code).toBe('CI-043')
    const arg = ciCreate.mock.calls.at(-1)?.[0] as {
      data: { code: string; type: string; criticality: string }
    }
    expect(arg.data.code).toBe('CI-043')
    expect(arg.data.type).toBe('APPLICATION')
    expect(arg.data.criticality).toBe('HIGH')
  })

  it('lanza [INVALID_INPUT] cuando name está vacío', async () => {
    const { createCI } = await import('@/lib/actions/cmdb')
    await expect(createCI({ name: '   ' })).rejects.toThrow(/\[INVALID_INPUT\]/)
    expect(ciCreate).not.toHaveBeenCalled()
  })

  it('registra audit event ci.created con metadata.workspaceId', async () => {
    ciFindFirst.mockResolvedValueOnce(null)
    ciCreate.mockResolvedValueOnce({ id: 'ci-1', code: 'CI-001' })

    const { createCI } = await import('@/lib/actions/cmdb')
    await createCI({
      name: 'BD Producción',
      type: 'DATABASE',
      criticality: 'CRITICAL',
    })

    expect(recordAuditEventSafe).toHaveBeenCalledTimes(1)
    const event = recordAuditEventSafe.mock.calls[0]?.[0] as {
      action: string
      entityType: string
      entityId: string
      actorId: string
      metadata: { workspaceId: string }
      after: Record<string, unknown>
    }
    expect(event.action).toBe('ci.created')
    expect(event.entityType).toBe('configuration_item')
    expect(event.entityId).toBe('ci-1')
    expect(event.actorId).toBe('user-1')
    expect(event.metadata.workspaceId).toBe('ws-avante')
    expect(event.after.code).toBe('CI-001')
    expect(event.after.name).toBe('BD Producción')
    expect(event.after.criticality).toBe('CRITICAL')
  })
})
