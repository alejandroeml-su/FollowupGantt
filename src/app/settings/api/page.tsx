/**
 * Página admin de Tokens API (Ola P4 · Equipo P4-2).
 *
 * Lista los ApiToken del usuario autenticado y permite crear nuevos. El
 * plaintext se muestra UNA SOLA VEZ post-creación con copy-to-clipboard.
 *
 * Strings UI: "Tokens API", "Crear token", "Revocar".
 */

import { ApiTokensAdmin } from '@/components/api/ApiTokensAdmin'
import { listApiTokensForUser, type ApiTokenListItem } from '@/lib/actions/api-tokens'

export const dynamic = 'force-dynamic'

export default async function ApiTokensSettingsPage() {
  let tokens: ApiTokenListItem[] = []
  try {
    tokens = await listApiTokensForUser()
  } catch {
    // Sin sesión / migración pendiente — render vacío con CTA.
    tokens = []
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-subtle/50">
        <div>
          <h1 className="text-xl font-semibold text-white">Tokens API</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Gestiona credenciales para integrar FollowupGantt con scripts, CI o
            servicios externos. Solo se muestran los tokens del usuario actual.
          </p>
        </div>
        <a
          href="/api/v1/openapi.json"
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-subtle"
        >
          OpenAPI 3.0
        </a>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <ApiTokensAdmin initialTokens={tokens} />
        </div>
      </div>
    </div>
  )
}
