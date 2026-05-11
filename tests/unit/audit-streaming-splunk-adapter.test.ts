import { describe, it, expect, vi } from 'vitest'

import { splunkAdapter } from '@/lib/audit/streaming/adapters/splunk'
import type { StreamableEvent, StreamTargetSnapshot } from '@/lib/audit/streaming/types'

/**
 * R3-E · Splunk HEC adapter — formato y headers.
 *
 * Cubre:
 *   - Header `Authorization: Splunk <token>`.
 *   - Body NDJSON (un evento por línea, sin comas).
 *   - Cada línea contiene `event`, `sourcetype: "sync:audit"`, `time` (epoch s).
 *   - `time` deriva de `createdAt` ISO → segundos.
 *   - Manejo de error de red devuelve `{ ok: false, error: ... }`.
 */

function sampleEvent(overrides: Partial<StreamableEvent> = {}): StreamableEvent {
  return {
    id: 'evt-1',
    action: 'task.created',
    entityType: 'task',
    entityId: 't-1',
    actorId: 'u-1',
    workspaceId: 'w-1',
    before: null,
    after: { title: 'demo' },
    metadata: null,
    ipAddress: null,
    userAgent: null,
    createdAt: '2026-05-11T10:00:00.000Z',
    ...overrides,
  }
}

const target: StreamTargetSnapshot = {
  id: 'tgt-1',
  workspaceId: 'w-1',
  kind: 'SPLUNK',
  endpoint: 'https://hec.example.com/services/collector',
  secret: 'splunk-token-abc',
}

describe('splunkAdapter', () => {
  it('envía NDJSON con sourcetype sync:audit y header Splunk', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }))

    const events = [sampleEvent({ id: 'a' }), sampleEvent({ id: 'b', createdAt: '2026-05-11T10:01:00.000Z' })]
    const res = await splunkAdapter.send(target, events, fetchMock as unknown as typeof fetch)

    expect(res.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(target.endpoint)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Splunk splunk-token-abc')
    expect(headers['Content-Type']).toBe('application/json')

    const body = init.body as string
    const lines = body.split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0])
    expect(first.sourcetype).toBe('sync:audit')
    expect(first.event.id).toBe('a')
    expect(first.time).toBe(Math.floor(new Date('2026-05-11T10:00:00.000Z').getTime() / 1000))
    const second = JSON.parse(lines[1])
    expect(second.event.id).toBe('b')
  })

  it('propaga error HTTP como { ok: false, statusCode, error }', async () => {
    const fetchMock = vi.fn(async () => new Response('bad token', { status: 401 }))
    const res = await splunkAdapter.send(target, [sampleEvent()], fetchMock as unknown as typeof fetch)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.statusCode).toBe(401)
      expect(res.error).toContain('bad token')
    }
  })

  it('captura excepciones de red como { ok: false, error }', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('econnreset')
    })
    const res = await splunkAdapter.send(target, [sampleEvent()], fetchMock as unknown as typeof fetch)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('econnreset')
  })
})
