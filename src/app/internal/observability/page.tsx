/**
 * Wave P17-D · Dashboard SLO interno.
 *
 * Server component que valida acceso (SUPER_ADMIN) y delega el
 * rendering de la tabla al client component que polea cada 30s.
 *
 * Por qué `/internal/observability` y no `/admin/observability`:
 * el equipo C (P17-C) está iterando sobre el árbol `/admin`. Mantenemos
 * una ruta paralela para evitar conflictos de merge en el sidebar.
 */
import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/get-current-user'
import { isSuperAdmin } from '@/lib/auth/permissions'
import { ObservabilityDashboard } from '@/components/observability/ObservabilityDashboard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function ObservabilityPage() {
  let user
  try {
    user = await requireUser()
  } catch {
    redirect('/login?next=/internal/observability')
  }

  if (!isSuperAdmin(user.roles)) {
    redirect('/')
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">
          Observabilidad · APM interno
        </h1>
        <p className="text-sm text-muted-foreground">
          Métricas RED (Rate · Errors · Duration) por server action.
          Auto-refresca cada 30 segundos. La ventana es in-memory por
          instancia y se reinicia con cada deploy.
        </p>
      </header>

      <ObservabilityDashboard />
    </main>
  )
}
