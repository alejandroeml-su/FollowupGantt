import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Wave P6 · Equipo A4 — Tests para `src/lib/web-push/server.ts`.
 *
 * Estrategia:
 *   - Mock de `web-push`: stub de `setVapidDetails` y `sendNotification`.
 *   - Mock de `@/lib/prisma` con `pushSubscription.{findMany,deleteMany,
 *     updateMany}`.
 *   - Reset de env vars VAPID + helper `__resetVapidForTests` antes de
 *     cada test para aislar `ensureVapidConfigured` cache.
 */

vi.mock('server-only', () => ({}))

const { sendNotificationMock, setVapidDetailsMock, generateVAPIDKeysMock } =
  vi.hoisted(() => ({
    sendNotificationMock: vi.fn(),
    setVapidDetailsMock: vi.fn(),
    generateVAPIDKeysMock: vi.fn(() => ({
      publicKey: 'pub',
      privateKey: 'priv',
    })),
  }))

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
    generateVAPIDKeys: generateVAPIDKeysMock,
  },
  setVapidDetails: setVapidDetailsMock,
  sendNotification: sendNotificationMock,
  generateVAPIDKeys: generateVAPIDKeysMock,
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    pushSubscription: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

import prisma from '@/lib/prisma'
import {
  __resetVapidForTests,
  ensureVapidConfigured,
  getPublicVapidKey,
  sendPushToMany,
  sendPushToUser,
} from '@/lib/web-push/server'

const mockPrisma = prisma as unknown as {
  pushSubscription: {
    findMany: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
}

const SUB_OK = {
  id: 'sub-1',
  endpoint: 'https://push.example/sub-1',
  keys: { p256dh: 'p1', auth: 'a1' },
}
const SUB_GONE = {
  id: 'sub-2',
  endpoint: 'https://push.example/sub-2',
  keys: { p256dh: 'p2', auth: 'a2' },
}

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  __resetVapidForTests()
  sendNotificationMock.mockReset()
  setVapidDetailsMock.mockReset()
  mockPrisma.pushSubscription.findMany.mockReset()
  mockPrisma.pushSubscription.deleteMany.mockReset()
  mockPrisma.pushSubscription.updateMany.mockReset()
  mockPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.pushSubscription.updateMany.mockResolvedValue({ count: 0 })
  process.env = { ...ORIGINAL_ENV }
  process.env.VAPID_PUBLIC_KEY = 'BPub_test_key'
  process.env.VAPID_PRIVATE_KEY = 'priv_test_key'
  process.env.WEB_PUSH_SUBJECT = 'mailto:test@example.com'
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'BPub_test_key'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('ensureVapidConfigured', () => {
  it('configura una sola vez con env vars válidas', () => {
    expect(ensureVapidConfigured()).toBe(true)
    expect(ensureVapidConfigured()).toBe(true)
    expect(setVapidDetailsMock).toHaveBeenCalledTimes(1)
    expect(setVapidDetailsMock).toHaveBeenCalledWith(
      'mailto:test@example.com',
      'BPub_test_key',
      'priv_test_key',
    )
  })

  it('devuelve false cuando faltan env vars', () => {
    delete process.env.VAPID_PUBLIC_KEY
    __resetVapidForTests()
    expect(ensureVapidConfigured()).toBe(false)
    expect(setVapidDetailsMock).not.toHaveBeenCalled()
  })

  it('usa subject por defecto si WEB_PUSH_SUBJECT no se define', () => {
    delete process.env.WEB_PUSH_SUBJECT
    __resetVapidForTests()
    expect(ensureVapidConfigured()).toBe(true)
    expect(setVapidDetailsMock).toHaveBeenCalledWith(
      'mailto:notifications@complejoavante.com',
      'BPub_test_key',
      'priv_test_key',
    )
  })
})

describe('getPublicVapidKey', () => {
  it('devuelve NEXT_PUBLIC_VAPID_PUBLIC_KEY si existe', () => {
    expect(getPublicVapidKey()).toBe('BPub_test_key')
  })

  it('cae a VAPID_PUBLIC_KEY como fallback', () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    expect(getPublicVapidKey()).toBe('BPub_test_key')
  })

  it('devuelve string vacío si no hay nada configurado', () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    delete process.env.VAPID_PUBLIC_KEY
    expect(getPublicVapidKey()).toBe('')
  })
})

