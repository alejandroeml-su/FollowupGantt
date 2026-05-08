'use server'

/**
 * Wave P9 R2 (HU-9.8) — Server actions para Definition of Ready/Done
 * por proyecto.
 *
 * Persiste en `Project.dorTemplate` y `Project.dodTemplate` (Json).
 * El validador `normalizeChecklistTemplate` saneza el shape antes de
 * guardar.
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  normalizeChecklistTemplate,
  type ChecklistTemplate,
} from '@/lib/dor-dod/types'

function revalidateProjectViews(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/settings`)
  revalidatePath('/list')
  revalidatePath('/kanban')
}

export async function setProjectDoR(input: {
  projectId: string
  items: string[]
}): Promise<{ ok: true; template: ChecklistTemplate }> {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')

  const template = normalizeChecklistTemplate(input.items)

  const before = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { dorTemplate: true },
  })
  if (!before) throw new Error('[NOT_FOUND] proyecto no existe')

  await prisma.project.update({
    where: { id: input.projectId },
    data: { dorTemplate: template },
  })

  await recordAuditEventSafe({
    action: 'project.dor_updated',
    entityType: 'project',
    entityId: input.projectId,
    after: { itemCount: template.length },
  })

  revalidateProjectViews(input.projectId)
  return { ok: true, template }
}

export async function setProjectDoD(input: {
  projectId: string
  items: string[]
}): Promise<{ ok: true; template: ChecklistTemplate }> {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')

  const template = normalizeChecklistTemplate(input.items)

  const before = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { dodTemplate: true },
  })
  if (!before) throw new Error('[NOT_FOUND] proyecto no existe')

  await prisma.project.update({
    where: { id: input.projectId },
    data: { dodTemplate: template },
  })

  await recordAuditEventSafe({
    action: 'project.dod_updated',
    entityType: 'project',
    entityId: input.projectId,
    after: { itemCount: template.length },
  })

  revalidateProjectViews(input.projectId)
  return { ok: true, template }
}

/**
 * Carga las plantillas DoR/DoD ya normalizadas. Usa este helper en
 * server components y en el guard de status — devuelve siempre
 * `ChecklistTemplate` (puede ser `[]`), nunca null.
 */
export async function loadProjectChecklists(projectId: string): Promise<{
  dor: ChecklistTemplate
  dod: ChecklistTemplate
  dodHardEnforce: boolean
}> {
  if (!projectId) return { dor: [], dod: [], dodHardEnforce: false }
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { dorTemplate: true, dodTemplate: true, dodHardEnforce: true },
  })
  if (!project) return { dor: [], dod: [], dodHardEnforce: false }
  return {
    dor: normalizeChecklistTemplate(project.dorTemplate),
    dod: normalizeChecklistTemplate(project.dodTemplate),
    dodHardEnforce: project.dodHardEnforce,
  }
}

/**
 * Wave P12 (Scrum 100% · DoD HARD) — Toggle del flag de enforcement.
 *
 * Cuando `dodHardEnforce = true`, mover una tarea a DONE requiere
 * checklist DoD completo (validación HARD bloqueante). Default
 * `false` para no romper proyectos legacy (mantiene comportamiento
 * SOFT toast informativo).
 *
 * El guard real vive en `lib/dor-dod/guards.ts` (validateDoDForDone)
 * y se invoca desde `taskUpdateStatus` server action.
 */
export async function toggleDodHardEnforce(input: {
  projectId: string
  enabled: boolean
  actorId?: string
}): Promise<{ ok: true; dodHardEnforce: boolean }> {
  if (!input.projectId) throw new Error('[INVALID_INPUT] projectId requerido')

  const before = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { dodHardEnforce: true },
  })
  if (!before) throw new Error('[NOT_FOUND] proyecto no existe')

  await prisma.project.update({
    where: { id: input.projectId },
    data: { dodHardEnforce: input.enabled },
  })

  await recordAuditEventSafe({
    action: 'project.dod_hard_toggled',
    entityType: 'project',
    entityId: input.projectId,
    actorId: input.actorId,
    before: { dodHardEnforce: before.dodHardEnforce },
    after: { dodHardEnforce: input.enabled },
  })

  revalidateProjectViews(input.projectId)
  return { ok: true, dodHardEnforce: input.enabled }
}
