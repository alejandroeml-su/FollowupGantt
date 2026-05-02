import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P1 · Unit tests para `src/lib/actions/notifications.ts`.
 *
 * Estrategia:
 *   - Mockeamos `next/cache` (`unstable_cache`, `revalidateTag`,
 *     `revalidatePath`) inline sin pasar por la cache real.
 *   - Mockeamos `@/lib/prisma` con stubs configurables por test.
 *   - Verificamos contratos: validación zod, resolución de userId,
 *     invalidación de cache, errores tipados.
 */

const unstableCacheCalls: Array<{
  fn: (...args: unknown[]) => unknown
  keyParts: string[]
  options: { tags?: string[] }
}> = []
const revalidateTagCalls: Array<{ tag: string; profile?: unknown }> = []
const revalidatePathCalls: Array<{ path: string }> = []

vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    keyParts: string[],
    options: { tags?: string[] },
  ) => {
    unstableCacheCalls.push({ fn, keyParts, options })
    return fn
  },
  revalidateTag: (tag: string, profile?: unknown) => {
    revalidateTagCalls.push({ tag, profile })
  },
  revalidatePath: (path: string) => {
    revalidatePathCalls.push({ path })
  },
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
  },
}))

import prisma from '@/lib/prisma'

const mock = prisma as unknown as {
  notification: {
    create: ReturnType<typeof vi.fn>
    createMany: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
  notificationPreference: {
    findUnique: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    upsert: ReturnType<typeof vi.fn>
  }
  user: { findFirst: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  unstableCacheCalls.length = 0
  revalidateTagCalls.length = 0
  revalidatePathCalls.length = 0
  vi.clearAllMocks()
})

// Helpers para mocks de filas Prisma.
function rowFixture(over: Partial<{
  id: string
  userId: string
  type: string
  title: string
  body: string | null
  link: string | null
  data: unknown
  readAt: Date | null
  createdAt: Date
}> = {}) {
  return {
    id: over.id ?? 'n1',
    userId: over.userId ?? 'u1',
    type: over.type ?? 'MENTION',
    title: over.title ?? 'Hola te mencionaron',
    body: over.body ?? null,
    link: over.link ?? null,
    data: over.data ?? null,
    readAt: over.readAt ?? null,
    createdAt: over.createdAt ?? new Date('2026-05-01T10:00:00Z'),
  }
}

describe('createNotification', () => {
  it('crea con shape mínimo y serializa fechas', async () => {
    const row = rowFixture({ id: 'abc', userId: 'u1' })
    mock.notification.create.mockResolvedValue(row)

    const { createNotification } = await import('@/lib/actions/notifications')
    const out = await createNotification({
      userId: 'u1',
      type: 'MENTION',
      title: 'Hola te mencionaron',
    })

    expect(out.id).toBe('abc')
    expect(out.userId).toBe('u1')
    expect(typeof out.createdAt).toBe('string')
    expect(out.createdAt).toMatch(/^2026-05-01T10:00:00/)
    expect(mock.notification.create).toHaveBeenCalledOnce()
    expect(revalidateTagCalls).toEqual([
      { tag: 'notifications:u1', profile: 'max' },
    ])
  })

  it('rechaza input inválido con [INVALID_INPUT]', async () => {
    const { createNotification } = await import('@/lib/actions/notifications')
    await expect(
      // @ts-expect-error testing invalid input
      createNotification({ userId: '', type: 'MENTION', title: '' }),
    ).rejects.toThrow(/INVALID_INPUT/)
    expect(mock.notification.create).not.toHaveBeenCalled()
  })

  it('rechaza tipo de notificación desconocido', async () => {
    const { createNotification } = await import('@/lib/actions/notifications')
    await expect(
      // @ts-expect-error invalid enum
      createNotification({ userId: 'u1', type: 'NOPE', title: 'X' }),
    ).rejects.toThrow(/INVALID_INPUT/)
  })
})

describe('createNotificationsBatch', () => {
  it('inserta filas únicas y devuelve count', async () => {
    mock.notification.createMany.mockResolvedValue({ count: 2 })

    const { createNotificationsBatch } = await import('@/lib/actions/notifications')
    const out = await createNotificationsBatch([
      { userId: 'u1', type: 'MENTION', title: 'A' },
      { userId: 'u2', type: 'MENTION', title: 'A' },
      // duplicado de u1+title — debe deduplicarse.
      { userId: 'u1', type: 'MENTION', title: 'A' },
    ])

    expect(out.count).toBe(2)
    expect(mock.notification.createMany).toHaveBeenCalledOnce()
    const arg = mock.notification.createMany.mock.calls[0][0]
    expect(arg.data).toHaveLength(2)
    // Invalida cache de cada destinatario único.
    const tags = revalidateTagCalls.map((c) => c.tag).sort()
    expect(tags).toEqual(['notifications:u1', 'notifications:u2'])
  })

  it('retorna count=0 cuando inputs es vacío', async () => {
    const { createNotificationsBatch } = await import('@/lib/actions/notifications')
    const out = await createNotificationsBatch([])
    expect(out.count).toBe(0)
    expect(mock.notification.createMany).not.toHaveBeenCalled()
  })

  it('descarta inputs inválidos pero mantiene válidos', async () => {
    mock.notification.createMany.mockResolvedValue({ count: 1 })

    const { createNotificationsBatch } = await import('@/lib/actions/notifications')
    const out = await createNotificationsBatch([
      // @ts-expect-error inválido
      { userId: '', type: 'MENTION', title: 'A' },
      { userId: 'u1', type: 'MENTION', title: 'B' },
    ])
    expect(out.count).toBe(1)
    const arg = mock.notification.createMany.mock.calls[0][0]
    expect(arg.data).toHaveLength(1)
    expect(arg.data[0].userId).toBe('u1')
  })
})

describe('getNotificationsForCurrentUser', () => {
  it('lista las últimas 10 con default y serializa', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notification.findMany.mockResolvedValue([
      rowFixture({ id: 'n1', userId: 'edwin' }),
      rowFixture({ id: 'n2', userId: 'edwin', readAt: new Date('2026-05-01T11:00:00Z') }),
    ])

    const { getNotificationsForCurrentUser } = await import('@/lib/actions/notifications')
    const out = await getNotificationsForCurrentUser()

    expect(out).toHaveLength(2)
    expect(out[0].readAt).toBeNull()
    expect(out[1].readAt).toMatch(/^2026-05-01T11:00:00/)
    // Cache wrap.
    expect(unstableCacheCalls).toHaveLength(1)
    expect(unstableCacheCalls[0].keyParts).toEqual([
      'notifications-list',
      'edwin',
      '10',
      'false',
    ])
    expect(unstableCacheCalls[0].options.tags).toEqual(['notifications:edwin'])
  })

  it('respeta unreadOnly=true en la query', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notification.findMany.mockResolvedValue([])

    const { getNotificationsForCurrentUser } = await import('@/lib/actions/notifications')
    await getNotificationsForCurrentUser({ unreadOnly: true })

    const findManyArg = mock.notification.findMany.mock.calls[0][0]
    expect(findManyArg.where).toEqual({ userId: 'edwin', readAt: null })
  })

  it('clamp del limit a [1, 50]', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notification.findMany.mockResolvedValue([])

    const { getNotificationsForCurrentUser } = await import('@/lib/actions/notifications')
    await getNotificationsForCurrentUser({ limit: 999 })
    await getNotificationsForCurrentUser({ limit: -5 })

    const calls = mock.notification.findMany.mock.calls.map((c) => c[0].take)
    expect(calls).toEqual([50, 1])
  })
})

