/**
 * R3-E · Audit Streaming · Datadog Logs API v2 adapter.
 *
 * Reference: https://docs.datadoghq.com/api/latest/logs/#send-logs
 *   POST /api/v2/logs
 *   Headers:
 *     DD-API-KEY: <secret>
 *     Content-Type: application/json
 *   Body: JSON array of log entries con `service`, `ddsource`, `ddtags`,
 *         `message` y campos planos custom.
 *
 * `endpoint` = base URL (ej. https://http-intake.logs.datadoghq.com).
 *              Concatenamos `/api/v2/logs` si no termina así.
 * `secret`   = API key.
 */

import type { Adapter } from '../types'

const SERVICE = 'sync'
const DD_SOURCE = 'sync'

export const datadogAdapter: Adapter = {
  async send(target, events, fetchImpl) {
    const url = normalizeUrl(target.endpoint)
    const payload = events.map((e) =>
      formatDatadogEntry(e, target.workspaceId),
    )

    const f = fetchImpl ?? fetch
    try {
      const res = await f(url, {
        method: 'POST',
        headers: {
          'DD-API-KEY': target.secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
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

function normalizeUrl(endpoint: string): string {
  if (endpoint.endsWith('/api/v2/logs')) return endpoint
  if (endpoint.endsWith('/')) return endpoint + 'api/v2/logs'
  return endpoint + '/api/v2/logs'
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return `status ${res.status}`
  }
}

export function formatDatadogEntry(
  event: {
    id: string
    action: string
    entityType: string
    entityId: string | null
    actorId: string | null
    createdAt: string
    before?: unknown
    after?: unknown
    metadata?: unknown
    ipAddress?: string | null
    userAgent?: string | null
  },
  workspaceId: string,
) {
  const env = process.env.NODE_ENV === 'production' ? 'prod' : 'dev'
  return {
    service: SERVICE,
    ddsource: DD_SOURCE,
    ddtags: `env:${env},workspace:${workspaceId}`,
    message: `${event.action} ${event.entityType}${event.entityId ? '#' + event.entityId : ''}`,
    hostname: 'sync',
    timestamp: new Date(event.createdAt).getTime(),
    audit: {
      id: event.id,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      actorId: event.actorId,
      before: event.before,
      after: event.after,
      metadata: event.metadata,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
    },
  }
}
