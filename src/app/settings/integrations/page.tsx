/**
 * Página admin de Integraciones externas (Ola P4 · Equipo P4-5).
 *
 * Lista las integraciones configuradas (Slack/Teams/GitHub) y permite
 * añadir/editar/eliminar mediante client components. Si la migración no
 * se ha aplicado aún, devolvemos un listado vacío con CTA en lugar de
 * romper el render (mismo patrón que `/settings/calendars`).
 */

import { IntegrationsList } from '@/components/integrations/IntegrationsList'
import { listIntegrations } from '@/lib/actions/integrations'

export const dynamic = 'force-dynamic'

export default async function IntegrationsSettingsPage() {
  let integrations: Awaited<ReturnType<typeof listIntegrations>> = []
  try {
    integrations = await listIntegrations()
  } catch {
    // Migración pendiente o tabla inexistente: render seguro con lista vacía.
    integrations = []
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Integraciones</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Conecta FollowupGantt con Slack, Microsoft Teams y GitHub para
            recibir notificaciones y vincular tareas a issues/PRs.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <IntegrationsList initial={integrations} />
        </div>
      </div>
    </div>
  )
}
