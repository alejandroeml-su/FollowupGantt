import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Ola P4 · Equipo P4-2 — tests del dispatcher de webhooks.
 *
 * Estrategia:
 *   - Mockeamos `prisma.webhook.findMany/update` y el `fetch` global.
 *   - Verificamos que el dispatcher (1) filtra por evento, (2) firma con HMAC,
 *     (3) envía body JSON con `event/timestamp/data`, (4) actualiza stats
 *     post-delivery, (5) silencia errores de red sin lanzar.
 */

const findManyWebhook = vi.fn()
const updateWebhook = vi.fn().mockResolvedValue({})

vi.mock('@/lib/prisma', () => ({
  default: {
    webhook: {
      findMany: (...args: unknown[]) => findManyWebhook(...args),
      update: (...args: unknown[]) => updateWebhook(...args),
    },
  },
}))

vi.mock('server-only', () => ({}))

import { dispatchWebhookEvent, KNOWN_EVENTS } from '@/lib/webhooks/dispatcher'
import { signPayload, SIGNATURE_HEADER } from '@/lib/webhooks/signature'

const fetchMock = vi.fn()

beforeEach(() => {
  findManyWebhook.mockReset()
  updateWebhook.mockReset().mockResolvedValue({})
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('dispatchWebhookEvent', () => {
  it('no llama fetch si no hay suscriptores', async () => {
    findManyWebhook.mockResolvedValue([])
    await dispatchWebhookEvent('task.created', { id: 't1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('filtra hooks por eventType (solo despacha a los suscritos)', async () => {
    findManyWebhook.mockResolvedValue([
      { id: 'h1', url: 'https://a.test', secret: 's1', events: ['task.created'] },
      { id: 'h2', url: 'https://b.test', secret: 's2', events: ['baseline.captured'] },
      { id: 'h3', url: 'https://c.test', secret: 's3', events: ['*'] }, // wildcard
    ])
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    await dispatchWebhookEvent('task.created', { id: 't1' })

    expect(fetchMock).toHaveBeenCalledTimes(2) // h1 + h3
    const urls = fetchMock.mock.calls.map((c) => c[0])
    expect(urls).toContain('https://a.test')
    expect(urls).toContain('https://c.test')
    expect(urls).not.toContain('https://b.test')
  })

  it('envía body JSON con event/timestamp/data y header X-FollowupGantt-Signature', async () => {
    findManyWebhook.mockResolvedValue([
      { id: 'h1', url: 'https://a.test', secret: 'mysecret', events: ['task.created'] },
    ])
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }))

    await dispatchWebhookEvent('task.created', { id: 't1', title: 'Hola' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://a.test')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toMatch(/application\/json/)
    expect(init.headers[SIGNATURE_HEADER]).toBeTruthy()

    const parsed = JSON.parse(init.body as string)
    expect(parsed.event).toBe('task.created')
    expect(parsed.data).toEqual({ id: 't1', title: 'Hola' })
    expect(typeof parsed.timestamp).toBe('string')

    // La firma debe coincidir con HMAC del body usando el secret.
    const expectedSig = signPayload('mysecret', init.body as string)
    expect(init.headers[SIGNATURE_HEADER]).toBe(expectedSig)
  })

  it('actualiza stats post-delivery con failureCount=0 cuando 2xx', async () => {
    findManyWebhook.mockResolvedValue([
      { id: 'h1', url: 'https://a.test', secret: 's', events: ['task.created'] },
    ])
    fetchMock.mockResolvedValue(new Response('ok', { status: 201 }))

    await dispatchWebhookEvent('task.created', { x: 1 })

    expect(updateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'h1' },
        data: expect.objectContaining({
          lastDeliveryStatus: 201,
          failureCount: 0,
        }),
      }),
    )
  })

  it('incrementa failureCount cuando hay error de red', async () => {
    findManyWebhook.mockResolvedValue([
      { id: 'h1', url: 'https://a.test', secret: 's', events: ['task.created'] },
    ])
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    // No debe lanzar.
    await expect(dispatchWebhookEvent('task.created', { x: 1 })).resolves.toBeUndefined()

    expect(updateWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'h1' },
        data: expect.objectContaining({
          failureCount: { increment: 1 },
        }),
      }),
    )
  })

  it('Promise.allSettled: un hook caído no impide a los demás', async () => {
    findManyWebhook.mockResolvedValue([
      { id: 'h1', url: 'https://down.test', secret: 's', events: ['task.created'] },
      { id: 'h2', url: 'https://up.test', secret: 's', events: ['task.created'] },
    ])
    fetchMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    await dispatchWebhookEvent('task.created', {})

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('exporta el catálogo KNOWN_EVENTS conteniendo eventos canónicos', () => {
    expect(KNOWN_EVENTS).toContain('task.created')
    expect(KNOWN_EVENTS).toContain('baseline.captured')
    expect(KNOWN_EVENTS).toContain('dependency.created')
    expect(KNOWN_EVENTS).toContain('project.deleted')
  })
})
