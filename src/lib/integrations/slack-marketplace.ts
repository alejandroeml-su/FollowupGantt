/**
 * Wave R5 Extended · US R5E-Marketplace · Cliente Slack.
 *
 * Diferente del `slack.ts` (Ola P4 · webhooks legacy):
 *   - P4 usa Slack Incoming Webhooks (sin OAuth, URL es el secreto).
 *   - R5E usa Slack Bot Tokens (`xoxb-…`) llamando `chat.postMessage` y
 *     `auth.test` para validar al instalar.
 *
 * Mantengo módulos separados para no romper a los callers P4 existentes
 * (`dispatchSlackNotification(integrationId, …)` sigue funcionando contra
 * la tabla `Integration` heredada).
 *
 * Errores tipados:
 *   - `[EXTERNAL_API_ERROR]` cuando Slack devuelve `ok=false` o HTTP no-2xx.
 *   - `[INVALID_INPUT]`      cuando faltan campos requeridos.
 */

import type { SlackInstallConfig } from './registry'

const SLACK_API_BASE = 'https://slack.com/api'

export interface SlackPostMessageInput {
  /** Texto fallback (mobile push, clientes sin Block Kit). */
  text: string
  /** Override del canal (default = `config.defaultChannel`). */
  channel?: string
  /** Blocks opcionales — máx 50 según docs Slack. */
  blocks?: Array<Record<string, unknown>>
}

export interface SlackApiResult {
  ok: boolean
  error?: string
  /** TS del mensaje cuando ok=true (útil para hilos en R6+). */
  ts?: string
}

/**
 * Llama `auth.test` para validar que un Bot Token es válido. Devuelve el
 * team + user-id del bot cuando ok. Útil para mostrar feedback en la UI
 * al instalar la integración.
 */
export async function pingSlackToken(
  botToken: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; team: string; botUserId: string } | { ok: false; error: string }> {
  if (!botToken || !botToken.startsWith('xoxb-')) {
    return { ok: false, error: 'Token inválido (debe empezar con xoxb-)' }
  }
  let res: Response
  try {
    res = await fetcher(`${SLACK_API_BASE}/auth.test`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
  } catch (e) {
    return { ok: false, error: `network error: ${(e as Error).message}` }
  }
  let json: Record<string, unknown>
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, error: `non-JSON response (HTTP ${res.status})` }
  }
  if (json.ok !== true) {
    return {
      ok: false,
      error: typeof json.error === 'string' ? json.error : 'auth_test_failed',
    }
  }
  return {
    ok: true,
    team: typeof json.team === 'string' ? json.team : 'unknown',
    botUserId: typeof json.user_id === 'string' ? json.user_id : 'unknown',
  }
}

/**
 * Publica un mensaje en Slack vía `chat.postMessage`. NUNCA lanza —
 * convierte cualquier fallo en `{ ok: false, error }` para que el caller
 * (dispatcher del marketplace) actualice `consecutiveFailures` sin romper
 * el flujo principal.
 */
export async function postSlackMessage(
  config: SlackInstallConfig,
  message: SlackPostMessageInput,
  fetcher: typeof fetch = fetch,
): Promise<SlackApiResult> {
  const channel = message.channel ?? config.defaultChannel
  if (!channel) {
    return { ok: false, error: 'channel_missing' }
  }
  // Slack acepta canales con o sin `#`. Normalizamos: si empieza con `#`
  // lo dejamos así (Slack lo resuelve), si no, lo prefijamos para canales
  // públicos. Para IDs `C…`/`G…` el caller debe pasarlos tal cual.
  const channelArg =
    channel.startsWith('C') ||
    channel.startsWith('G') ||
    channel.startsWith('#') ||
    channel.startsWith('@')
      ? channel
      : `#${channel}`
  const payload: Record<string, unknown> = {
    channel: channelArg,
    text: message.text,
  }
  if (message.blocks && message.blocks.length > 0) {
    payload.blocks = message.blocks
  }

  let res: Response
  try {
    res = await fetcher(`${SLACK_API_BASE}/chat.postMessage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    return { ok: false, error: `network error: ${(e as Error).message}` }
  }
  let json: Record<string, unknown>
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    return { ok: false, error: `non-JSON response (HTTP ${res.status})` }
  }
  if (json.ok !== true) {
    return {
      ok: false,
      error: typeof json.error === 'string' ? json.error : 'chat_postMessage_failed',
    }
  }
  return {
    ok: true,
    ts: typeof json.ts === 'string' ? json.ts : undefined,
  }
}

/**
 * Constructor de mensajes estándar para los eventos del marketplace.
 * Devuelve { text, blocks } listo para `postSlackMessage`.
 */
export function buildEventMessage(input: {
  event: 'task.created' | 'task.completed' | 'task.assigned' | 'risk.created'
  title: string
  projectName?: string
  detail?: string
  assigneeName?: string
  url?: string
}): SlackPostMessageInput {
  const headerByEvent: Record<typeof input.event, string> = {
    'task.created': 'Nueva tarea creada',
    'task.completed': 'Tarea completada',
    'task.assigned': 'Tarea asignada',
    'risk.created': 'Riesgo nuevo identificado',
  }
  const header = headerByEvent[input.event]
  const lines: string[] = [`*${input.title}*`]
  if (input.projectName) lines.push(`Proyecto: ${input.projectName}`)
  if (input.assigneeName) lines.push(`Asignada a: ${input.assigneeName}`)
  if (input.detail) lines.push(input.detail)
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: header, emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    },
  ]
  if (input.url) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Abrir en Sync' },
          url: input.url,
        },
      ],
    })
  }
  return {
    text: `${header}: ${input.title}`,
    blocks,
  }
}
