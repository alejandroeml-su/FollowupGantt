import { describe, it, expect, vi } from 'vitest'

import { datadogAdapter } from '@/lib/audit/streaming/adapters/datadog'
import type { StreamableEvent, StreamTargetSnapshot } from '@/lib/audit/streaming/types'

/**
 * R3-E · Datadog Logs API v2 adapter — formato y headers.
 *
 * Cubre:
 *   - Header `DD-API-KEY`.
 *   - URL se completa con `/api/v2/logs` si no termina así.
 *   - Body es JSON array, cada entrada con `service: "sync"`, `ddsource: "sync"`,
 *     `ddtags` con `env:<env>,workspace:<id>`, `message` y bloque `audit`.
 */

function sampleEvent(overrides: Partial<StreamableEvent> = {}): StreamableEvent {
  return {
    id: 'evt-1',
    action: 'task.updated',
    entityType: 'task',
    entityId: 't-1',
    actorId: 'u-1',
    workspaceId: 'w-1',
    before: { status: 'TODO' },
    after: { status: 'IN_PROGRESS' },
    metadata: null,
    ipAddress: '1.2.3.4',
    userAgent: 'agent/1',
    createdAt: '2026-05-11T10:00:00.000Z',
    ...overrides,
  }
}

const baseTarget: StreamTargetSnapshot = {
  id: 'tgt-1',
  workspaceId: 'w-7',
  kind: 'DATADOG',
  endpoint: 'https://http-intake.logs.datadoghq.com',
  secret: 'dd-api-key-xyz',
}

describe('datadogAdapter', () => {
  it('postea a /api/v2/logs con DD-API-KEY y JSON array bien formado', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))

    const events = [sampleEvent({ id: 'a' }), sampleEvent({ id: 'b' })]
    const res = await datadogAdapter.send(baseTarget, events, fetchMock as unknown as typeof fetch)
    expect(res.ok).toBe(true)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://http-intake.logs.datadoghq.com/api/v2/logs')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['DD-API-KEY']).toBe('dd-api-key-xyz')
    expect(headers['Content-Type']).toBe('application/json')

    const payload = JSON.parse(init.body as string)
    expect(Array.isArray(payload)).toBe(true)
    expect(payload).toHaveLength(2)
    const first = payload[0]
    expect(first.service).toBe('sync')
    expect(first.ddsource).toBe('sync')
    expect(first.ddtags).toContain('workspace:w-7')
    expect(first.ddtags).toMatch(/env:(prod|dev)/)
    expect(first.audit.id).toBe('a')
    expect(first.audit.before).toEqual({ status: 'TODO' })
    expect(first.audit.after).toEqual({ status: 'IN_PROGRESS' })
    expect(typeof first.timestamp).toBe('number')
  })

  it('respeta endpoint que ya termina en /api/v2/logs', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }))
    const customTarget = {
      ...baseTarget,
      endpoint: 'https://http-intake.logs.datadoghq.eu/api/v2/logs',
    }
    await datadogAdapter.send(customTarget, [sampleEvent()], fetchMock as unknown as typeof fetch)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(customTarget.endpoint)
  })

  it('devuelve error con statusCode cuando Datadog rechaza', async () => {
    const fetchMock = vi.fn(async () => new Response('forbidden', { status: 403 }))
    const res = await datadogAdapter.send(baseTarget, [sampleEvent()], fetchMock as unknown as typeof fetch)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.statusCode).toBe(403)
      expect(res.error).toContain('forbidden')
    }
  })
})
