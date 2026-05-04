import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P3 · Equipo P3-2 · Tests del helper `recordAuditEvent`.
 *
 * Mockeamos `@/lib/prisma` para no tocar BD. `Prisma.JsonNull` se importa
 * real desde `@prisma/client` (no requiere instanciar PrismaClient).
 */

// ─────────────────────────── Mocks ───────────────────────────

const auditCreate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    auditEvent: {
      create: (...args: unknown[]) => auditCreate(...args),
    },
  },
}))

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  auditCreate.mockReset()
  auditCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'audit-1',
    createdAt: new Date('2026-05-03T12:00:00.000Z'),
    ...data,
  }))
})

// ─────────────────────────── Tests ───────────────────────────

describe('recordAuditEvent', () => {
  it('persiste un evento básico con action y entityType', async () => {
    const { recordAuditEvent } = await import('@/lib/audit/events')
    const out = await recordAuditEvent({
      actorId: 'user-1',
      action: 'task.created',
      entityType: 'task',
      entityId: 'task-1',
    })
    expect(out.id).toBe('audit-1')
    expect(out.createdAt).toBe('2026-05-03T12:00:00.000Z')

    const callArg = auditCreate.mock.calls.at(-1)?.[0] as {
      data: { action: string; entityType: string; entityId: string; actorId: string }
    }
    expect(callArg.data.action).toBe('task.created')
    expect(callArg.data.entityType).toBe('task')
    expect(callArg.data.entityId).toBe('task-1')
    expect(callArg.data.actorId).toBe('user-1')
  })

  it('rechaza action fuera del catálogo como [INVALID_INPUT]', async () => {
    const { recordAuditEvent } = await import('@/lib/audit/events')
    await expect(
      recordAuditEvent({
        // @ts-expect-error: probamos action inválido a propósito
        action: 'task.exploded',
        entityType: 'task',
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza entityType vacío como [INVALID_INPUT]', async () => {
    const { recordAuditEvent } = await import('@/lib/audit/events')
    await expect(
      recordAuditEvent({
        action: 'task.created',
        entityType: '',
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('acepta evento sin actor (system event)', async () => {
    const { recordAuditEvent } = await import('@/lib/audit/events')
    await recordAuditEvent({
      action: 'import.completed',
      entityType: 'import',
      entityId: 'imp-1',
    })
    const callArg = auditCreate.mock.calls.at(-1)?.[0] as {
      data: { actorId: string | null }
    }
    expect(callArg.data.actorId).toBeNull()
  })

  it('redacta claves sensibles en before/after', async () => {
    const { recordAuditEvent } = await import('@/lib/audit/events')
    await recordAuditEvent({
      actorId: 'user-1',
      action: 'user.password_changed',
      entityType: 'user',
      entityId: 'user-1',
      before: { password: 'old-secret', email: 'a@b.com' },
      after: { password: 'new-secret', email: 'a@b.com' },
    })
    const callArg = auditCreate.mock.calls.at(-1)?.[0] as {
      data: {
        before: { password: string; email: string }
        after: { password: string; email: string }
      }
    }
    expect(callArg.data.before.password).toBe('[REDACTED]')
    expect(callArg.data.before.email).toBe('a@b.com')
    expect(callArg.data.after.password).toBe('[REDACTED]')
  })

  it('redacta claves sensibles anidadas recursivamente', async () => {
    const { recordAuditEvent } = await import('@/lib/audit/events')
    await recordAuditEvent({
      action: 'user.login',
      entityType: 'session',
      after: {
        user: { email: 'a@b.com', token: 'jwt-secret' },
        nested: [{ apiKey: 'abc-123' }],
      },
    })
    const callArg = auditCreate.mock.calls.at(-1)?.[0] as {
      data: {
        after: {
          user: { token: string }
          nested: Array<{ apiKey: string }>
        }
      }
    }
    expect(callArg.data.after.user.token).toBe('[REDACTED]')
    expect(callArg.data.after.nested[0]?.apiKey).toBe('[REDACTED]')
  })

  it('captura ipAddress y userAgent', async () => {
    const { recordAuditEvent } = await import('@/lib/audit/events')
    await recordAuditEvent({
      action: 'user.login',
      entityType: 'session',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    })
    const callArg = auditCreate.mock.calls.at(-1)?.[0] as {
      data: { ipAddress: string; userAgent: string }
    }
    expect(callArg.data.ipAddress).toBe('192.168.1.1')
    expect(callArg.data.userAgent).toBe('Mozilla/5.0')
  })

  it('lanza [PERSIST_FAILED] si Prisma rechaza', async () => {
    auditCreate.mockRejectedValueOnce(new Error('FK constraint'))
    const { recordAuditEvent } = await import('@/lib/audit/events')
    await expect(
      recordAuditEvent({
        action: 'task.created',
        entityType: 'task',
        entityId: 't1',
      }),
    ).rejects.toThrow(/\[PERSIST_FAILED\]/)
  })
})

describe('recordAuditEventSafe', () => {
  it('no lanza ante errores de persistencia', async () => {
    auditCreate.mockRejectedValueOnce(new Error('boom'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { recordAuditEventSafe } = await import('@/lib/audit/events')
    await expect(
      recordAuditEventSafe({
        action: 'task.created',
        entityType: 'task',
        entityId: 't1',
      }),
    ).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('persiste correctamente cuando no hay error', async () => {
    const { recordAuditEventSafe } = await import('@/lib/audit/events')
    await recordAuditEventSafe({
      action: 'task.deleted',
      entityType: 'task',
      entityId: 't9',
    })
    expect(auditCreate).toHaveBeenCalledOnce()
  })
})

describe('redactSensitive', () => {
  it('preserva primitivos y null', async () => {
    const { redactSensitive } = await import('@/lib/audit/types')
    expect(redactSensitive(null)).toBeNull()
    expect(redactSensitive(undefined)).toBeUndefined()
    expect(redactSensitive(42)).toBe(42)
    expect(redactSensitive('hello')).toBe('hello')
    expect(redactSensitive(true)).toBe(true)
  })

  it('redacta password y token a primer nivel', async () => {
    const { redactSensitive } = await import('@/lib/audit/types')
    const out = redactSensitive({
      name: 'Edwin',
      password: 'secret',
      token: 'jwt',
    })
    expect(out).toEqual({
      name: 'Edwin',
      password: '[REDACTED]',
      token: '[REDACTED]',
    })
  })

  it('redacta dentro de arrays', async () => {
    const { redactSensitive } = await import('@/lib/audit/types')
    const out = redactSensitive([
      { secret: 'a', other: 1 },
      { secret: 'b', other: 2 },
    ])
    expect(out).toEqual([
      { secret: '[REDACTED]', other: 1 },
      { secret: '[REDACTED]', other: 2 },
    ])
  })
})
