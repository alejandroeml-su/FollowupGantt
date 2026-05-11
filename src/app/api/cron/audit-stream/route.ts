/**
 * R3-E · Audit Streaming · Endpoint cron.
 *
 * Vercel Cron golpea este endpoint cada 5 min (ver vercel.json). Llama
 * `flushBatches()` para drenar la cola in-memory y reintenta deliveries
 * `FAILED`/`RETRYING` con `attempt < MAX_ATTEMPTS`.
 *
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (mismo patrón que
 * `/api/cron/recurrence`). En dev (sin secret) acepta loopback.
 */

import { NextResponse, type NextRequest } from 'next/server'
import {
  flushBatches,
  retryFailedDeliveries,
} from '@/lib/audit/streaming/engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''

  if (secret) {
    return auth === `Bearer ${secret}`
  }

  const url = new URL(req.url)
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const flushSummary = await flushBatches()
    const retrySummary = await retryFailedDeliveries()
    return NextResponse.json({
      ok: true,
      flush: flushSummary,
      retry: retrySummary,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
