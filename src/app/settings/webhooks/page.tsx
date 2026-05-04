/**
 * Página admin de Webhooks (Ola P4 · Equipo P4-2).
 *
 * Lista los Webhook del usuario autenticado y permite crear, pausar, reanudar
 * o eliminar. Strings UI en español: "Webhooks", "Crear webhook", "Eventos".
 */

import { WebhooksAdmin } from '@/components/api/WebhooksAdmin'
import { listWebhooksForUser, type WebhookListItem } from '@/lib/actions/webhooks'

export const dynamic = 'force-dynamic'

export default async function WebhooksSettingsPage() {
  let webhooks: WebhookListItem[] = []
  try {
    webhooks = await listWebhooksForUser()
  } catch {
    webhooks = []
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Webhooks</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Recibe notificaciones HTTP firmadas con HMAC SHA-256 cuando ocurren
            eventos en FollowupGantt (tareas, baselines, dependencias).
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <WebhooksAdmin initialWebhooks={webhooks} />
        </div>
      </div>
    </div>
  )
}
