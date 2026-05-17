/**
 * Wave R5 Extended · US R5E-Marketplace · Dispatcher de eventos.
 *
 * Entrada única para que el resto del sistema notifique al marketplace.
 * Patrón best-effort: NUNCA lanza al caller (que típicamente es un server
 * action `createTask`/`updateTask`). Cualquier fallo:
 *
 *   1. console.warn con detalle del provider + evento.
 *   2. Incrementa `consecutiveFailures` del install.
 *   3. Si llega a `CONSECUTIVE_FAILURES_THRESHOLD`, marca el install `ERROR`.
 *   4. Emite audit `integration.delivery_failed` (best-effort).
 *
 * El dispatcher NO se encarga de saber qué provider hace qué — itera sobre
 * los installs CONNECTED del workspace cuyo provider declara el evento en
 * `webhookEvents` y delega al cliente específico.
 */

import 'server-only'
import prisma from '@/lib/prisma'
import { providersForEvent } from './registry'
import {
  MARKETPLACE_EVENTS,
  CONSECUTIVE_FAILURES_THRESHOLD,
  buildTaskUrl,
  type MarketplaceEvent,
} from './shared'
import {
  postSlackMessage,
  buildEventMessage,
  type SlackPostMessageInput,
} from './slack-marketplace'
import {
  postIssueComment,
  type GithubApiResult,
} from './github-client'
import { recordAuditEventSafe } from '@/lib/audit/events'
import type { SlackInstallConfig, GithubInstallConfig } from './registry'
import type { Prisma } from '@prisma/client'

/**
 * Payload genérico para cualquier evento del marketplace. Los providers
 * pickean los campos que les interesan. `taskId` + `projectId` + `workspaceId`
 * son la trinidad mínima; el resto es opcional/contextual.
 */
export interface MarketplaceEventPayload {
  workspaceId: string
  event: MarketplaceEvent
  taskId?: string
  projectId?: string
  /** Título humano del recurso (tarea, riesgo, …). */
  title: string
  projectName?: string
  assigneeName?: string
  detail?: string
  /** Para `task.completed`: la tarea cambió a este status (usado por GitHub). */
  newStatus?: string
}

/**
 * Hook principal — invocado desde los server actions relevantes.
 *
 * Ejemplo de uso (en `createTask`):
 *   await dispatchMarketplaceEvent({
 *     workspaceId, event: 'task.created',
 *     taskId, projectId, title, projectName,
 *   }).catch(() => undefined)
 */
export async function dispatchMarketplaceEvent(
  payload: MarketplaceEventPayload,
): Promise<void> {
  if (!MARKETPLACE_EVENTS.includes(payload.event)) {
    console.warn(`[Marketplace] evento desconocido: ${payload.event}`)
    return
  }
  if (!payload.workspaceId) return

  // Providers que escuchan este evento según el catálogo.
  const candidates = providersForEvent(payload.event)
  if (candidates.length === 0) return

  let installs: Array<{
    id: string
    providerKey: string
    config: Prisma.JsonValue
    consecutiveFailures: number
  }> = []
  try {
    installs = await prisma.integrationInstall.findMany({
      where: {
        workspaceId: payload.workspaceId,
        status: 'CONNECTED',
        providerKey: { in: candidates.map((c) => c.key) },
      },
      select: {
        id: true,
        providerKey: true,
        config: true,
        consecutiveFailures: true,
      },
    })
  } catch (e) {
    // Migración pendiente o tabla inexistente — silenciosamente no-op.
    console.warn('[Marketplace] dispatch lookup failed:', (e as Error).message)
    return
  }

  for (const install of installs) {
    try {
      await deliverToProvider(install, payload)
    } catch (err) {
      // Defensivo de último nivel — `deliverToProvider` ya hace su propio
      // try/catch interno, pero blindamos por si un await sin red eleva.
      console.warn(
        `[Marketplace] delivery threw for ${install.providerKey}:`,
        (err as Error).message,
      )
    }
  }
}

/**
 * Suscriptor concreto por provider. Resultado `{ ok, error? }`:
 *   - ok=true  → reset consecutiveFailures + bump lastUsedAt.
 *   - ok=false → increment + maybe-mark ERROR + audit delivery_failed.
 */