describe('markNotificationRead', () => {
  it('marca como leída y devuelve readAt', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notification.findUnique.mockResolvedValue({
      id: 'n1',
      userId: 'edwin',
      readAt: null,
    })
    mock.notification.update.mockResolvedValue({
      id: 'n1',
      readAt: new Date('2026-05-01T12:00:00Z'),
    })

    const { markNotificationRead } = await import('@/lib/actions/notifications')
    const out = await markNotificationRead('n1')
    expect(out.id).toBe('n1')
    expect(out.readAt).toMatch(/^2026-05-01T12:00:00/)
    expect(revalidateTagCalls.some((c) => c.tag === 'notifications:edwin')).toBe(true)
  })

  it('lanza [NOT_FOUND] si la notificación no existe', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notification.findUnique.mockResolvedValue(null)

    const { markNotificationRead } = await import('@/lib/actions/notifications')
    await expect(markNotificationRead('xxx')).rejects.toThrow(/NOT_FOUND/)
    expect(mock.notification.update).not.toHaveBeenCalled()
  })

  it('lanza [FORBIDDEN] si la notificación pertenece a otro usuario', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notification.findUnique.mockResolvedValue({
      id: 'n1',
      userId: 'otro',
      readAt: null,
    })

    const { markNotificationRead } = await import('@/lib/actions/notifications')
    await expect(markNotificationRead('n1')).rejects.toThrow(/FORBIDDEN/)
    expect(mock.notification.update).not.toHaveBeenCalled()
  })

  it('es idempotente: si ya está leída no hace update', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    const existingReadAt = new Date('2026-05-01T08:00:00Z')
    mock.notification.findUnique.mockResolvedValue({
      id: 'n1',
      userId: 'edwin',
      readAt: existingReadAt,
    })

    const { markNotificationRead } = await import('@/lib/actions/notifications')
    const out = await markNotificationRead('n1')
    expect(out.readAt).toMatch(/^2026-05-01T08:00:00/)
    expect(mock.notification.update).not.toHaveBeenCalled()
  })
})

