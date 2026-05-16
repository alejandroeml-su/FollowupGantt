/**
 * Página admin de Integraciones externas (Ola P4 · Equipo P4-5).
 *
 * Lista las integraciones configuradas (Slack/Teams/GitHub) y permite
 * añadir/editar/eliminar mediante client components. Si la migración no
 * se ha aplicado aún, devolvemos un listado vacío con CTA en lugar de
 * romper el render (mismo patrón que `/settings/calendars`).
 *
 * R4 · US-7.4 — Card "Email-to-Task" con el alias del proyecto activo
 * (el primero que el usuario pueda ver, ordenado por updatedAt). El
 * alias se genera en createProject; la card sirve como "copy + cómo
 * usarlo" para el usuario final.
 */

import { IntegrationsList } from '@/components/integrations/IntegrationsList'
import { listIntegrations } from '@/lib/actions/integrations'
import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { resolveProjectVisibility } from '@/lib/auth/visibility'
import { getInboundEmailDomain } from '@/lib/email/inbound-alias'
import { EmailToTaskCard } from '@/components/integrations/EmailToTaskCard'

export const dynamic = 'force-dynamic'

export default async function IntegrationsSettingsPage() {
  let integrations: Awaited<ReturnType<typeof listIntegrations>> = []
  try {
    integrations = await listIntegrations()
  } catch {
    // Migración pendiente o tabla inexistente: render seguro con lista vacía.
    integrations = []
  }

  // R4 · US-7.4 — Resuelve proyectos visibles para el usuario actual
  // (RBAC vía `resolveProjectVisibility`) y muestra el alias del primero.
  // El usuario puede cambiar de proyecto desde el dropdown del card.
  let inboundEmailProjects: Array<{
    id: string
    name: string
    alias: string | null
  }> = []
  try {
    const user = await getCurrentUser()
    if (user) {
      const visibility = await resolveProjectVisibility(user)
      const projects = await prisma.project.findMany({
        where: visibility.projectWhere,
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, inboundEmailAlias: true },
        take: 50,
      })
      inboundEmailProjects = projects.map((p) => ({
        id: p.id,
        name: p.name,
        alias: p.inboundEmailAlias,
      }))
    }
  } catch {
    // Migración pendiente o columna inexistente — render seguro sin la card.
    inboundEmailProjects = []
  }

  const inboundDomain = getInboundEmailDomain()

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Integraciones</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Conecta Sync con Slack, Microsoft Teams y GitHub para
            recibir notificaciones y vincular tareas a issues/PRs.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* R4 · US-7.4 — Email ClickApp */}
          {inboundEmailProjects.length > 0 ? (
            <EmailToTaskCard
              projects={inboundEmailProjects}
              inboundDomain={inboundDomain}
            />
          ) : null}

          <IntegrationsList initial={integrations} />
        </div>
      </div>
    </div>
  )
}
