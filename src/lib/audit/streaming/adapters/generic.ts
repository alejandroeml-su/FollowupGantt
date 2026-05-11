/**
 * R3-E · Audit Streaming · Generic webhook adapter con firma HMAC-SHA256.
 *
 * Body: `{ batchId, sentAt, workspaceId, events: [...] }` serializado a JSON.
 * Headers:
 *   Content-Type: application/json
 *   X-Sync-Signature: hex(HMAC-SHA256(secret, body))
 *   X-Sync-Workspace: <workspaceId>
 *
 * El consumidor debe recomputar el HMAC para verificar autenticidad.
 */

import { createHmac, randomUUID } from 'node:crypto'

import type { Adapter, StreamableEvent, StreamTargetSnapshot } from '../types'

export const SIGNATURE_HEADER = 'X-Sync-Signature'
export const WORKSPACE_HEADER = 'X-Sync-Workspace'

export function buildGenericPayload(
  target: StreamTargetSnapshot,
  events: StreamableEvent[],
): { body: string; signature: string; batchId: string } {
  const batchId = randomUUID()
  const body = JSON.stringify({
    batchId,
    sentAt: new Date().toISOString(),
    workspaceId: target.workspaceId,
    events,
  })
  const signature = signBody(target.secret, body)
  return { body, signature, batchId }
}

export function signBody(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex')
}

export const genericAdapter: Adapter = {
  async send(target, events, fetchImpl) {
    const { body, signature } = buildGenericPayload(target, events)
    const f = fetchImpl ?? fetch
    try {
      const res = await f(target.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SIGNATURE_HEADER]: signature,
          [WORKSPACE_HEADER]: target.workspaceId,
        },
        body,
      })
      if (!res.ok) {
        const text = await safeReadText(res)
        return { ok: false, statusCode: res.status, error: text }
      }
      return { ok: true, statusCode: res.status }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  },
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return `status ${res.status}`
  }
}