describe('markAllNotificationsRead', () => {
  it('marca todas las no-leídas y devuelve count', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notification.updateMany.mockResolvedValue({ count: 7 })

    const { markAllNotificationsRead } = await import('@/lib/actions/notifications')
    const out = await markAllNotificationsRead()

    expect(out.count).toBe(7)
    const arg = mock.notification.updateMany.mock.calls[0][0]
    expect(arg.where).toEqual({ userId: 'edwin', readAt: null })
    expect(arg.data.readAt).toBeInstanceOf(Date)
    expect(revalidateTagCalls).toEqual(
      expect.arrayContaining([{ tag: 'notifications:edwin', profile: 'max' }]),
    )
  })

  it('respeta userId explícito (omite fallback)', async () => {
    mock.notification.updateMany.mockResolvedValue({ count: 0 })

    const { markAllNotificationsRead } = await import('@/lib/actions/notifications')
    await markAllNotificationsRead('alice')

    expect(mock.user.findFirst).not.toHaveBeenCalled()
    const arg = mock.notification.updateMany.mock.calls[0][0]
    expect(arg.where.userId).toBe('alice')
  })
})

describe('getUnreadCount', () => {
  it('envuelve count en unstable_cache con tag por usuario', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notification.count.mockResolvedValue(3)

    const { getUnreadCount } = await import('@/lib/actions/notifications')
    const out = await getUnreadCount()

    expect(out).toBe(3)
    expect(unstableCacheCalls.some((c) =>
      c.options.tags?.includes('notifications:edwin'),
    )).toBe(true)
  })
})

describe('updateNotificationPreferences', () => {
  it('upsert con defaults para los toggles no recibidos', async () => {
    mock.notificationPreference.upsert.mockResolvedValue({
      userId: 'u1',
      emailMentions: false,
      emailAssignments: true,
      emailDigest: false,
    })

    const { updateNotificationPreferences } = await import('@/lib/actions/notifications')
    const out = await updateNotificationPreferences({
      userId: 'u1',
      emailMentions: false,
    })

    expect(out.emailMentions).toBe(false)
    const arg = mock.notificationPreference.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ userId: 'u1' })
    expect(arg.create.emailMentions).toBe(false)
    expect(arg.create.emailAssignments).toBe(true)
    expect(arg.update).toEqual({ emailMentions: false })
  })

  it('rechaza si no se especifica ningún toggle', async () => {
    const { updateNotificationPreferences } = await import('@/lib/actions/notifications')
    await expect(
      updateNotificationPreferences({ userId: 'u1' }),
    ).rejects.toThrow(/INVALID_INPUT/)
  })
})

describe('getNotificationPreferences', () => {
  it('devuelve defaults si no hay fila', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notificationPreference.findUnique.mockResolvedValue(null)

    const { getNotificationPreferences } = await import('@/lib/actions/notifications')
    const out = await getNotificationPreferences()

    expect(out).toEqual({
      userId: 'edwin',
      emailMentions: true,
      emailAssignments: true,
      emailDigest: false,
    })
  })

  it('devuelve la fila persistida si existe', async () => {
    mock.user.findFirst.mockResolvedValue({ id: 'edwin' })
    mock.notificationPreference.findUnique.mockResolvedValue({
      userId: 'edwin',
      emailMentions: false,
      emailAssignments: true,
      emailDigest: true,
    })

    const { getNotificationPreferences } = await import('@/lib/actions/notifications')
    const out = await getNotificationPreferences()
    expect(out.emailMentions).toBe(false)
    expect(out.emailDigest).toBe(true)
  })
})

describe('invalidateNotificationsCache', () => {
  it('llama revalidateTag con perfil "max"', async () => {
    const { invalidateNotificationsCache } = await import('@/lib/actions/notifications')
    await invalidateNotificationsCache('u1')
    expect(revalidateTagCalls).toEqual([
      { tag: 'notifications:u1', profile: 'max' },
    ])
  })

  it('no-op cuando userId es null/undefined', async () => {
    const { invalidateNotificationsCache } = await import('@/lib/actions/notifications')
    await invalidateNotificationsCache(null)
    await invalidateNotificationsCache(undefined)
    expect(revalidateTagCalls).toEqual([])
  })
})