async function deliverToProvider(
  install: {
    id: string
    providerKey: string
    config: Prisma.JsonValue
    consecutiveFailures: number
  },
  payload: MarketplaceEventPayload,
): Promise<void> {
  let result: { ok: boolean; error?: string }

  if (install.providerKey === 'slack') {
    result = await deliverSlack(install.config, payload)
  } else if (install.providerKey === 'github') {
    result = await deliverGithub(install, payload)
  } else {
    // Provider del catálogo sin cliente implementado — no-op.
    return
  }

  if (result.ok) {
    await prisma.integrationInstall
      .update({
        where: { id: install.id },
        data: { lastUsedAt: new Date(), consecutiveFailures: 0 },
      })
      .catch((e) => {
        console.warn('[Marketplace] persist success failed:', (e as Error).message)
      })
  } else {
    const newFailures = install.consecutiveFailures + 1
    const shouldMarkError = newFailures >= CONSECUTIVE_FAILURES_THRESHOLD
    await prisma.integrationInstall
      .update({
        where: { id: install.id },
        data: {
          consecutiveFailures: newFailures,
          status: shouldMarkError ? 'ERROR' : 'CONNECTED',
        },
      })
      .catch((e) => {
        console.warn('[Marketplace] persist failure failed:', (e as Error).message)
      })
    console.warn(
      `[Marketplace] delivery failed (${install.providerKey} · ${payload.event}): ${result.error ?? 'unknown'} · failures=${newFailures}`,
    )
    await recordAuditEventSafe({
      action: 'integration.delivery_failed',
      entityType: 'integration_install',
      entityId: install.id,
      metadata: {
        providerKey: install.providerKey,
        event: payload.event,
        error: result.error ?? null,
        consecutiveFailures: newFailures,
        markedError: shouldMarkError,
      },
    })
  }
}

// ─────────────────── Adapters por provider ───────────────────

async function deliverSlack(
  configJson: Prisma.JsonValue,
  payload: MarketplaceEventPayload,
): Promise<{ ok: boolean; error?: string }> {
  if (!configJson || typeof configJson !== 'object' || Array.isArray(configJson)) {
    return { ok: false, error: 'invalid_config' }
  }
  const cfg = configJson as unknown as SlackInstallConfig
  // Respeta la suscripción de eventos del install — Slack manda sólo lo
  // que el admin marcó al instalar.
  if (!cfg.events || !cfg.events.includes(payload.event)) {
    return { ok: true } // skipped, no es un fallo real
  }
  const url = payload.taskId ? buildTaskUrl(payload.taskId) : undefined
  const slackEvent = payload.event as Parameters<typeof buildEventMessage>[0]['event']
  const message: SlackPostMessageInput = buildEventMessage({
    event: slackEvent,
    title: payload.title,
    projectName: payload.projectName,
    assigneeName: payload.assigneeName,
    detail: payload.detail,
    url,
  })
  return postSlackMessage(cfg, message)
}

async function deliverGithub(
  install: { config: Prisma.JsonValue },
  payload: MarketplaceEventPayload,
): Promise<{ ok: boolean; error?: string }> {
  // GitHub sólo reacciona a `task.completed` y sólo si la tarea tiene
  // `externalRefs.github` (link a issue). Si no hay link, no es un fallo,
  // simplemente no aplica.
  if (payload.event !== 'task.completed') return { ok: true }
  if (!payload.taskId) return { ok: true }

  if (!install.config || typeof install.config !== 'object' || Array.isArray(install.config)) {
    return { ok: false, error: 'invalid_config' }
  }
  const cfg = install.config as unknown as GithubInstallConfig

  let externalRefs: Prisma.JsonValue | null = null
  try {
    const task = await prisma.task.findUnique({
      where: { id: payload.taskId },
      select: { externalRefs: true },
    })
    externalRefs = task?.externalRefs ?? null
  } catch {
    return { ok: false, error: 'task_lookup_failed' }
  }
  if (!externalRefs || typeof externalRefs !== 'object' || Array.isArray(externalRefs)) {
    return { ok: true } // tarea sin link a GitHub → no aplica
  }
  const gh = (externalRefs as Record<string, unknown>).github as
    | { issueNumber?: number; repoFullName?: string; url?: string }
    | undefined
  if (!gh || !gh.issueNumber) return { ok: true }

  const url = payload.taskId ? buildTaskUrl(payload.taskId) : ''
  const body = `Cerrado desde Sync — [ver tarea](${url})`
  const res: GithubApiResult = await postIssueComment(cfg, {
    repoFullName: gh.repoFullName,
    issueNumber: gh.issueNumber,
    body,
  })
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'github_post_failed' }
}
