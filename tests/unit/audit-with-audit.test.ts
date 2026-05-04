import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P3 · Equipo P3-2 · Tests del wrapper `withAudit`.
 *
 * Mockeamos `events.ts` para inspeccionar qué se persiste sin pasar por
 * Prisma. El SUT solo orquesta orden y propagación de errores.
 */

// ─────────────────────────── Mocks ───────────────────────────

const recordSafe = vi.fn()
const recordStrict = vi.fn()

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...args: unknown[]) => recordSafe(...args),
  recordAuditEvent: (...args: unknown[]) => recordStrict(...args),
}))

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  recordSafe.mockReset()
  recordSafe.mockResolvedValue(undefined)
  recordStrict.mockReset()
  recordStrict.mockResolvedValue({
    id: 'audit-1',
    createdAt: '2026-05-03T12:00:00.000Z',
  })
})

// ─────────────────────────── Tests ───────────────────────────

describe('withAudit', () => {
  it('ejecuta la action original y devuelve su resultado', async () => {
    const { withAudit } = await import('@/lib/audit/with-audit')
    const original = vi.fn(async (x: number) => x * 2)
    const wrapped = withAudit(original, {
      action: 'task.created',
      entityType: 'task',
      entityId: 't1',
    })
    const result = await wrapped(21)
    expect(result).toBe(42)
    expect(original).toHaveBeenCalledWith(21)
  })

  it('persiste audit con descriptor estático tras éxito', async () => {
    const { withAudit } = await import('@/lib/audit/with-audit')
    const wrapped = withAudit(async () => ({ ok: true }), {
      action: 'task.created',
      entityType: 'task',
      entityId: 't1',
    })
    await wrapped()
    expect(recordSafe).toHaveBeenCalledOnce()
    const arg = recordSafe.mock.calls[0]?.[0] as { action: string; entityId: string }
    expect(arg.action).toBe('task.created')
    expect(arg.entityId).toBe('t1')
  })

  it('persiste audit con descriptor function (deriva del result)', async () => {
    const { withAudit } = await import('@/lib/audit/with-audit')
    type R = { id: string; status: string }
    const wrapped = withAudit<[string], R>(
      async (id) => ({ id, status: 'IN_PROGRESS' }),
      (args, result) => ({
        action: 'task.status_changed',
        entityType: 'task',
        entityId: result.id,
        after: { status: result.status },
        metadata: { argsCount: args.length },
      }),
    )
    await wrapped('task-99')
    const arg = recordSafe.mock.calls[0]?.[0] as {
      action: string
      entityId: string
      after: { status: string }
      metadata: { argsCount: number }
    }
    expect(arg.action).toBe('task.status_changed')
    expect(arg.entityId).toBe('task-99')
    expect(arg.after.status).toBe('IN_PROGRESS')
    expect(arg.metadata.argsCount).toBe(1)
  })

  it('NO persiste audit si la action lanza', async () => {
    const { withAudit } = await import('@/lib/audit/with-audit')
    const wrapped = withAudit(
      async () => {
        throw new Error('boom')
      },
      { action: 'task.deleted', entityType: 'task', entityId: 't1' },
    )
    await expect(wrapped()).rejects.toThrow('boom')
    expect(recordSafe).not.toHaveBeenCalled()
  })

  it('si descriptor function lanza, no rompe la action principal', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { withAudit } = await import('@/lib/audit/with-audit')
    const wrapped = withAudit(
      async () => 'result',
      () => {
        throw new Error('descriptor boom')
      },
    )
    const result = await wrapped()
    expect(result).toBe('result')
    expect(recordSafe).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('preserva múltiples argumentos y tipos', async () => {
    const { withAudit } = await import('@/lib/audit/with-audit')
    const original = vi.fn(async (a: string, b: number, c: boolean) => `${a}-${b}-${c}`)
    const wrapped = withAudit(original, (args) => ({
      action: 'task.updated',
      entityType: 'task',
      entityId: args[0],
    }))
    const result = await wrapped('id-1', 7, true)
    expect(result).toBe('id-1-7-true')
    expect(original).toHaveBeenCalledWith('id-1', 7, true)
  })
})

describe('withAuditTraced', () => {
  it('devuelve result + auditId tras éxito', async () => {
    const { withAuditTraced } = await import('@/lib/audit/with-audit')
    const wrapped = withAuditTraced(async () => ({ ok: true }), {
      action: 'baseline.captured',
      entityType: 'baseline',
      entityId: 'b1',
    })
    const out = await wrapped()
    expect(out.result).toEqual({ ok: true })
    expect(out.auditId).toBe('audit-1')
    expect(recordStrict).toHaveBeenCalledOnce()
  })

  it('devuelve auditId null si recordAuditEvent falla', async () => {
    recordStrict.mockRejectedValueOnce(new Error('persist boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { withAuditTraced } = await import('@/lib/audit/with-audit')
    const wrapped = withAuditTraced(async () => 42, {
      action: 'baseline.captured',
      entityType: 'baseline',
      entityId: 'b1',
    })
    const out = await wrapped()
    expect(out.result).toBe(42)
    expect(out.auditId).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('NO audita si la action lanza', async () => {
    const { withAuditTraced } = await import('@/lib/audit/with-audit')
    const wrapped = withAuditTraced(
      async () => {
        throw new Error('boom')
      },
      { action: 'baseline.captured', entityType: 'baseline', entityId: 'b1' },
    )
    await expect(wrapped()).rejects.toThrow('boom')
    expect(recordStrict).not.toHaveBeenCalled()
  })
})
