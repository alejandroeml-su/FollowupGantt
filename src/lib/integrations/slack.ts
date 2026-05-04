/**
 * Ola P4 · Equipo P4-5 · Integraciones · Slack.
 *
 * Outbound webhook a Slack Incoming Webhooks (Block Kit). El consumidor
 * típico es `dispatchSlackNotification(integrationId, message)` desde otras
 * server actions (createTask, captureBaseline, completeTask…).
 *
 * Reglas de diseño:
 *   - Sin SDK: usamos `fetch` nativo (Node 20 / Edge runtime). NO añadir
 *     `@slack/web-api` ni `@slack/bolt` — la convención del repo es deps
 *     mínimas y los webhooks no requieren OAuth.
 *   - Errores tipados `[INTEGRATION_NOT_FOUND] | [WEBHOOK_FAILED] | [INVALID_CONFIG]`
 *     consistentes con el resto del repo.
 *   - Tolerancia a fallos: el caller NO debe abortar la operación principal
 *     si el webhook falla. El dispatcher devuelve `{ ok: boolean, status, error? }`
 *     y los callers en `actions.ts` lo envuelven en try/catch silencioso.
 *   - `disabled` → no-op silencioso (devuelve `{ ok: true, skipped: true }`).
 *
 * Referencias:
 *   - https://api.slack.com/messaging/webhooks
 *   - https://api.slack.com/block-kit (formato del payload)
 */

import prisma from '@/lib/prisma'

export type SlackErrorCode =
  | 'INTEGRATION_NOT_FOUND'
  | 'WEBHOOK_FAILED'
  | 'INVALID_CONFIG'

export interface SlackBlockKitMessage {
  /** Texto plano fallback (clientes sin Block Kit, notificaciones móviles). */
  text: string
  /** Bloques opcionales — máx 50 por mensaje según docs de Slack. */
  blocks?: Array<Record<string, unknown>>
  /** Override opcional del canal (Slack lo respeta solo en webhooks legacy). */
  channel?: string
  /** Username override (icon emoji, etc.) — opcional. */
  username?: string
  iconEmoji?: string
}

export interface SlackDispatchResult {
  ok: boolean
  status?: number
  error?: string
  /** True cuando la integración está deshabilitada y no se intentó la llamada. */
  skipped?: boolean
}

/**
 * Valida el shape de `config` para integraciones Slack. El único campo
 * obligatorio es `webhookUrl` (string http(s) válida). `channel` y demás
 * son opcionales.
 *
 * Lanzar con prefijo `[INVALID_CONFIG]` para que la UI capture el error
 * y muestre el mensaje literal al usuario.
 */
export function validateSlackConfig(config: unknown): {
  webhookUrl: string
  channel?: string
} {
  if (!config || typeof config !== 'object') {
    throw new Error('[INVALID_CONFIG] config debe ser un objeto')
  }
  const obj = config as Record<string, unknown>
  const webhookUrl = obj.webhookUrl
  if (typeof webhookUrl !== 'string' || webhookUrl.length === 0) {
    throw new Error('[INVALID_CONFIG] webhookUrl es obligatorio')
  }
  if (!/^https?:\/\//i.test(webhookUrl)) {
    throw new Error('[INVALID_CONFIG] webhookUrl debe ser una URL http(s)')
  }
  const channel = typeof obj.channel === 'string' ? obj.channel : undefined
  return { webhookUrl, channel }
}

/**
 * Construye un mensaje Block Kit estándar para los eventos del repo
 * (task_assigned / task_completed / baseline_captured). Los callers
 * pueden enviar mensajes custom directamente con `dispatchSlackNotification`,
 * pero estos helpers homogenizan la apariencia.
 */
