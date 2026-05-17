'use server'

/**
 * Wave R5 Extended · US R5E-Marketplace — Server actions task ↔ GitHub.
 *
 * Distinto del `linkTaskToGitHub` legacy (Ola P4 · src/lib/actions/integrations.ts):
 *   - Aquel guarda en `TaskGitHubLink` (tabla relacional, sin tocar API).
 *   - Éste guarda en `Task.externalRefs.github` y SÍ valida el issue contra
 *     la API de GitHub usando el `IntegrationInstall` activo del workspace.
 *
 * Convivencia: ambos pueden coexistir. La UI nueva (drawer marketplace) usa
 * éste; los listados legacy siguen leyendo `TaskGitHubLink` hasta que un
 * follow-up consolide ambos (deuda registrada).
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { withMetrics } from '@/lib/observability/metrics'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { fetchIssue } from '@/lib/integrations/github-client'
import { updateIssueTitle as ghUpdateIssueTitle } from '@/lib/integrations/github-client'
import type { GithubInstallConfig } from '@/lib/integrations/registry'

function err(code: string, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

/**
 * Helper: resuelve el install GitHub activo para el workspace de la tarea.
 * Devuelve null si no hay (la UI debe esconder el botón en ese caso).
 */
async function resolveGithubInstallForTask(taskId: string): Promise<
  | {
      installId: string
      config: GithubInstallConfig
      workspaceId: string
    }
  | null
> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { project: { select: { workspaceId: true } } },
  })
  if (!task?.project?.workspaceId) return null
  const install = await prisma.integrationInstall.findUnique({
    where: {
      workspaceId_providerKey: {
        workspaceId: task.project.workspaceId,
        providerKey: 'github',
      },
    },
    select: { id: true, status: true, config: true, workspaceId: true },
  })
  if (!install || install.status !== 'CONNECTED') return null
  if (!install.config || typeof install.config !== 'object' || Array.isArray(install.config)) {
    return null
  }
  return {
    installId: install.id,
    config: install.config as unknown as GithubInstallConfig,
    workspaceId: install.workspaceId,
  }
}

export interface LinkTaskToGithubIssueInput {
  taskId: string
  /**
   * Si se omite, se usa `defaultRepo` del install. Útil cuando una task se
   * trackea en un repo distinto al default del workspace.
   */
  repoFullName?: string
  issueNumber: number
}

/**
 * Vincula una `Task` a un issue de GitHub. Hace una llamada GET a la API
 * para verificar que el issue existe (404 → `[INVALID_INPUT]`) y persiste
 * la referencia en `Task.externalRefs.github`.
 */
export async function linkTaskToGithubIssue(
  input: LinkTaskToGithubIssueInput,
): Promise<{ taskId: string; issueNumber: number; url: string }> {
  return withMetrics('action.marketplace.linkTaskToGithub', async () => {
    const user = await getCurrentUser()
    if (!user) err('FORBIDDEN', 'sesión requerida')
    if (!input.taskId) err('INVALID_INPUT', 'taskId requerido')
    if (!Number.isInteger(input.issueNumber) || input.issueNumber <= 0) {
      err('INVALID_INPUT', 'issueNumber inválido')
    }

    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: { id: true, externalRefs: true, projectId: true },
    })
    if (!task) err('TASK_NOT_FOUND', `no existe la tarea ${input.taskId}`)

    const install = await resolveGithubInstallForTask(input.taskId)
    if (!install) {
      err(
        'INTEGRATION_NOT_INSTALLED',
        'GitHub no está conectado en este workspace',
      )
    }

    // Verifica que el issue exista.
    const issue = await fetchIssue(install.config, {
      repoFullName: input.repoFullName,
      issueNumber: input.issueNumber,
    })
    if (!issue.ok) {
      if (issue.status === 401 || issue.status === 403) {
        err('EXTERNAL_API_ERROR', `GitHub rechazó el token (HTTP ${issue.status})`)
      }
      if (issue.status === 404) {
        err('INVALID_INPUT', 'issue no encontrado en el repo')
      }
      err('EXTERNAL_API_ERROR', issue.error ?? 'GitHub API error')
    }

    const issueData = issue.data!
    const repo = input.repoFullName ?? install.config.defaultRepo
    const baseRefs =
      task.externalRefs &&
      typeof task.externalRefs === 'object' &&
      !Array.isArray(task.externalRefs)
        ? (task.externalRefs as Record<string, unknown>)
        : {}
    const nextRefs = {
      ...baseRefs,
      github: {
        issueNumber: issueData.number,
        url: issueData.url,
        repoFullName: repo,
        kind: issueData.kind,
        // Snapshot informativo del título — útil para UI sin requerir round-trip.
        titleSnapshot: issueData.title,
        linkedAt: new Date().toISOString(),
      },
    }

    await prisma.task.update({
      where: { id: input.taskId },
      data: { externalRefs: nextRefs as unknown as Prisma.InputJsonValue },
    })

    await recordAuditEventSafe({
      actorId: user.id,
      action: 'task.linked_external',
      entityType: 'task',
      entityId: input.taskId,
      metadata: {
        provider: 'github',
        repoFullName: repo,
        issueNumber: issueData.number,
      },
    })

    revalidatePath('/list')
    revalidatePath(`/projects/${task.projectId}`)
    return {
      taskId: input.taskId,
      issueNumber: issueData.number,
      url: issueData.url,
    }
  })
}

