'use server'

/**
 * Ola P4 · Equipo P4-5 · Server actions de integraciones externas.
 *
 * Entrada pública para CRUD de `Integration` (Slack/Teams/GitHub) y
 * gestión de `TaskGitHubLink`. El dispatching real (POST a webhooks) vive
 * en `src/lib/integrations/{slack,teams,github}.ts`. Este archivo orquesta
 * la persistencia y proxy-llama a los dispatchers cuando el caller invoca
 * `testIntegrationWebhook`.
 *
 * Convenciones del repo:
 *   - Errores tipados `[INTEGRATION_NOT_FOUND] | [WEBHOOK_FAILED] | [INVALID_CONFIG]`.
 *   - Strings UI en español ("Integraciones", "Probar webhook", …).
 *   - Validación zod por type. `config` se acepta como `Record<string,unknown>`
 *     y se valida contra schemas específicos vía dispatch sobre `type`.
 *   - `revalidatePath` de `/settings/integrations` tras mutar.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma, type IntegrationType } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  validateSlackConfig,
  dispatchSlackNotification,
  type SlackBlockKitMessage,
} from '@/lib/integrations/slack'
import {
  validateTeamsConfig,
  dispatchTeamsCard,
  type AdaptiveCard,
} from '@/lib/integrations/teams'
import {
  validateGitHubConfig,
  parseGitHubReference,
  validateRepoFullName,
  validateIssueNumber,
} from '@/lib/integrations/github'

// ───────────────────────── Errores tipados ─────────────────────────

export type IntegrationErrorCode =
  | 'INTEGRATION_NOT_FOUND'
  | 'WEBHOOK_FAILED'
  | 'INVALID_CONFIG'
  | 'INVALID_INPUT'
  | 'TASK_NOT_FOUND'
  | 'LINK_DUPLICATED'

function actionError(code: IntegrationErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const integrationTypeEnum = z.enum(['SLACK', 'TEAMS', 'GITHUB'])

const createIntegrationSchema = z.object({
  type: integrationTypeEnum,
  name: z.string().min(1).max(80),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
  projectId: z.string().min(1).nullish(),
})

export type CreateIntegrationInput = z.input<typeof createIntegrationSchema>

const updateIntegrationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
  projectId: z.string().min(1).nullish(),
})

export type UpdateIntegrationInput = z.input<typeof updateIntegrationSchema>

// ───────────────────────── Helpers ─────────────────────────

function validateConfigByType(
  type: IntegrationType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  // Cada validator lanza `[INVALID_CONFIG]` con detalle si el shape es inválido.
  // Devolvemos el config "saneado" (los validators podrían normalizar campos).
  switch (type) {
    case 'SLACK': {
      const v = validateSlackConfig(config)
      return { ...config, webhookUrl: v.webhookUrl, channel: v.channel }
    }
    case 'TEAMS': {
      const v = validateTeamsConfig(config)
      return { ...config, webhookUrl: v.webhookUrl }
    }
    case 'GITHUB': {
      const v = validateGitHubConfig(config)
      return { ...config, ...v }
    }
    default:
      // Sanity guard; el zod ya restringe el enum.
      actionError('INVALID_CONFIG', `tipo desconocido: ${type as string}`)
  }
}

function revalidateIntegrationsRoutes() {
  revalidatePath('/settings/integrations')
}

// ───────────────────────── Serialización ─────────────────────────

export type SerializedIntegration = {
  id: string
  type: IntegrationType
  name: string
  config: Prisma.JsonValue
  enabled: boolean
  projectId: string | null
  createdAt: string
  updatedAt: string
}

function serialize(row: {
  id: string
  type: IntegrationType
  name: string
  config: Prisma.JsonValue
  enabled: boolean
  projectId: string | null
  createdAt: Date
  updatedAt: Date
}): SerializedIntegration {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    config: row.config,
    enabled: row.enabled,
    projectId: row.projectId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ───────────────────────── Server actions: Integration CRUD ─────────────────────────

/** Lista todas las integraciones del workspace (globales + de cada proyecto). */
export async function listIntegrations(opts: {
  projectId?: string | null
} = {}): Promise<SerializedIntegration[]> {
  const where =
    opts.projectId !== undefined && opts.projectId !== null
      ? { projectId: opts.projectId }
      : undefined
  const rows = await prisma.integration.findMany({
    where,
    orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(serialize)
}

export async function getIntegration(id: string): Promise<SerializedIntegration> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  const row = await prisma.integration.findUnique({ where: { id } })
  if (!row) actionError('INTEGRATION_NOT_FOUND', `no existe ${id}`)
  return serialize(row)
}

export async function createIntegration(
  input: CreateIntegrationInput,
): Promise<SerializedIntegration> {
  const parsed = createIntegrationSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data
  const config = validateConfigByType(data.type, data.config)

  const created = await prisma.integration.create({
    data: {
      type: data.type,
      name: data.name,
      enabled: data.enabled ?? true,
      projectId: data.projectId ?? null,
      config: config as unknown as Prisma.InputJsonValue,
    },
  })

  revalidateIntegrationsRoutes()
  return serialize(created)
}

export async function updateIntegration(
  input: UpdateIntegrationInput,
): Promise<SerializedIntegration> {
  const parsed = updateIntegrationSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { id, ...patch } = parsed.data

  const existing = await prisma.integration.findUnique({
    where: { id },
    select: { id: true, type: true },
  })
  if (!existing) actionError('INTEGRATION_NOT_FOUND', `no existe ${id}`)

  const updateData: Prisma.IntegrationUpdateInput = {}
  if (patch.name !== undefined) updateData.name = patch.name
  if (patch.enabled !== undefined) updateData.enabled = patch.enabled
  if (patch.projectId !== undefined) {
    updateData.project =
      patch.projectId === null
        ? { disconnect: true }
        : { connect: { id: patch.projectId } }
  }
  if (patch.config !== undefined) {
    const config = validateConfigByType(existing.type, patch.config)
    updateData.config = config as unknown as Prisma.InputJsonValue
  }

  const updated = await prisma.integration.update({
    where: { id },
    data: updateData,
  })

  revalidateIntegrationsRoutes()
  return serialize(updated)
}

export async function deleteIntegration(id: string): Promise<{ id: string }> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  try {
    await prisma.integration.delete({ where: { id } })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2025'
    ) {
      actionError('INTEGRATION_NOT_FOUND', `no existe ${id}`)
    }
    throw e
  }
  revalidateIntegrationsRoutes()
  return { id }
}

