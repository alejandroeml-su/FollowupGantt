import 'server-only'

/**
 * Wave P8 · Equipo P8-5 — Wrapper sobre Microsoft Graph (Calendar API).
 *
 * Mismo shape que `google-client.ts` para que `sync-engine.ts` pueda
 * tratarlos polimórficamente. Diferencias:
 *   - Endpoint v1.0 de Graph (`/me/events` o `/me/calendars/{id}/events`).
 *   - Refresh con tenant `common` (multi-tenant + cuentas personales).
 *   - Body usa `subject`/`body.content` (HTML) en vez de Google's
 *     `summary`/`description`.
 *   - All-day usa `isAllDay: true` + `start.dateTime` con hora 00:00 UTC.
 *
 * Errores tipados:
 *   - `[CALENDAR_MICROSOFT_ERROR] detalle`
 *   - `[CALENDAR_MICROSOFT_DISABLED]` si faltan env vars.
 *
 * Variables de entorno (compartidas con oauth-microsoft.ts):
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 *   MICROSOFT_TENANT_ID  (opcional, default 'common')
 */

const GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0'
const REFRESH_MARGIN_MS = 60_000

function tokenUrl(): string {
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common'
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
}

export interface MicrosoftCalendarEvent {
  externalEventId: string | null
  subject: string
  bodyHtml?: string
  startsAt: Date
  endsAt: Date
  allDay?: boolean
  calendarId?: string // si null → /me/events (calendar default).
}

export interface MicrosoftUpsertResult {
  externalEventId: string
  updated: boolean
}

export interface MicrosoftAccessTokenRefresh {
  accessToken: string
  expiresAt: Date
}

function microsoftError(detail: string): never {
  throw new Error(`[CALENDAR_MICROSOFT_ERROR] ${detail}`)
}

function microsoftDisabled(detail: string): never {
  throw new Error(`[CALENDAR_MICROSOFT_DISABLED] ${detail}`)
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<MicrosoftAccessTokenRefresh> {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    microsoftDisabled('MICROSOFT_CLIENT_ID/SECRET no configurado')
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: 'openid offline_access Calendars.ReadWrite',
  })

  let response: Response
  try {
    response = await fetch(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (err) {
    microsoftError(`fallo de red al refrescar token: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    microsoftError(`refresh token endpoint ${response.status}: ${text}`)
  }

  const json = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }
  if (!json.access_token || typeof json.expires_in !== 'number') {
    microsoftError('respuesta de refresh sin access_token/expires_in')
  }

  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
  }
}

export function isAccessTokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true
  return expiresAt.getTime() - REFRESH_MARGIN_MS <= Date.now()
}

function buildEventBody(event: MicrosoftCalendarEvent): Record<string, unknown> {
  // Graph requiere `start.timeZone` aunque mandemos UTC; usamos siempre UTC.
  const base: Record<string, unknown> = {
    subject: event.subject,
    body: {
      contentType: 'HTML',
      content: event.bodyHtml ?? '',
    },
  }

  if (event.allDay) {
    return {
      ...base,
      isAllDay: true,
      // Graph all-day exige hora 00:00:00 + timeZone='UTC'.
      start: {
        dateTime: `${event.startsAt.toISOString().slice(0, 10)}T00:00:00`,
        timeZone: 'UTC',
      },
      end: {
        dateTime: `${event.endsAt.toISOString().slice(0, 10)}T00:00:00`,
        timeZone: 'UTC',
      },
    }
  }

  return {
    ...base,
    start: {
      dateTime: event.startsAt.toISOString(),
      timeZone: 'UTC',
    },
    end: {
      dateTime: event.endsAt.toISOString(),
      timeZone: 'UTC',
    },
  }
}

function eventsEndpoint(calendarId?: string): string {
  if (calendarId) {
    return `${GRAPH_API_BASE}/me/calendars/${encodeURIComponent(calendarId)}/events`
  }
  return `${GRAPH_API_BASE}/me/events`
}

export async function upsertEvent(
  accessToken: string,
  event: MicrosoftCalendarEvent,
): Promise<MicrosoftUpsertResult> {
  const isUpdate = Boolean(event.externalEventId)
  const baseUrl = eventsEndpoint(event.calendarId)
  const url = isUpdate
    ? `${baseUrl}/${encodeURIComponent(event.externalEventId as string)}`
    : baseUrl

  let response: Response
  try {
    response = await fetch(url, {
      method: isUpdate ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildEventBody(event)),
    })
  } catch (err) {
    microsoftError(`fallo de red en upsert: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    microsoftError(`events endpoint ${response.status}: ${text}`)
  }

  const json = (await response.json()) as { id?: string }
  if (!json.id) {
    microsoftError('respuesta sin id de evento')
  }

  return { externalEventId: json.id, updated: isUpdate }
}

export async function deleteEvent(
  accessToken: string,
  externalEventId: string,
  calendarId?: string,
): Promise<{ removed: boolean }> {
  const url = `${eventsEndpoint(calendarId)}/${encodeURIComponent(externalEventId)}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (err) {
    microsoftError(`fallo de red en delete: ${(err as Error).message}`)
  }

  if (response.status === 404) {
    return { removed: false }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    microsoftError(`delete endpoint ${response.status}: ${text}`)
  }

  return { removed: true }
}

export const MICROSOFT_CALENDAR_PROVIDER_ID = 'microsoft' as const
