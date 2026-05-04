/**
 * Ola P2 · Equipo P2-3 — Endpoint cron para `scheduleAll`.
 *
 * Vercel Cron / GitHub Actions golpea este endpoint con cabecera
 * `Authorization: Bearer ${CRON_SECRET}`. Si el secret no está
 * configurado, sólo aceptamos llamadas desde el host loopback (dev).
 *
 * Convención SRE Avante: secrets vía env, fallar 401 si falta o no coincide.
 * El handler delega completamente en `scheduleAll`; aquí sólo controlamos
 * autorización y serialización de la respuesta.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { scheduleAll } from '@/lib/recurrence/scheduler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''

  // Vercel Cron envía `Authorization: Bearer <secret>`.
  if (secret) {
    return auth === `Bearer ${secret}`
  }

  // Sin secret configurado: sólo loopback (dev local).
  const url = new URL(req.url)
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const summary = await scheduleAll()
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

// POST acepta los mismos parámetros que GET — Vercel Cron usa GET por
// defecto pero algunos clientes (curl, Postman) prefieren POST.
export async function POST(req: NextRequest) {
  return GET(req)
}