/**
 * Desvincula la referencia GitHub de una tarea (no toca el issue remoto).
 */
export async function unlinkTaskFromGithubIssue(input: {
  taskId: string
}): Promise<{ taskId: string }> {
  return withMetrics('action.marketplace.unlinkTaskFromGithub', async () => {
    const user = await getCurrentUser()
    if (!user) err('FORBIDDEN', 'sesión requerida')
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: { id: true, externalRefs: true, projectId: true },
    })
    if (!task) err('TASK_NOT_FOUND', `no existe la tarea ${input.taskId}`)

    if (!task.externalRefs || typeof task.externalRefs !== 'object' || Array.isArray(task.externalRefs)) {
      return { taskId: input.taskId }
    }
    const refs = task.externalRefs as Record<string, unknown>
    if (!refs.github) return { taskId: input.taskId }
    const { github: _gh, ...rest } = refs
    void _gh
    await prisma.task.update({
      where: { id: input.taskId },
      data: { externalRefs: rest as unknown as Prisma.InputJsonValue },
    })
    revalidatePath('/list')
    revalidatePath(`/projects/${task.projectId}`)
    return { taskId: input.taskId }
  })
}

/**
 * Botón manual desde el drawer: empuja el título actual de la Task al
 * issue en GitHub. NO se invoca automáticamente — el caller (usuario)
 * tiene que decidir cuándo. Esto evita que un rename frecuente en Sync
 * spammee el issue con eventos `renamed`.
 */
export async function pushTaskTitleToGithubIssue(input: {
  taskId: string
}): Promise<{ ok: boolean; error?: string }> {
  return withMetrics('action.marketplace.pushTaskTitleToGithub', async () => {
    const user = await getCurrentUser()
    if (!user) err('FORBIDDEN', 'sesión requerida')
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: { id: true, title: true, externalRefs: true, projectId: true },
    })
    if (!task) err('TASK_NOT_FOUND', `no existe la tarea ${input.taskId}`)

    const install = await resolveGithubInstallForTask(input.taskId)
    if (!install) {
      err('INTEGRATION_NOT_INSTALLED', 'GitHub no está conectado en este workspace')
    }
    if (!task.externalRefs || typeof task.externalRefs !== 'object' || Array.isArray(task.externalRefs)) {
      err('INVALID_INPUT', 'la tarea no tiene un link a GitHub')
    }
    const refs = task.externalRefs as Record<string, unknown>
    const gh = refs.github as
      | { issueNumber?: number; repoFullName?: string }
      | undefined
    if (!gh?.issueNumber) {
      err('INVALID_INPUT', 'la tarea no tiene un link a GitHub')
    }

    const res = await ghUpdateIssueTitle(install.config, {
      repoFullName: gh.repoFullName,
      issueNumber: gh.issueNumber,
      title: task.title,
    })
    return res.ok ? { ok: true } : { ok: false, error: res.error ?? 'unknown' }
  })
}
