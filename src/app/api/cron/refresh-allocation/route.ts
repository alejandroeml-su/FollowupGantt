/**
 * Wave P10 (HU-10.7 · BETA-2.1) — Cron handler para refresh nightly de
 * `ResourceAllocationSnapshot`.
 *
 * Endpoint que se golpea con header `Authorization: Bearer ${CRON_SECRET}`.
 * Schedule sugerido: `0 2 * * *` (diariamente a las 2am UTC).
 *
 * NOTA OPERACIONAL · Vercel Hobby limita a 2 crons. Actualmente
 * `vercel.json` ya tiene 2 (`currency-rates` + `daily-standup`). Para
 * activar este cron en Vercel hay que: (a) upgrade a Pro, (b) reemplazar
 * uno de los existentes, o (c) invocarlo desde GitHub Actions con el
 * mismo secret. Mientras tanto, el endpoint puede llamarse manualmente
 * desde la UI vía botón "Recalcular" en /portfolio/allocation.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { refreshAllocationSnapshots } from '@/lib/actions/allocation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  // Vercel Cron usa `Bearer ${CRON_SECRET}`. Permitimos también un fallback
  // sin secret en local dev cuando NODE_ENV !== 'production'.
  if (!secret) return process.env.NODE_ENV !== 'production'
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401 },
    )
  }

  try {
    const result = await refreshAllocationSnapshots({ daysAhead: 28 })
    return NextResponse.json({
      ok: true,
      refreshed: result.refreshed,
      users: result.users,
      ranAt: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
