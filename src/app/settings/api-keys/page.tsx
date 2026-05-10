/**
 * Wave P17-B · Página admin de API Keys v2 (workspace-scoped).
 *
 * NOTA UX: las API Keys v2 son para integraciones empresariales (SAP,
 * Power BI…) y se issuean por workspace. Las "Tokens API v1" siguen vivas
 * en `/settings/api` (legado, user-scoped).
 */

import { ApiKeysAdmin } from '@/components/api-v2/ApiKeysAdmin'
import { listApiKeys, type ApiKeyListItem } from '@/lib/actions/api-keys'

export const dynamic = 'force-dynamic'

export default async function ApiKeysSettingsPage() {
  let keys: ApiKeyListItem[] = []
  try {
    keys = await listApiKeys()
  } catch {
    keys = []
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">API Keys v2</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Credenciales workspace-scoped para integrar Sync con sistemas
            corporativos. Soportan scopes granulares y rate limiting.
          </p>
        </div>
        <a
          href="/docs/api-v2/openapi.yaml"
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-subtle"
        >
          OpenAPI v2
        </a>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <ApiKeysAdmin initialKeys={keys} />
        </div>
      </div>
    </div>
  )
}