describe('sendPushToUser', () => {
  it('rechaza userId vacío con [INVALID_INPUT]', async () => {
    await expect(
      sendPushToUser('', { title: 't' }),
    ).rejects.toThrow(/INVALID_INPUT/)
  })

  it('rechaza payload sin title con [INVALID_INPUT]', async () => {
    // @ts-expect-error testing invalid input
    await expect(sendPushToUser('u1', {})).rejects.toThrow(/INVALID_INPUT/)
  })

  it('skipped=no-vapid cuando faltan keys VAPID', async () => {
    delete process.env.VAPID_PRIVATE_KEY
    __resetVapidForTests()
    const result = await sendPushToUser('u1', { title: 'hi' })
    expect(result).toEqual({
      sent: 0,
      failed: 0,
      skipped: 'no-vapid',
      removed: [],
    })
    expect(mockPrisma.pushSubscription.findMany).not.toHaveBeenCalled()
  })

  it('skipped=no-subscriptions cuando el usuario no tiene subs', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([])
    const result = await sendPushToUser('u1', { title: 'hi' })
    expect(result).toEqual({
      sent: 0,
      failed: 0,
      skipped: 'no-subscriptions',
      removed: [],
    })
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('envía al endpoint y marca lastUsedAt cuando OK', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([SUB_OK])
    sendNotificationMock.mockResolvedValue({ statusCode: 201 })
    const result = await sendPushToUser('u1', {
      title: 'Hola',
      body: 'mundo',
      url: '/foo',
    })
    expect(result.sent).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.removed).toEqual([])
    expect(sendNotificationMock).toHaveBeenCalledWith(
      { endpoint: SUB_OK.endpoint, keys: SUB_OK.keys },
      JSON.stringify({ title: 'Hola', body: 'mundo', url: '/foo' }),
    )
    expect(mockPrisma.pushSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-1'] } },
      data: { lastUsedAt: expect.any(Date) },
    })
  })

  it('borra suscripción cuando push service responde 410', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([SUB_OK, SUB_GONE])
    sendNotificationMock.mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint === SUB_GONE.endpoint) {
        const err = new Error('Gone') as Error & { statusCode: number }
        err.statusCode = 410
        return Promise.reject(err)
      }
      return Promise.resolve({ statusCode: 201 })
    })
    mockPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 })

    const result = await sendPushToUser('u1', { title: 'x' })
    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.removed).toEqual([SUB_GONE.endpoint])
    expect(mockPrisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-2'] } },
    })
  })

  it('NO borra cuando el error es transitorio (statusCode != 404/410)', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([SUB_OK])
    const err = new Error('Server unavailable') as Error & { statusCode: number }
    err.statusCode = 503
    sendNotificationMock.mockRejectedValue(err)
    const result = await sendPushToUser('u1', { title: 'x' })
    expect(result.sent).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.removed).toEqual([])
    expect(mockPrisma.pushSubscription.deleteMany).not.toHaveBeenCalled()
  })

  it('borra al recibir 404 (endpoint inexistente)', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([SUB_OK])
    const err = new Error('Not Found') as Error & { statusCode: number }
    err.statusCode = 404
    sendNotificationMock.mockRejectedValue(err)
    mockPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 })
    const result = await sendPushToUser('u1', { title: 'x' })
    expect(result.sent).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.removed).toEqual([SUB_OK.endpoint])
  })
})

describe('sendPushToMany', () => {
  it('devuelve skipped cuando la lista está vacía', async () => {
    const result = await sendPushToMany([], { title: 't' })
    expect(result.skipped).toBe('no-subscriptions')
    expect(mockPrisma.pushSubscription.findMany).not.toHaveBeenCalled()
  })

  it('deduplica userIds y agrega resultados', async () => {
    mockPrisma.pushSubscription.findMany.mockImplementation(({ where }) => {
      if (where.userId === 'u1') return Promise.resolve([SUB_OK])
      if (where.userId === 'u2') return Promise.resolve([SUB_GONE])
      return Promise.resolve([])
    })
    sendNotificationMock.mockImplementation((sub: { endpoint: string }) => {
      if (sub.endpoint === SUB_GONE.endpoint) {
        const err = new Error('Gone') as Error & { statusCode: number }
        err.statusCode = 410
        return Promise.reject(err)
      }
      return Promise.resolve({ statusCode: 201 })
    })
    mockPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 })

    const result = await sendPushToMany(['u1', 'u2', 'u1'], { title: 'x' })
    expect(result.sent).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.removed).toEqual([SUB_GONE.endpoint])
    // u1 una sola vez (dedup):
    expect(mockPrisma.pushSubscription.findMany).toHaveBeenCalledTimes(2)
  })
})
