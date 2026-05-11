/**
 * R3-E · Audit Streaming · Splunk HEC adapter.
 *
 * Splunk HTTP Event Collector: cada evento se envía como objeto JSON
 * concatenado (NDJSON sin comas) con shape:
 *   { "event": {...}, "sourcetype": "sync:audit", "time": <epoch> }
 *
 * Headers:
 *   Authorization: Splunk <token>
 *   Content-Type: application/json
 *
 * `endpoint` = URL HEC completa (ej. https://hec.splunkcloud.com/services/collector).
 * `secret`   = token HEC.
 */

import type { Adapter } from '../types'

export const splunkAdapter: Adapter = {
  async send(target, events, fetchImpl) {
    const body = events
      .map((e) =>
        JSON.stringify({
          event: e,
          sourcetype: 'sync:audit',
          time: Math.floor(new Date(e.createdAt).getTime() / 1000),
        }),
      )
      .join('\n')

    const f = fetchImpl ?? fetch
    try {
      const res = await f(target.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Splunk ${target.secret}`,
          'Content-Type': 'application/json',
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

export function formatSplunkPayload(
  events: { id: string; createdAt: string }[],
): string {
  return events
    .map((e) =>
      JSON.stringify({
        event: e,
        sourcetype: 'sync:audit',
        time: Math.floor(new Date(e.createdAt).getTime() / 1000),
      }),
    )
    .join('\n')
}
