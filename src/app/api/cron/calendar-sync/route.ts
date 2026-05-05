/**
 * Wave P8 · Equipo P8-5 — Cron endpoint para sync masiva de calendarios.
 *
 * Patrón clonado de `/api/cron/recurrence`: Vercel Cron golpea con
 * `Authorization: Bearer ${CRON_SECRET}`. Si el secret no está
 * configurado, sólo aceptamos llamadas desde loopback (dev local).
 *
 * Schedule sugerido (vercel.json crons): `"0 * /4 * * *"` (cada 4h).
 *
 * Errores per-connection se loggean dentro de `runSyncForAll` y NO
 * detienen el job global; aquí solo controlamos auth y serializamos
 * la respuesta para observability.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { runSyncForAll } from '@/lib/calendar/sync-engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''

  if (secret) {
    return auth === `Bearer ${secret}`
  }

  // Sin secret → loopback only.
  const url = new URL(req.url)
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const summary = await runSyncForAll()
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return GET(req)
}
