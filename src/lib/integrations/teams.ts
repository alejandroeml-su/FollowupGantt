/**
 * Ola P4 · Equipo P4-5 · Integraciones · Microsoft Teams.
 *
 * Outbound webhook a un canal Teams vía Incoming Webhook (formato Adaptive
 * Card v1.4 envuelto en `attachments`). El consumidor típico es
 * `dispatchTeamsCard(integrationId, card)` desde otras server actions.
 *
 * Reglas de diseño (mismas que Slack):
 *   - Sin SDK; usamos `fetch` nativo.
 *   - Errores tipados `[INTEGRATION_NOT_FOUND] | [WEBHOOK_FAILED] | [INVALID_CONFIG]`.
 *   - Tolerancia a fallos: `dispatch*` devuelve `{ ok, status, error? }`.
 *   - `disabled` ⇒ `{ ok: true, skipped: true }`.
 *
 * Referencias:
 *   - https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
 *   - https://adaptivecards.io/explorer/ (schema 1.4)
 */

import prisma from '@/lib/prisma'

export type TeamsErrorCode =
  | 'INTEGRATION_NOT_FOUND'
  | 'WEBHOOK_FAILED'
  | 'INVALID_CONFIG'

/**
 * Estructura mínima de un Adaptive Card v1.4. Aceptamos `unknown[]` en
 * `body` y `actions` para no acoplar el repo al schema completo, pero el
 * helper `buildTaskAssignedCard` usa elementos canónicos `TextBlock` y
 * `Action.OpenUrl`.
 */
export interface AdaptiveCard {
  type: 'AdaptiveCard'
  version: string
  body: Array<Record<string, unknown>>
  actions?: Array<Record<string, unknown>>
  $schema?: string
}

export interface TeamsDispatchResult {
  ok: boolean
  status?: number
  error?: string
  skipped?: boolean
}

export function validateTeamsConfig(config: unknown): {
  webhookUrl: string
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
  return { webhookUrl }
}

/** Helper Adaptive Card v1.4: tarea asignada. */
export function buildTaskAssignedCard(input: {
  taskTitle: string
  assigneeName: string
  projectName?: string
  link?: string
}): AdaptiveCard {
  const facts: Array<{ title: string; value: string }> = [
    { title: 'Tarea', value: input.taskTitle },
    { title: 'Asignada a', value: input.assigneeName },
  ]
  if (input.projectName) {
    facts.push({ title: 'Proyecto', value: input.projectName })
  }
  const body: Array<Record<string, unknown>> = [
    {
      type: 'TextBlock',
      text: 'Nueva tarea asignada',
      weight: 'Bolder',
      size: 'Medium',
    },
    { type: 'FactSet', facts },
  ]
  const actions: Array<Record<string, unknown>> = []
  if (input.link) {
    actions.push({
      type: 'Action.OpenUrl',
      title: 'Abrir tarea',
      url: input.link,
    })
  }
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    actions: actions.length ? actions : undefined,
  }
}

export function buildTaskCompletedCard(input: {
  taskTitle: string
  completedByName?: string
  projectName?: string
  link?: string
}): AdaptiveCard {
  const facts: Array<{ title: string; value: string }> = [
    { title: 'Tarea', value: input.taskTitle },
  ]
  if (input.projectName) facts.push({ title: 'Proyecto', value: input.projectName })
  if (input.completedByName) {
    facts.push({ title: 'Completada por', value: input.completedByName })
  }
  const body: Array<Record<string, unknown>> = [
    {
      type: 'TextBlock',
      text: 'Tarea completada',
      weight: 'Bolder',
      size: 'Medium',
      color: 'Good',
    },
    { type: 'FactSet', facts },
  ]
  const actions: Array<Record<string, unknown>> = []
  if (input.link) {
    actions.push({
      type: 'Action.OpenUrl',
      title: 'Ver detalle',
      url: input.link,
    })
  }
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    actions: actions.length ? actions : undefined,
  }
}

export function buildBaselineCapturedCard(input: {
  projectName: string
  version: number
  label?: string | null
  link?: string
}): AdaptiveCard {
  const facts: Array<{ title: string; value: string }> = [
    { title: 'Proyecto', value: input.projectName },
    { title: 'Versión', value: `v${input.version}` },
  ]
  if (input.label) facts.push({ title: 'Etiqueta', value: input.label })
  const body: Array<Record<string, unknown>> = [
    {
      type: 'TextBlock',
      text: 'Línea base capturada',
      weight: 'Bolder',
      size: 'Medium',
    },
    { type: 'FactSet', facts },
  ]
  const actions: Array<Record<string, unknown>> = []
  if (input.link) {
    actions.push({
      type: 'Action.OpenUrl',
      title: 'Abrir proyecto',
      url: input.link,
    })
  }
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    actions: actions.length ? actions : undefined,
  }
}

/**
 * Envía un Adaptive Card a Teams. Lo envuelve en el payload "attachments"
 * que MS Teams Incoming Webhook espera para v1.4+.
 */
export async function dispatchTeamsCard(
  integrationId: string,
  card: AdaptiveCard,
  opts: { fetcher?: typeof fetch } = {},
): Promise<TeamsDispatchResult> {
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
  if (integration.type !== 'TEAMS') {
    throw new Error('[INVALID_CONFIG] la integración no es de tipo TEAMS')
  }
  if (!integration.enabled) {
    return { ok: true, skipped: true }
  }

  const { webhookUrl } = validateTeamsConfig(integration.config)

  // Wrapping requerido por el connector de Teams para Adaptive Cards.
  const payload = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: card,
      },
    ],
  }

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