// ───────────────────────── Server actions: test webhook ─────────────────────────

/**
 * Envía un mensaje de prueba al webhook configurado para verificar que
 * el endpoint está vivo y la configuración es correcta. NO se persiste
 * ningún rastro — el resultado se muestra en la UI.
 *
 * Para GITHUB: como no tenemos webhook saliente, esta acción solo valida
 * la config y devuelve `{ ok: true }`.
 */
export async function testIntegrationWebhook(
  integrationId: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!integrationId) actionError('INVALID_INPUT', 'integrationId requerido')
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { id: true, type: true, enabled: true, config: true },
  })
  if (!integration) {
    actionError('INTEGRATION_NOT_FOUND', `no existe ${integrationId}`)
  }
  if (!integration.enabled) {
    return { ok: false, error: '[INVALID_CONFIG] integración deshabilitada' }
  }

  if (integration.type === 'SLACK') {
    const message: SlackBlockKitMessage = {
      text: 'Prueba de conexión desde FollowupGantt',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':white_check_mark: *Prueba de conexión* desde FollowupGantt — la integración Slack está activa.',
          },
        },
      ],
    }
    return dispatchSlackNotification(integration.id, message)
  }

  if (integration.type === 'TEAMS') {
    const card: AdaptiveCard = {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: 'Prueba de conexión',
          weight: 'Bolder',
          size: 'Medium',
        },
        {
          type: 'TextBlock',
          text: 'La integración Microsoft Teams de FollowupGantt está activa.',
          wrap: true,
        },
      ],
    }
    return dispatchTeamsCard(integration.id, card)
  }

  // GITHUB: sólo valida config; no hay webhook saliente en P4.
  validateGitHubConfig(integration.config)
  return { ok: true }
}

