'use server'

/**
 * Wave R5 Extended · US R5E-Marketplace — Server actions del marketplace.
 *
 * Responsabilidades:
 *   1. CRUD de `IntegrationInstall` validado contra `INTEGRATION_PROVIDERS`.
 *   2. RBAC: sólo OWNER/ADMIN del workspace puede instalar/desconectar.
 *   3. Audit + revalidate.
 *   4. Validación específica de provider (ping a Slack `auth.test`, fetch
 *      del repo GitHub para verificar token).
 *
 * Convenciones:
 *   - Errores tipados `[FORBIDDEN] | [INVALID_INPUT] | [INSTALL_NOT_FOUND] | [EXTERNAL_API_ERROR] | [PROVIDER_NOT_FOUND]`.
 *   - `withMetrics('action.marketplace.<verb>', …)`.
 *   - `recordAuditEventSafe` best-effort tras cada mutación.
 *   - Cualquier valor compartido que no sea async vive en
 *     `src/lib/integrations/shared.ts` (regla PR #278).
 */

import { revalidatePath } from 'next/cache'
import { Prisma, type IntegrationStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { requireWorkspaceManager } from '@/lib/auth/check-workspace-access'
import { withMetrics } from '@/lib/observability/metrics'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  INTEGRATION_PROVIDERS,
  getProvider,
  type SlackInstallConfig,
  type GithubInstallConfig,
} from '@/lib/integrations/registry'
import { pingSlackToken } from '@/lib/integrations/slack-marketplace'
import { fetchIssue } from '@/lib/integrations/github-client'

// ───────────────────── Helpers (re-export friendly) ─────────────────────

function marketplaceError(code: string, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────── Tipos serializables ─────────────────────

export interface SerializedIntegrationInstall {
  id: string
  workspaceId: string
  providerKey: string
  providerName: string
  status: IntegrationStatus
  config: unknown
  installedById: string | null
  installedAt: string
  lastUsedAt: string | null
  consecutiveFailures: number
}

function serialize(row: {
  id: string
  workspaceId: string
  providerKey: string
  status: IntegrationStatus
  config: Prisma.JsonValue
  installedById: string | null
  installedAt: Date
  lastUsedAt: Date | null
  consecutiveFailures: number
}): SerializedIntegrationInstall {
  const provider = getProvider(row.providerKey)
  // Redactamos campos sensibles antes de devolver al cliente — el config
  // contiene tokens (`botToken`, `token`, `webhookSecret`).
  const config = redactConfigForClient(row.config)
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    providerKey: row.providerKey,
    providerName: provider?.name ?? row.providerKey,
    status: row.status,
    config,
    installedById: row.installedById,
    installedAt: row.installedAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    consecutiveFailures: row.consecutiveFailures,
  }
}

/**
 * Redacta tokens y secretos en el config antes de devolverlo al cliente
 * — la UI no necesita el token raw, sólo si está configurado y los campos
 * "públicos" como `defaultChannel` / `defaultRepo` / `events`.
 */
function redactConfigForClient(config: Prisma.JsonValue): unknown {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return config
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    if (/token|secret/i.test(k)) {
      out[k] = typeof v === 'string' && v.length > 0 ? '[REDACTED]' : null
    } else {
      out[k] = v
    }
  }
  return out
}

// ───────────────────── Server actions ─────────────────────

/**
 * Lista todos los installs de un workspace. Devuelve [] si la migración no
 * está aplicada aún (la UI cae en estado vacío sin romperse — mismo patrón
 * que `/settings/integrations` con la tabla `Integration` legacy).
 */
export async function listIntegrationInstalls(
  workspaceId: string,
): Promise<SerializedIntegrationInstall[]> {
  return withMetrics('action.marketplace.list', async () => {
    if (!workspaceId) marketplaceError('INVALID_INPUT', 'workspaceId requerido')
    // No requerimos ADMIN para leer — cualquier miembro del WS puede ver
    // qué integraciones están conectadas (es metadata pública del WS).
    const user = await getCurrentUser()
    if (!user) marketplaceError('FORBIDDEN', 'sesión requerida')

    try {
      const rows = await prisma.integrationInstall.findMany({
        where: { workspaceId },
        orderBy: { installedAt: 'asc' },
      })
      return rows.map(serialize)
    } catch (e) {
      // Migración pendiente (tabla no existe) → array vacío para no
      // romper la UI. La consola hace el log para que ops vea el motivo.
      console.warn('[Marketplace] listIntegrationInstalls failed:', (e as Error).message)
      return []
    }
  })
}

/**
 * Devuelve el install activo (`status != DISCONNECTED`) de un (workspace, provider)
 * o `null`. Usado por la UI para detectar si una integración está conectada.
 */
export async function getIntegrationInstall(input: {
  workspaceId: string
  providerKey: string
}): Promise<SerializedIntegrationInstall | null> {
  return withMetrics('action.marketplace.get', async () => {
    if (!input.workspaceId || !input.providerKey) {
      marketplaceError('INVALID_INPUT', 'workspaceId y providerKey requeridos')
    }
    try {
      const row = await prisma.integrationInstall.findUnique({
        where: {
          workspaceId_providerKey: {
            workspaceId: input.workspaceId,
            providerKey: input.providerKey,
          },
        },
      })
      return row ? serialize(row) : null
    } catch {
      return null
    }
  })
}

