import { listTemplates } from '@/lib/actions/templates'
import { TemplatesPageClient } from './TemplatesPageClient'

/**
 * Ola P2 · Equipo P2-3 — Página /templates (Templates + Recurrencia).
 *
 * Server component: fetch inicial de templates accesibles. Delega la
 * UX (crear, editar, instanciar, configurar recurrencia) al cliente.
 */
export default async function TemplatesPage() {
  const templates = await listTemplates({ includeGlobal: true })
  return (
    <TemplatesPageClient
      initialTemplates={templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        projectId: t.projectId,
        isShared: t.isShared,
        // taskShape se serializa para el cliente
        taskShape: t.taskShape as Record<string, unknown>,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  )
}

export const metadata = {
  title: 'Templates · FollowupGantt',
  description: 'Plantillas reutilizables y tareas recurrentes',
}