// ───────────────────────── Server actions: TaskGitHubLink ─────────────────────────

const linkTaskSchema = z.object({
  taskId: z.string().min(1),
  // Acepta varias formas: URL, owner/repo#N, #N, "N" (con defaultRepo).
  reference: z.string().min(1).optional(),
  repoFullName: z.string().min(1).optional(),
  issueOrPr: z.union([z.string(), z.number()]).optional(),
  kind: z.enum(['ISSUE', 'PR']).optional(),
  defaultRepo: z.string().min(1).optional(),
})

export type LinkTaskToGitHubInput = z.input<typeof linkTaskSchema>

export type SerializedTaskGitHubLink = {
  id: string
  taskId: string
  repoFullName: string
  issueNumber: number
  kind: string
  url: string
  createdAt: string
}

function serializeLink(row: {
  id: string
  taskId: string
  repoFullName: string
  issueNumber: number
  kind: string
  createdAt: Date
}): SerializedTaskGitHubLink {
  const url =
    row.kind === 'PR'
      ? `https://github.com/${row.repoFullName}/pull/${row.issueNumber}`
      : `https://github.com/${row.repoFullName}/issues/${row.issueNumber}`
  return {
    id: row.id,
    taskId: row.taskId,
    repoFullName: row.repoFullName,
    issueNumber: row.issueNumber,
    kind: row.kind,
    url,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Vincula una tarea a un issue/PR de GitHub. Acepta `reference` flexible
 * (URL completa, `owner/repo#N`, `#N` con `defaultRepo`) o el shape
 * desglosado (`repoFullName` + `issueOrPr`). Lanza `[LINK_DUPLICATED]` si
 * el mismo (taskId, repo, issueNumber) ya existe.
 */
export async function linkTaskToGitHub(
  input: LinkTaskToGitHubInput,
): Promise<SerializedTaskGitHubLink> {
  const parsed = linkTaskSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  const task = await prisma.task.findUnique({
    where: { id: data.taskId },
    select: { id: true },
  })
  if (!task) actionError('TASK_NOT_FOUND', `no existe la tarea ${data.taskId}`)

  let repoFullName: string
  let issueNumber: number
  let kind: 'ISSUE' | 'PR'

  if (data.reference) {
    const parsedRef = parseGitHubReference(data.reference, {
      defaultRepo: data.defaultRepo,
    })
    repoFullName = parsedRef.repoFullName
    issueNumber = parsedRef.issueNumber
    kind = parsedRef.kind
    if (data.kind) kind = data.kind
  } else if (data.repoFullName && data.issueOrPr !== undefined) {
    repoFullName = validateRepoFullName(data.repoFullName)
    issueNumber = validateIssueNumber(data.issueOrPr)
    kind = data.kind ?? 'ISSUE'
  } else {
    actionError(
      'INVALID_INPUT',
      'Debe enviarse `reference` o (`repoFullName` + `issueOrPr`)',
    )
  }

  try {
    const created = await prisma.taskGitHubLink.create({
      data: { taskId: data.taskId, repoFullName, issueNumber, kind },
    })
    revalidatePath('/projects')
    return serializeLink(created)
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      actionError(
        'LINK_DUPLICATED',
        `la tarea ya está vinculada a ${repoFullName}#${issueNumber}`,
      )
    }
    throw e
  }
}

/** Lista los enlaces GitHub de una tarea. */
export async function listGitHubLinksForTask(
  taskId: string,
): Promise<SerializedTaskGitHubLink[]> {
  if (!taskId) actionError('INVALID_INPUT', 'taskId requerido')
  const rows = await prisma.taskGitHubLink.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(serializeLink)
}

/** Elimina un enlace por id. Idempotente. */
export async function unlinkTaskFromGitHub(
  id: string,
): Promise<{ id: string }> {
  if (!id) actionError('INVALID_INPUT', 'id requerido')
  try {
    await prisma.taskGitHubLink.delete({ where: { id } })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2025'
    ) {
      // Idempotencia: no fallamos si ya no existe.
      return { id }
    }
    throw e
  }
  revalidatePath('/projects')
  return { id }
}