export interface InstallIntegrationInput {
  workspaceId: string
  providerKey: string
  config: Record<string, unknown>
}

/**
 * Instala (o reinstala) una integración. Valida el config con el zod del
 * provider y, para Slack/GitHub, hace un ping a la API externa para
 * verificar que el token es válido antes de persistir.
 *
 * RBAC: requiere OWNER/ADMIN del workspace (o ADMIN/SUPER_ADMIN global).
 */
export async function installIntegration(
  input: InstallIntegrationInput,
): Promise<SerializedIntegrationInstall> {
  return withMetrics('action.marketplace.install', async () => {
    if (!input.workspaceId || !input.providerKey) {
      marketplaceError('INVALID_INPUT', 'workspaceId y providerKey requeridos')
    }
    const provider = getProvider(input.providerKey)
    if (!provider) {
      marketplaceError(
        'PROVIDER_NOT_FOUND',
        `provider "${input.providerKey}" no existe en el catálogo`,
      )
    }
    // RBAC: sólo manager del workspace puede instalar.
    const { user } = await requireWorkspaceManager(input.workspaceId)

    // Validación zod del config — el provider define qué shape acepta.
    const parsed = provider.configSchema.safeParse(input.config)
    if (!parsed.success) {
      marketplaceError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      )
    }
    const config = parsed.data as Record<string, unknown>

    // Ping al provider para validar token antes de persistir. Si la API
    // externa rechaza, fail fast con `[EXTERNAL_API_ERROR]`.
    if (input.providerKey === 'slack') {
      const cfg = config as SlackInstallConfig
      const ping = await pingSlackToken(cfg.botToken)
      if (!ping.ok) {
        marketplaceError(
          'EXTERNAL_API_ERROR',
          `Slack rechazó el token: ${ping.error}`,
        )
      }
    } else if (input.providerKey === 'github') {
      const cfg = config as GithubInstallConfig
      // Trick: pedimos la issue #1 sólo para validar el token + repo. Si
      // el repo no tiene issue #1 igual la API devuelve 404 vs 401, y
      // sólo nos importa el 401/403 para detectar token inválido.
      const ping = await fetchIssue(cfg, { repoFullName: cfg.defaultRepo, issueNumber: 1 })
      if (!ping.ok && (ping.status === 401 || ping.status === 403)) {
        marketplaceError(
          'EXTERNAL_API_ERROR',
          `GitHub rechazó el token (HTTP ${ping.status})`,
        )
      }
      // 404 (no hay issue #1) es OK — significa que el token llegó al repo.
    }

    // Upsert: una install por (workspace, provider). Reinstalar = reset
    // de status/failures + nuevo config.
    const row = await prisma.integrationInstall.upsert({
      where: {
        workspaceId_providerKey: {
          workspaceId: input.workspaceId,
          providerKey: input.providerKey,
        },
      },
      create: {
        workspaceId: input.workspaceId,
        providerKey: input.providerKey,
        config: config as unknown as Prisma.InputJsonValue,
        installedById: user.id,
        status: 'CONNECTED',
        consecutiveFailures: 0,
      },
      update: {
        config: config as unknown as Prisma.InputJsonValue,
        installedById: user.id,
        status: 'CONNECTED',
        consecutiveFailures: 0,
        installedAt: new Date(),
      },
    })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'integration.installed',
      entityType: 'integration_install',
      entityId: row.id,
      metadata: {
        workspaceId: input.workspaceId,
        providerKey: input.providerKey,
      },
    })

    revalidatePath('/settings/integrations')
    return serialize(row)
  })
}

/**
 * Desconecta una integración. La fila no se borra — sólo se marca
 * `DISCONNECTED` para preservar histórico/auditoría. Reinstalar la vuelve
 * a CONNECTED.
 */
export async function disconnectIntegration(input: {
  installId: string
}): Promise<{ id: string }> {
  return withMetrics('action.marketplace.disconnect', async () => {
    if (!input.installId) marketplaceError('INVALID_INPUT', 'installId requerido')
    const row = await prisma.integrationInstall.findUnique({
      where: { id: input.installId },
      select: { id: true, workspaceId: true, providerKey: true },
    })
    if (!row) marketplaceError('INSTALL_NOT_FOUND', `no existe ${input.installId}`)
    const { user } = await requireWorkspaceManager(row.workspaceId)

    await prisma.integrationInstall.update({
      where: { id: row.id },
      data: { status: 'DISCONNECTED' },
    })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'integration.disconnected',
      entityType: 'integration_install',
      entityId: row.id,
      metadata: {
        workspaceId: row.workspaceId,
        providerKey: row.providerKey,
      },
    })

    revalidatePath('/settings/integrations')
    return { id: row.id }
  })
}

/**
 * Devuelve el catálogo de providers (sólo metadata pública, sin zod schemas
 * runtime que no se pueden serializar). UI lo consume para renderizar las
 * cards.
 */
export async function listAvailableProviders(): Promise<
  Array<{
    key: string
    kind: string
    name: string
    description: string
    iconUrl: string
    webhookEvents: string[]
    docsUrl?: string
  }>
> {
  return INTEGRATION_PROVIDERS.map((p) => ({
    key: p.key,
    kind: p.kind,
    name: p.name,
    description: p.description,
    iconUrl: p.iconUrl,
    webhookEvents: [...p.webhookEvents],
    docsUrl: p.docsUrl,
  }))
}
