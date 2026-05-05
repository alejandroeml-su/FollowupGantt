import 'server-only'

/**
 * Wave P8 · Equipo P8-5 — Wrapper sobre Google Calendar API v3.
 *
 * Decisiones técnicas:
 *   - NO añadimos `googleapis` como dependencia: Google Calendar v3 es
 *     una REST API simple sobre `fetch`, y la suite ya usa este patrón
 *     en `oauth-google.ts`. Mantener bundle pequeño + auditoría visible.
 *   - One-way sync (FollowupGantt → Calendar). Solo POST/PATCH/DELETE
 *     desde nuestro lado; NO listamos eventos creados por el usuario.
 *   - Token refresh: `refreshAccessToken` se invoca cuando `expiresAt`
 *     está expirado (margen de 60s). Persistencia del nuevo accessToken
 *     queda a cargo del caller (sync-engine.ts).
 *   - Idempotencia: el caller debe pasar `externalEventId` cuando
 *     existe → PATCH; si null → POST y devolvemos el id resultante.
 *
 * Errores tipados:
 *   - `[CALENDAR_GOOGLE_ERROR] detalle` para fallos de red/API.
 *   - `[CALENDAR_GOOGLE_DISABLED]` si faltan env vars de OAuth.
 *
 * Variables de entorno (compartidas con oauth-google.ts):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

/** Margen para considerar el token expirado antes de su DEADLINE real (ms). */
const REFRESH_MARGIN_MS = 60_000

export interface GoogleCalendarEvent {
  /** Id del evento en Google. Pasa null para crear; pasa string para PATCH. */
  externalEventId: string | null
  summary: string
  description?: string
  /** ISO 8601. Para eventos all-day usa solo fecha (YYYY-MM-DD). */
  startsAt: Date
  endsAt: Date
  /** Si true, evento "all-day" (Google interpreta como `date` en lugar de `dateTime`). */
  allDay?: boolean
  /** Calendar id en Google. Default 'primary'. */
  calendarId?: string
}

export interface GoogleUpsertResult {
  externalEventId: string
  updated: boolean // false → se creó, true → se actualizó
}

export interface GoogleAccessTokenRefresh {
  accessToken: string
  expiresAt: Date
}

function googleError(detail: string): never {
  throw new Error(`[CALENDAR_GOOGLE_ERROR] ${detail}`)
}

function googleDisabled(detail: string): never {
  throw new Error(`[CALENDAR_GOOGLE_DISABLED] ${detail}`)
}

/**
 * Refresca el access_token usando refresh_token (offline_access scope).
 * Devuelve el nuevo token + fecha de expiración. El caller persiste
 * en `CalendarConnection.accessToken/expiresAt`.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<GoogleAccessTokenRefresh> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    googleDisabled('GOOGLE_CLIENT_ID/SECRET no configurado')
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (err) {
    googleError(`fallo de red al refrescar token: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    googleError(`refresh token endpoint ${response.status}: ${text}`)
  }

  const json = (await response.json()) as {
    access_token?: string
    expires_in?: number
  }
  if (!json.access_token || typeof json.expires_in !== 'number') {
    googleError('respuesta de refresh sin access_token/expires_in')
  }

  return {
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000),
  }
}

/**
 * Indica si un access token está expirado (con margen de seguridad).
 * Si `expiresAt` es null lo consideramos expirado para forzar refresh.
 */
export function isAccessTokenExpired(expiresAt: Date | null): boolean {
  if (!expiresAt) return true
  return expiresAt.getTime() - REFRESH_MARGIN_MS <= Date.now()
}

/**
 * Construye el body que Google espera. Maneja el formato `date` (all-day)
 * vs `dateTime` (con hora).
 */
function buildEventBody(event: GoogleCalendarEvent): Record<string, unknown> {
  if (event.allDay) {
    // Google requiere `date` en formato YYYY-MM-DD para all-day, y la
    // fecha de fin es exclusiva.
    return {
      summary: event.summary,
      description: event.description,
      start: { date: event.startsAt.toISOString().slice(0, 10) },
      end: { date: event.endsAt.toISOString().slice(0, 10) },
    }
  }
  return {
    summary: event.summary,
    description: event.description,
    start: { dateTime: event.startsAt.toISOString() },
    end: { dateTime: event.endsAt.toISOString() },
  }
}

/**
 * Inserta o actualiza un evento. Idempotente vía `externalEventId`.
 * El caller debe pasar un `accessToken` ya refrescado.
 */
export async function upsertEvent(
  accessToken: string,
  event: GoogleCalendarEvent,
): Promise<GoogleUpsertResult> {
  const calendarId = encodeURIComponent(event.calendarId || 'primary')
  const isUpdate = Boolean(event.externalEventId)
  const url = isUpdate
    ? `${CALENDAR_API_BASE}/calendars/${calendarId}/events/${encodeURIComponent(event.externalEventId as string)}`
    : `${CALENDAR_API_BASE}/calendars/${calendarId}/events`

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
    googleError(`fallo de red en upsert: ${(err as Error).message}`)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    googleError(`events endpoint ${response.status}: ${text}`)
  }

  const json = (await response.json()) as { id?: string }
  if (!json.id) {
    googleError('respuesta sin id de evento')
  }

  return { externalEventId: json.id, updated: isUpdate }
}

/**
 * Borra un evento. Idempotente: 404 se trata como éxito (ya no existe).
 */
export async function deleteEvent(
  accessToken: string,
  externalEventId: string,
  calendarId = 'primary',
): Promise<{ removed: boolean }> {
  const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (err) {
    googleError(`fallo de red en delete: ${(err as Error).message}`)
  }

  if (response.status === 404) {
    // Ya no existe → idempotente.
    return { removed: false }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    googleError(`delete endpoint ${response.status}: ${text}`)
  }

  return { removed: true }
}

export const GOOGLE_CALENDAR_PROVIDER_ID = 'google' as const