export function buildTaskAssignedBlocks(input: {
  taskTitle: string
  assigneeName: string
  projectName?: string
  link?: string
}): SlackBlockKitMessage {
  const text = `Tarea asignada: ${input.taskTitle} → ${input.assigneeName}`
  const fields: Array<{ type: 'mrkdwn'; text: string }> = [
    { type: 'mrkdwn', text: `*Tarea*\n${input.taskTitle}` },
    { type: 'mrkdwn', text: `*Asignada a*\n${input.assigneeName}` },
  ]
  if (input.projectName) {
    fields.push({ type: 'mrkdwn', text: `*Proyecto*\n${input.projectName}` })
  }
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Nueva tarea asignada', emoji: true },
    },
    { type: 'section', fields },
  ]
  if (input.link) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Abrir tarea' },
          url: input.link,
        },
      ],
    })
  }
  return { text, blocks }
}

export function buildTaskCompletedBlocks(input: {
  taskTitle: string
  completedByName?: string
  projectName?: string
  link?: string
}): SlackBlockKitMessage {
  const text = `Tarea completada: ${input.taskTitle}`
  const lines: string[] = [`*${input.taskTitle}*`]
  if (input.projectName) lines.push(`Proyecto: ${input.projectName}`)
  if (input.completedByName) lines.push(`Completada por: ${input.completedByName}`)
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Tarea completada', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    },
  ]
  if (input.link) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Ver detalle' },
          url: input.link,
        },
      ],
    })
  }
  return { text, blocks }
}

export function buildBaselineCapturedBlocks(input: {
  projectName: string
  version: number
  label?: string | null
  link?: string
}): SlackBlockKitMessage {
  const text = `Línea base capturada: ${input.projectName} v${input.version}`
  const lines: string[] = [
    `*${input.projectName}*`,
    `Versión: v${input.version}`,
  ]
  if (input.label) lines.push(`Etiqueta: ${input.label}`)
  const blocks: Array<Record<string, unknown>> = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Línea base capturada', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    },
  ]
  if (input.link) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Abrir proyecto' },
          url: input.link,
        },
      ],
    })
  }
  return { text, blocks }
}

/**
 * Envía un mensaje a Slack vía webhook. Resuelve la integración por id;
 * si está deshabilitada o no es de tipo SLACK, no-op. Cualquier error de
 * red se transforma en `[WEBHOOK_FAILED]` con el `status` HTTP cuando aplica.
 *
 * Permite inyectar un `fetcher` custom en tests (por defecto = global fetch).
 */
export async function dispatchSlackNotification(
  integrationId: string,
  message: SlackBlockKitMessage,
  opts: { fetcher?: typeof fetch } = {},
): Promise<SlackDispatchResult> {
  if (!integrationId) {
    throw new Error('[INTEGRATION_NOT_FOUND] integrationId requerido')
  }
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { id: true, type: true, enabled: true, config: true },
  })
  if (!integration) {
    throw new Error('[INTEGRATION_NOT_FOUND] integración no existe')
  }
  if (integration.type !== 'SLACK') {
    throw new Error('[INVALID_CONFIG] la integración no es de tipo SLACK')
  }
  if (!integration.enabled) {
    return { ok: true, skipped: true }
  }

  const { webhookUrl, channel } = validateSlackConfig(integration.config)

  const payload: Record<string, unknown> = {
    text: message.text,
  }
  if (message.blocks) payload.blocks = message.blocks
  if (message.channel ?? channel) payload.channel = message.channel ?? channel
  if (message.username) payload.username = message.username
  if (message.iconEmoji) payload.icon_emoji = message.iconEmoji

  const fetcher = opts.fetcher ?? fetch
  let res: Response
  try {
    res = await fetcher(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    return {
      ok: false,
      error: `[WEBHOOK_FAILED] ${(e as Error).message ?? 'fetch error'}`,
    }
  }
  if (!res.ok) {
    let body = ''
    try {
      body = await res.text()
    } catch {
      // ignore
    }
    return {
      ok: false,
      status: res.status,
      error: `[WEBHOOK_FAILED] HTTP ${res.status} ${body.slice(0, 200)}`.trim(),
    }
  }
  return { ok: true, status: res.status }
}
