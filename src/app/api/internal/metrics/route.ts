/**
 * Wave P17-D · Endpoint interno de métricas RED.
 *
 * `GET /api/internal/metrics` devuelve un snapshot serializable de todas
 * las métricas registradas por la instancia. Útil para:
 *   - El dashboard `/internal/observability`.
 *   - Health-checks externos (Vercel cron / Pingdom) que quieran observar
 *     errorRate y p95.
 *
 * Auth: requiere SUPER_ADMIN (sesión) **o** `X-Internal-Token` cuyo valor
 * coincida con `process.env.INTERNAL_METRICS_TOKEN`. La doble vía permite
 * que un cron health-check pase un secret sin tener que mantener una
 * sesión de usuario.
 *
 * Side-effect opcional: si la query incluye `?emitSlo=1`, evaluamos el
 * snapshot contra los SLO defaults y emitimos breadcrumbs a Sentry para
 * cualquier violación. Esto permite que un cron interno (cada 5 min)
 * actúe como detector sin tener que duplicar la lógica acá.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireUser } from '@/lib/auth/get-current-user'
import { isSuperAdmin } from '@/lib/auth/permissions'
import { snapshotMetrics, emitSloBreadcrumbs } from '@/lib/observability/metrics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Verifica el token interno (header `X-Internal-Token`). Devuelve `true`
 * sólo si la env `INTERNAL_METRICS_TOKEN` está definida y coincide. Si la
 * env no está, el header NO concede acceso (fail-secure).
 */
function hasValidInternalToken(req: NextRequest): boolean {
  const expected = process.env.INTERNAL_METRICS_TOKEN
  if (!expected) return false
  const got = req.headers.get('x-internal-token')
  return got === expected
}

async function isAuthorized(req: NextRequest): Promise<{
  ok: true
  via: 'super-admin' | 'internal-token'
} | { ok: false }> {
  // Vía 1: header secret. No carga sesión → más rápido y sin coste DB
  // cuando un cron lo invoca repetidamente.
  if (hasValidInternalToken(req)) {
    return { ok: true, via: 'internal-token' }
  }

  // Vía 2: sesión SUPER_ADMIN. Captura el caso navegador (dashboard).
  try {
    const user = await requireUser()
    if (isSuperAdmin(user.roles)) {
      return { ok: true, via: 'super-admin' }
    }
  } catch {
    // No autenticado → cae a 401 unificado abajo.
  }
  return { ok: false }
}

export async function GET(req: NextRequest) {
  const auth = await isAuthorized(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const snapshot = snapshotMetrics()

  // Side-effect opcional para cron interno.
  let sloViolations: number | null = null
  if (req.nextUrl.searchParams.get('emitSlo') === '1') {
    const result = emitSloBreadcrumbs(snapshot)
    sloViolations = result.violations
  }

  return NextResponse.json({
    ok: true,
    via: auth.via,
    capturedAt: new Date().toISOString(),
    metricsCount: Object.keys(snapshot).length,
    metrics: snapshot,
    sloViolations,
  })
}
