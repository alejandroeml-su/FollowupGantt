/**
 * Wave P8 · Equipo P8-5 — Endpoint público de feed ICS.
 *
 * Servido en `/api/calendar/ics/{token}`. Cualquier cliente compatible
 * con iCalendar (Apple Calendar, Thunderbird, Outlook ICS feeds, Google
 * Calendar "From URL") puede subscribirse y polleará periódicamente.
 *
 * Sin autenticación: el `token` actúa como bearer (32 bytes random).
 * Si el cliente sospecha que se filtró, regenera el token desde
 * /settings/calendar y el feed antiguo deja de funcionar.
 *
 * Si el token no existe / `syncEnabled=false`, devolvemos un calendario
 * vacío (200) para evitar filtrar la existencia del token vía status.
 */

import { type NextRequest } from 'next/server'
import { generateIcsForToken } from '@/lib/calendar/ics-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = Promise<{ token: string }>

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params

  if (!token || token.length < 16 || token.length > 256) {
    // Token mal formado — devolvemos 404 estándar (no filtra info).
    return new Response('not found', { status: 404 })
  }

  const { body } = await generateIcsForToken(token)

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="followupgantt.ics"',
      // Cache corto: los clientes pollean cada 15-60 min según política.
      'Cache-Control': 'public, max-age=900, must-revalidate',
    },
  })
}
