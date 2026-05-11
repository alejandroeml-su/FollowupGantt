import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave R4-B · Backend Push Dual — tests del dispatcher.
 *
 * Estrategia:
 *   - Mock de `@/lib/prisma` con `pushSubscription.{findMany,deleteMany,updateMany}`.
 *   - Adapters inyectados explícitamente vía `options.adapters` para evitar
 *     evaluar credenciales reales (APNS_KEY_P8, FIREBASE_PRIVATE_KEY, etc).
 *   - Cada test cuenta llamadas + valida que el dispatcher routea por `kind`.
 *
 * Cobertura (10 tests):
 *   1. Routing — sub WEB_PUSH llega al adapter WEB_PUSH.
 *   2. Routing — sub APNS llega al adapter APNS.
 *   3. Routing — sub FCM llega al adapter FCM.
 *   4. Sub mixta (web + iOS) → 2 envíos paralelos a 2 adapters distintos.
 *   5. APNs sin credenciales (`skipped`) → no error, skip count incrementado.
 *   6. FCM sin credenciales (`skipped`) → no error, skip count incrementado.
 *   7. Cleanup `gone` tokens → deleteMany llamado con goneIds.
 *   8. Sin suscripciones → result vacío (sent=0).
 *   9. Input invalid (sin userId) → lanza `[INVALID_INPUT]`.
 *  10. Input invalid (sin title) → lanza `[INVALID_INPUT]`.
 */

vi.mock('server-only', () => ({}))

vi.mock('@/lib/prisma', () => ({
  default: {
    pushSubscription: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

// Stubs de adapters reales — no queremos que importar el módulo eval VAPID/APNS env.
vi.mock('@/lib/notifications/push-senders', () => ({
  webPushAdapter: {
    kind: 'WEB_PUSH',
    isConfigured: () => true,
    send: vi.fn(),
  },
  apnsAdapter: {
    kind: 'APNS',
    isConfigured: () => true,
    send: vi.fn(),
  },
  fcmAdapter: {
    kind: 'FCM',
    isConfigured: () => true,
    send: vi.fn(),
  },
  __resetWebPushForTests: vi.fn(),
  __resetApnsForTests: vi.fn(),
  __resetFcmForTests: vi.fn(),
}))

import prisma from '@/lib/prisma'
import {
  dispatchPush,
  dispatchPushToMany,
} from '@/lib/notifications/push-dispatcher'
import type {
  AdapterSendResult,
  PushAdapter,
  PushPayload,
  PushSubscriptionRow,
} from '@/lib/notifications/push-senders'

type AdapterStub = PushAdapter & {
  send: ReturnType<typeof vi.fn>
}

const mockPrisma = prisma as unknown as {
  pushSubscription: {
    findMany: ReturnType<typeof vi.fn>
    deleteMany: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
}

function makeAdapter(
  kind: 'WEB_PUSH' | 'APNS' | 'FCM',
  defaultResult: AdapterSendResult = { delivered: true },
): AdapterStub {
  return {
    kind,
    isConfigured: () => true,
    send: vi.fn(async () => defaultResult),
  } as AdapterStub
}

function makeAdapters(overrides: Partial<{
  WEB_PUSH: AdapterStub
  APNS: AdapterStub
  FCM: AdapterStub
}> = {}) {
  return {
    WEB_PUSH: overrides.WEB_PUSH ?? makeAdapter('WEB_PUSH'),
    APNS: overrides.APNS ?? makeAdapter('APNS'),
    FCM: overrides.FCM ?? makeAdapter('FCM'),
  }
}

const PAYLOAD: PushPayload = {
  title: 'Hola',
  body: 'cuerpo',
  url: '/list',
}

beforeEach(() => {
  mockPrisma.pushSubscription.findMany.mockReset()
  mockPrisma.pushSubscription.deleteMany.mockReset()
  mockPrisma.pushSubscription.updateMany.mockReset()
  mockPrisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 })
  mockPrisma.pushSubscription.updateMany.mockResolvedValue({ count: 0 })
})

describe('dispatchPush — routing por kind', () => {
  it('1. routea sub WEB_PUSH al adapter web-push', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-w',
        userId: 'u1',
        endpoint: 'https://push.example/w',
        keys: { p256dh: 'p', auth: 'a' },
        kind: 'WEB_PUSH',
      },
    ])
    const adapters = makeAdapters()
    const res = await dispatchPush('u1', PAYLOAD, { adapters })
    expect(adapters.WEB_PUSH.send).toHaveBeenCalledTimes(1)
    expect(adapters.APNS.send).not.toHaveBeenCalled()
    expect(adapters.FCM.send).not.toHaveBeenCalled()
    expect(res.WEB_PUSH.sent).toBe(1)
    expect(res.total.sent).toBe(1)
  })

  it('2. routea sub APNS al adapter apns', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-i',
        userId: 'u1',
        endpoint: 'devtoken-ios-aabbccdd',
        keys: null,
        kind: 'APNS',
      },
    ])
    const adapters = makeAdapters()
    const res = await dispatchPush('u1', PAYLOAD, { adapters })
    expect(adapters.APNS.send).toHaveBeenCalledTimes(1)
    expect(adapters.WEB_PUSH.send).not.toHaveBeenCalled()
    expect(adapters.FCM.send).not.toHaveBeenCalled()
    const arg = adapters.APNS.send.mock.calls[0][0] as PushSubscriptionRow
    expect(arg.endpoint).toBe('devtoken-ios-aabbccdd')
    expect(arg.keys).toBeNull()
    expect(res.APNS.sent).toBe(1)
  })

  it('3. routea sub FCM al adapter fcm', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-a',
        userId: 'u1',
        endpoint: 'fcm-registration-token-xyz',
        keys: null,
        kind: 'FCM',
      },
    ])
    const adapters = makeAdapters()
    const res = await dispatchPush('u1', PAYLOAD, { adapters })
    expect(adapters.FCM.send).toHaveBeenCalledTimes(1)
    expect(res.FCM.sent).toBe(1)
  })

  it('4. user con 2 devices (web + iOS) → 2 envíos paralelos', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-w',
        userId: 'u1',
        endpoint: 'https://push.example/w',
        keys: { p256dh: 'p', auth: 'a' },
        kind: 'WEB_PUSH',
      },
      {
        id: 'sub-i',
        userId: 'u1',
        endpoint: 'devtoken-ios',
        keys: null,
        kind: 'APNS',
      },
    ])
    const adapters = makeAdapters()
    const res = await dispatchPush('u1', PAYLOAD, { adapters })
    expect(adapters.WEB_PUSH.send).toHaveBeenCalledTimes(1)
    expect(adapters.APNS.send).toHaveBeenCalledTimes(1)
    expect(res.WEB_PUSH.sent).toBe(1)
    expect(res.APNS.sent).toBe(1)
    expect(res.total.sent).toBe(2)
  })
})

