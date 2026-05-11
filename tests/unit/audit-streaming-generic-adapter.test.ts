import { describe, it, expect, vi } from 'vitest'
import { createHmac } from 'node:crypto'

import {
  genericAdapter,
  signBody,
  buildGenericPayload,
  SIGNATURE_HEADER,
  WORKSPACE_HEADER,
} from '@/lib/audit/streaming/adapters/generic'
import type { StreamableEvent, StreamTargetSnapshot } from '@/lib/audit/streaming/types'

/**
 * R3-E · Generic webhook adapter — HMAC-SHA256.
 *
 * Cubre:
 *   - Header `X-Sync-Signature` con HMAC-SHA256(secret, body) en hex.
 *   - Header `X-Sync-Workspace` con el workspaceId.
 *   - Body contiene `batchId`, `sentAt`, `workspaceId`, `events`.
 *   - `signBody` es determinista para mismo secret + body.
 */

function sampleEvent(): StreamableEvent {
  return {
    id: 'evt-99',
    action: 'task.created',
    entityType: 'task',
    entityId: 't-1',
    actorId: 'u-1',
    workspaceId: 'w-42',
    before: null,
    after: { title: 'demo' },
    metadata: null,
    ipAddress: null,
    userAgent: null,
    createdAt: '2026-05-11T10:00:00.000Z',
  }
}

const target: StreamTargetSnapshot = {
  id: 'tgt-9',
  workspaceId: 'w-42',
  kind: 'GENERIC_WEBHOOK',
  endpoint: 'https://siem.example.com/inbound',
  secret: 'super-secret-shared-key',
}

describe('signBody', () => {
  it('produce HMAC-SHA256 hex determinista', () => {
    const body = JSON.stringify({ foo: 'bar' })
    const sig = signBody('s3cret', body)
    const expected = createHmac('sha256', 's3cret').update(body, 'utf8').digest('hex')
    expect(sig).toBe(expected)
    expect(sig).toMatch(/^[a-f0-9]{64}$/)
    // Determinismo
    expect(signBody('s3cret', body)).toBe(sig)
  })

  it('cambia la firma si cambia el secret o el body', () => {
    const body = JSON.stringify({ foo: 'bar' })
    expect(signBody('s3cret', body)).not.toBe(signBody('s3cret2', body))
    expect(signBody('s3cret', body)).not.toBe(signBody('s3cret', body + ' '))
  })
})

describe('buildGenericPayload', () => {
  it('arma JSON con batchId, sentAt, workspaceId y events; firma matches body', () => {
    const { body, signature, batchId } = buildGenericPayload(target, [sampleEvent()])
    const parsed = JSON.parse(body)
    expect(parsed.batchId).toBe(batchId)
    expect(parsed.workspaceId).toBe('w-42')
    expect(Array.isArray(parsed.events)).toBe(true)
    expect(parsed.events).toHaveLength(1)
    expect(typeof parsed.sentAt).toBe('string')
    // Signature recomputable
    const expected = createHmac('sha256', target.secret).update(body, 'utf8').digest('hex')
    expect(signature).toBe(expected)
  })
})

describe('genericAdapter', () => {
  it('envía POST con X-Sync-Signature y X-Sync-Workspace', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    const res = await genericAdapter.send(target, [sampleEvent()], fetchMock as unknown as typeof fetch)
    expect(res.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(target.endpoint)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers[WORKSPACE_HEADER]).toBe('w-42')
    expect(headers[SIGNATURE_HEADER]).toMatch(/^[a-f0-9]{64}$/)
    // Verify signature matches body
    const expected = createHmac('sha256', target.secret).update(init.body as string, 'utf8').digest('hex')
    expect(headers[SIGNATURE_HEADER]).toBe(expected)
  })

  it('marca error cuando el endpoint responde 5xx', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }))
    const res = await genericAdapter.send(target, [sampleEvent()], fetchMock as unknown as typeof fetch)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.statusCode).toBe(500)
      expect(res.error).toContain('boom')
    }
  })
})
