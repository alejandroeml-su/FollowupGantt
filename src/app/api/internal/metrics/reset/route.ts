/**
 * Wave P17-D · Reset de métricas RED in-memory.
 *
 * `POST /api/internal/metrics/reset` borra el `Map` interno. Pensado
 * para tests humanos y para el botón "Reset metrics" del dashboard.
 *
 * Auth idéntica al endpoint de snapshot pero **el header interno NO basta**
 * para reset — sólo SUPER_ADMIN puede resetear vía sesión. Un secret
 * filtrado no debería poder limpiar evidencia operativa.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/get-current-user'
import { isSuperAdmin } from '@/lib/auth/permissions'
import { resetMetrics } from '@/lib/observability/metrics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST() {
  let user
  try {
    user = await requireUser()
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!isSuperAdmin(user.roles)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  resetMetrics()
  return NextResponse.json({
    ok: true,
    resetAt: new Date().toISOString(),
    by: user.id,
  })
}