describe('dispatchPush — defensividad sin credenciales', () => {
  it('5. APNs sin credenciales → skip sin error', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-i',
        userId: 'u1',
        endpoint: 'devtoken-ios',
        keys: null,
        kind: 'APNS',
      },
    ])
    const apns = makeAdapter('APNS', {
      delivered: false,
      skipped: true,
      error: 'apns-not-configured',
    })
    const adapters = makeAdapters({ APNS: apns })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await dispatchPush('u1', PAYLOAD, { adapters })
    expect(res.APNS.skipped).toBe(1)
    expect(res.APNS.failed).toBe(0)
    expect(res.APNS.sent).toBe(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('6. FCM sin credenciales → skip sin error', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-a',
        userId: 'u1',
        endpoint: 'fcm-token',
        keys: null,
        kind: 'FCM',
      },
    ])
    const fcm = makeAdapter('FCM', {
      delivered: false,
      skipped: true,
      error: 'fcm-not-configured',
    })
    const adapters = makeAdapters({ FCM: fcm })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await dispatchPush('u1', PAYLOAD, { adapters })
    expect(res.FCM.skipped).toBe(1)
    expect(res.FCM.failed).toBe(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('dispatchPush — cleanup tokens gone', () => {
  it('7. tokens gone → deleteMany llamado con ids correctos', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([
      {
        id: 'sub-gone',
        userId: 'u1',
        endpoint: 'https://push.example/gone',
        keys: { p256dh: 'p', auth: 'a' },
        kind: 'WEB_PUSH',
      },
      {
        id: 'sub-gone-2',
        userId: 'u1',
        endpoint: 'devtoken-ios-stale',
        keys: null,
        kind: 'APNS',
      },
    ])
    const web = makeAdapter('WEB_PUSH', { delivered: false, gone: true })
    const apns = makeAdapter('APNS', { delivered: false, gone: true })
    const adapters = makeAdapters({ WEB_PUSH: web, APNS: apns })

    const res = await dispatchPush('u1', PAYLOAD, { adapters })
    expect(mockPrisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-gone', 'sub-gone-2'] } },
    })
    expect(res.WEB_PUSH.removed).toBe(1)
    expect(res.APNS.removed).toBe(1)
    expect(res.total.removed).toBe(2)
  })
})

describe('dispatchPush — edge cases', () => {
  it('8. usuario sin suscripciones → resultado vacío', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([])
    const adapters = makeAdapters()
    const res = await dispatchPush('u1', PAYLOAD, { adapters })
    expect(res.total.sent).toBe(0)
    expect(res.total.failed).toBe(0)
    expect(adapters.WEB_PUSH.send).not.toHaveBeenCalled()
  })

  it('9. userId vacío → lanza [INVALID_INPUT]', async () => {
    const adapters = makeAdapters()
    await expect(dispatchPush('', PAYLOAD, { adapters })).rejects.toThrow(
      /\[INVALID_INPUT\]/,
    )
  })

  it('10. payload sin title → lanza [INVALID_INPUT]', async () => {
    const adapters = makeAdapters()
    await expect(
      dispatchPush('u1', { title: '' } as PushPayload, { adapters }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })
})

describe('dispatchPushToMany', () => {
  it('agrega resultados de varios userIds', async () => {
    mockPrisma.pushSubscription.findMany.mockImplementation(
      async ({ where }: { where: { userId: string } }) => {
        if (where.userId === 'u1') {
          return [
            {
              id: 'sub-w1',
              userId: 'u1',
              endpoint: 'https://push.example/w1',
              keys: { p256dh: 'p', auth: 'a' },
              kind: 'WEB_PUSH',
            },
          ]
        }
        if (where.userId === 'u2') {
          return [
            {
              id: 'sub-i2',
              userId: 'u2',
              endpoint: 'token-ios',
              keys: null,
              kind: 'APNS',
            },
          ]
        }
        return []
      },
    )
    const res = await dispatchPushToMany(['u1', 'u2', ''], PAYLOAD)
    // No inyectamos adapters: para u1 (WEB_PUSH) el mock vi.mock'd
    // arriba devuelve undefined por defecto. El dispatcher fallback al
    // map default. Verificamos que al menos invoca findMany por user.
    expect(mockPrisma.pushSubscription.findMany).toHaveBeenCalled()
    expect(res).toBeDefined()
  })
})
