/**
 * Wave P17-B · Página admin de Webhooks v2 (workspace-scoped).
 *
 * El path `/settings/webhooks` está ocupado por el módulo v1 (user-scoped,
 * Wave P4). Las webhooks v2 viven en `/settings/webhooks-v2` para coexistir
 * sin colisión hasta que la deprecación formal de v1 se planifique.
 */

import { WebhookSubscriptionsAdmin } from '@/components/api-v2/WebhookSubscriptionsAdmin'
import {
  listWebhookSubscriptions,
  type WebhookSubListItem,
} from '@/lib/actions/webhook-subscriptions'

export const dynamic = 'force-dynamic'

export default async function WebhooksV2SettingsPage() {
  let subs: WebhookSubListItem[] = []
  try {
    subs = await listWebhookSubscriptions()
  } catch {
    subs = []
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Webhooks v2</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Notificaciones HTTP firmadas (HMAC SHA-256) workspace-scoped con
            retry exponencial 1s · 5s · 30s y auto-disable tras 10 fallos.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <WebhookSubscriptionsAdmin initialSubs={subs} />
        </div>
      </div>
    </div>
  )
}
