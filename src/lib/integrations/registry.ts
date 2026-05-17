/**
 * Wave R5 Extended · US R5E-Marketplace — Catálogo en código de providers.
 *
 * Cada provider es una definición pura (sin estado, sin server actions);
 * el storage real vive en la tabla `IntegrationInstall`. Añadir un provider
 * = agregar una entrada aquí + (opcional) un cliente en `src/lib/integrations/<key>.ts`.
 *
 * El catálogo NO se persiste en BD — eso evita migrar cada vez que añadimos
 * una integración. La validación de config se hace contra el `configSchema`
 * (zod) del provider en el server action `installIntegration`.
 *
 * Decisión: catálogo en código vs tabla provider — el repo es internal SaaS,
 * no hay marketplace público de terceros que necesite registrar providers en
 * runtime. Si llegamos a R6+ con un SDK extern, migrar a tabla `Provider`.
 */

import { z } from 'zod'
import { MARKETPLACE_EVENTS, type MarketplaceEvent } from './shared'

/**
 * Definición de un provider del marketplace. `configSchema` es el zod que
 * valida el shape de `IntegrationInstall.config` cuando el usuario instala.
 *
 * `webhookEvents` declara qué eventos del catálogo `MARKETPLACE_EVENTS` el
 * provider sabe procesar. El dispatcher filtra los installs por estos
 * eventos antes de invocar al cliente del provider.
 */
export interface IntegrationProviderDefinition {
  /** Clave estable lowercase. Sirve como `providerKey` en BD. */
  key: string
  /** Categoría visual ("comms", "code", "design", …). UI agrupa por kind. */
  kind: 'comms' | 'code' | 'design' | 'storage' | 'other'
  /** Nombre humano (es-MX). UI lo muestra en el card. */
  name: string
  /** Descripción corta (1-2 frases, es-MX). */
  description: string
  /** Path bajo `/public` con el icono del provider (24×24 idealmente). */
  iconUrl: string
  /**
   * Zod schema que valida `config` al instalar. Convención: cualquier campo
   * que sea secreto (token, signing-secret) debe llamarse explícitamente
   * `*Token` o `*Secret` para que el sanitizer del audit lo redacte (ver
   * `redactSensitive` en `src/lib/audit/types.ts`).
   */
  configSchema: z.ZodTypeAny
  /**
   * OAuth scopes que el provider necesitaría si activáramos OAuth handshake.
   * Por ahora R5E usa tokens manuales (PAT-style) — esto queda como
   * documentación + base para R6 (OAuth full).
   */
  oauthScopes: readonly string[]
  /** Eventos del marketplace a los que reacciona este provider. */
  webhookEvents: readonly MarketplaceEvent[]
  /**
   * URL de documentación para que el admin sepa cómo generar el token.
   * Se muestra como link en el drawer de configuración.
   */
  docsUrl?: string
}

// ─────────────────────── Slack ───────────────────────
//
// MVP: token manual `xoxb-…` + canal default. Validamos el token contra
// `auth.test` antes de persistir (ver `slack.ts::pingSlackToken`).

const slackConfigSchema = z.object({
  /** Bot User OAuth Token de la Slack App (`xoxb-…`). */
  botToken: z
    .string()
    .min(1, 'Bot Token requerido')
    .regex(/^xoxb-/, 'El token de Slack debe comenzar con "xoxb-"'),
  /** Canal por defecto (`#general`, `#deploy`, …). */
  defaultChannel: z
    .string()
    .min(1, 'Canal default requerido')
    .regex(
      /^#?[a-z0-9._-]+$/,
      'Canal inválido (sólo lowercase, números, ".", "_", "-")',
    ),
  /** Eventos suscritos. Subset de `MARKETPLACE_EVENTS`. */
  events: z
    .array(z.enum(MARKETPLACE_EVENTS))
    .min(1, 'Selecciona al menos un evento')
    .default(['task.assigned', 'task.completed']),
})

export type SlackInstallConfig = z.infer<typeof slackConfigSchema>

const slackProvider: IntegrationProviderDefinition = {
  key: 'slack',
  kind: 'comms',
  name: 'Slack',
  description:
    'Recibe notificaciones de tareas y riesgos en un canal de Slack. Configurable por evento.',
  iconUrl: '/icons/integrations/slack.svg',
  configSchema: slackConfigSchema,
  oauthScopes: ['chat:write', 'channels:read'],
  webhookEvents: [
    'task.created',
    'task.completed',
    'task.assigned',
    'risk.created',
  ],
  docsUrl: 'https://api.slack.com/authentication/token-types#bot',
}

// ─────────────────────── GitHub ───────────────────────
//
// MVP: Personal Access Token + repo (`owner/name`). Vincula tareas a issues
// y comenta en el issue cuando la tarea pasa a DONE.

const githubConfigSchema = z.object({
  /** Personal Access Token (`ghp_…` o `github_pat_…`). */
  token: z
    .string()
    .min(1, 'Token requerido')
    .regex(
      /^(ghp_|github_pat_|ghs_)/,
      'El token debe comenzar con "ghp_", "github_pat_" o "ghs_"',
    ),
  /** Repo default `owner/name` (puede sobreescribirse al vincular). */
  defaultRepo: z
    .string()
    .min(1, 'Repo requerido')
    .regex(
      /^[A-Za-z0-9](?:[A-Za-z0-9-_.]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9-_.]*[A-Za-z0-9])?$/,
      'Formato esperado: "owner/repo"',
    ),
  /**
   * Secret HMAC opcional para validar webhooks inbound. Si está vacío, el
   * endpoint `/api/v1/integrations/github/webhook` rechaza todo (modo seguro).
   */
  webhookSecret: z.string().optional(),
})

export type GithubInstallConfig = z.infer<typeof githubConfigSchema>

const githubProvider: IntegrationProviderDefinition = {
  key: 'github',
  kind: 'code',
  name: 'GitHub',
  description:
    'Vincula tareas a issues/PRs de GitHub y comenta automáticamente en el issue cuando la tarea se cierra.',
  iconUrl: '/icons/integrations/github.svg',
  configSchema: githubConfigSchema,
  oauthScopes: ['repo:read', 'repo:write'],
  webhookEvents: ['task.completed'],
  docsUrl:
    'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
}

// ─────────────────────── Catálogo ───────────────────────

/**
 * Lista canónica de providers expuestos en `/settings/integrations`. El
 * orden refleja prioridad de uso (Slack > GitHub > futuros). Mantén Slack
 * primero porque es el caso de uso #1 reportado por Edwin.
 */
export const INTEGRATION_PROVIDERS: readonly IntegrationProviderDefinition[] = [
  slackProvider,
  githubProvider,
]

/**
 * Lookup O(n) — el catálogo tiene < 10 providers; un Map sería over-engineering.
 * Lanza si no existe para forzar al caller a manejar el caso (UI muestra
 * "provider desconocido").
 */
export function getProvider(
  key: string,
): IntegrationProviderDefinition | undefined {
  return INTEGRATION_PROVIDERS.find((p) => p.key === key)
}

/**
 * Devuelve el subset de providers cuya `webhookEvents` incluye `event`.
 * Usado por el dispatcher para no scanear todos los installs por evento.
 */
export function providersForEvent(
  event: MarketplaceEvent,
): readonly IntegrationProviderDefinition[] {
  return INTEGRATION_PROVIDERS.filter((p) => p.webhookEvents.includes(event))
}
