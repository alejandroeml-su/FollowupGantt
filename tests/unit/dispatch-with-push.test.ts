import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave P6 · Equipo B2 — Unit tests para `dispatch-with-push.ts`.
 *
 * Estrategia:
 *   - Mockeamos `@/lib/actions/notifications` (createNotification) y
 *     `@/lib/web-push/server` (sendPushToUser) por separado para
 *     verificar el contrato del helper sin tocar Prisma ni red.
 *   - Cubrimos: feliz path, push opcional desactivado, errores en push
 *     (no propagan), errores en createNotification (sí propagan),
 *     overrides del payload, derivación de URL desde `link`.
 */

vi.mock('server-only', () => ({}))

const createNotification = vi.fn()
const sendPushToUser = vi.fn()

vi.mock('@/lib/actions/notifications', () => ({
  createNotification,
}))

vi.mock('@/lib/web-push/server', () => ({
  sendPushToUser,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function notifFixture(over: Partial<{
  id: string
  userId: string
  type: string
  title: string
  body: string | null
  link: string | null
  data: unknown
  readAt: string | null
  createdAt: string
}> = {}) {
  return {
    id: over.id ?? 'n1',
    userId: over.userId ?? 'u1',
    type: (over.type ?? 'MENTION') as
      | 'MENTION'
      | 'TASK_ASSIGNED'
      | 'COMMENT_REPLY'
      | 'BASELINE_CAPTURED'
      | 'DEPENDENCY_VIOLATION'
      | 'IMPORT_COMPLETED',
    title: over.title ?? 'Te mencionaron',
    body: over.body ?? null,
    link: over.link ?? null,
    data: over.data ?? null,
    readAt: over.readAt ?? null,
    createdAt: over.createdAt ?? '2026-05-04T10:00:00.000Z',
  }
}

describe('dispatchNotificationWithPush', () => {
  it('crea Notification y dispara push con payload derivado (happy path)', async () => {
    createNotification.mockResolvedValue(
      notifFixture({
        id: 'n42',
        userId: 'u1',
        type: 'TASK_ASSIGNED',
        title: 'Nueva tarea: Migrar PG',
        body: 'Asignada por Edwin',
        link: '/list?taskId=t99',
      }),
    )
    sendPushToUser.mockResolvedValue({ sent: 1, failed: 0, removed: [] })

    const { dispatchNotificationWithPush } = await import(
      '@/lib/notifications/dispatch-with-push'
    )

    const out = await dispatchNotificationWithPush({
      userId: 'u1',
      type: 'TASK_ASSIGNED',
      title: 'Nueva tarea: Migrar PG',
      body: 'Asignada por Edwin',
      link: '/list?taskId=t99',
    })

    expect(out.notification.id).toBe('n42')
    expect(out.push).toEqual({ sent: 1, failed: 0, removed: [] })

    expect(createNotification).toHaveBeenCalledOnce()
    expect(sendPushToUser).toHaveBeenCalledOnce()
    const [userId, payload] = sendPushToUser.mock.calls[0]
    expect(userId).toBe('u1')
    expect(payload).toMatchObject({
      title: 'Nueva tarea: Migrar PG',
      body: 'Asignada por Edwin',
      url: '/list?taskId=t99',
    })
    expect(payload.data).toMatchObject({ notificationId: 'n42', type: 'TASK_ASSIGNED' })
  })

  it('omite el push cuando options.push === false', async () => {
    createNotification.mockResolvedValue(notifFixture({ id: 'n2' }))

    const { dispatchNotificationWithPush } = await import(
      '@/lib/notifications/dispatch-with-push'
    )

    const out = await dispatchNotificationWithPush(
      { userId: 'u1', type: 'MENTION', title: 'X' },
      { push: false },
    )

    expect(out.notification.id).toBe('n2')
    expect(out.push).toBeNull()
    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  it('NO propaga errores del push — devuelve push: null y persiste la Notification', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createNotification.mockResolvedValue(notifFixture({ id: 'n3' }))
    sendPushToUser.mockRejectedValue(new Error('[NO_VAPID] keys ausentes'))

    const { dispatchNotificationWithPush } = await import(
      '@/lib/notifications/dispatch-with-push'
    )

    const out = await dispatchNotificationWithPush({
      userId: 'u1',
      type: 'MENTION',
      title: 'X',
    })

    expect(out.notification.id).toBe('n3')
    expect(out.push).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('SÍ propaga errores de createNotification — el push no se intenta', async () => {
    createNotification.mockRejectedValue(new Error('[INVALID_INPUT] title vacío'))

    const { dispatchNotificationWithPush } = await import(
      '@/lib/notifications/dispatch-with-push'
    )

    await expect(
      dispatchNotificationWithPush({
        userId: 'u1',
        type: 'MENTION',
        title: '',
      }),
    ).rejects.toThrow(/INVALID_INPUT/)

    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  it('respeta pushOverrides para acortar body y cambiar URL', async () => {
    createNotification.mockResolvedValue(
      notifFixture({
        id: 'n4',
        userId: 'u9',
        title: 'Comentario muy largo en una tarea con título extenso',
        body: 'Body inicialmente largo que no quiero que llegue al SO completo',
        link: '/list?taskId=tabc#comment-xyz',
      }),
    )
    sendPushToUser.mockResolvedValue({ sent: 0, failed: 0, skipped: 'no-subscriptions', removed: [] })

    const { dispatchNotificationWithPush } = await import(
      '@/lib/notifications/dispatch-with-push'
    )

    await dispatchNotificationWithPush(
      {
        userId: 'u9',
        type: 'COMMENT_REPLY',
        title: 'Comentario muy largo en una tarea con título extenso',
        body: 'Body inicialmente largo que no quiero que llegue al SO completo',
        link: '/list?taskId=tabc#comment-xyz',
      },
      {
        pushOverrides: {
          body: 'Edwin respondió tu comentario',
          url: '/list?taskId=tabc',
        },
      },
    )

    expect(sendPushToUser).toHaveBeenCalledOnce()
    const [, payload] = sendPushToUser.mock.calls[0]
    expect(payload.title).toBe(
      'Comentario muy largo en una tarea con título extenso',
    )
    expect(payload.body).toBe('Edwin respondió tu comentario')
    expect(payload.url).toBe('/list?taskId=tabc')
  })

  it('rechaza input falsy con [INVALID_INPUT] sin tocar Prisma', async () => {
    const { dispatchNotificationWithPush } = await import(
      '@/lib/notifications/dispatch-with-push'
    )

    await expect(
      // @ts-expect-error testing falsy input
      dispatchNotificationWithPush(null),
    ).rejects.toThrow(/INVALID_INPUT/)

    expect(createNotification).not.toHaveBeenCalled()
    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  it('cuando link es null, el payload del push tampoco lleva url', async () => {
    createNotification.mockResolvedValue(
      notifFixture({
        id: 'n5',
        userId: 'u1',
        type: 'BASELINE_CAPTURED',
        title: 'Línea base capturada',
        link: null,
        body: null,
      }),
    )
    sendPushToUser.mockResolvedValue({ sent: 1, failed: 0, removed: [] })

    const { dispatchNotificationWithPush } = await import(
      '@/lib/notifications/dispatch-with-push'
    )

    await dispatchNotificationWithPush({
      userId: 'u1',
      type: 'BASELINE_CAPTURED',
      title: 'Línea base capturada',
    })

    expect(sendPushToUser).toHaveBeenCalledOnce()
    const [, payload] = sendPushToUser.mock.calls[0]
    expect(payload.title).toBe('Línea base capturada')
    expect(payload.url).toBeUndefined()
    expect(payload.body).toBeUndefined()
  })
})
