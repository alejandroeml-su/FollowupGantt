'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { sendMentionNotification } from '@/lib/email/mention-notification'
import { invalidateCpmCache } from '@/lib/scheduling/invalidate'
import { createNotificationsBatch } from '@/lib/actions/notifications'
import { recomputeKeyResultsForTask } from '@/lib/actions/goals'
import type {
  TaskType,
  ProjectStatus,
  Priority,
  TaskStatus,
  DependencyType,
} from '@prisma/client'
import { serializeTask } from '@/lib/types'
import type { SerializedTask } from '@/lib/types'

// Vistas que dependen de la jerarquía de tareas: cualquier mutación de
// subtareas inline necesita revalidarlas para no servir caché obsoleta.
const TASK_VIEW_PATHS = [
  '/list',
  '/kanban',
  '/gantt',
  '/table',
  '/workload',
  '/mindmaps',
  '/dashboards',
  '/brain',
] as const

function revalidateTaskViews() {
  for (const p of TASK_VIEW_PATHS) revalidatePath(p)
}

// =============================================
// CRUD: GERENCIAS
// =============================================

export async function createGerencia(formData: FormData) {
  const name = formData.get('name') as string
  const description = formData.get('description') as string || undefined

  if (!name) throw new Error('Nombre de la gerencia es requerido')

  await prisma.gerencia.create({ data: { name: name.toUpperCase(), description } })
  revalidatePath('/gerencias')
  revalidatePath('/projects')
}

export async function updateGerencia(formData: FormData) {
  const id = formData.get('id') as string
  const name = formData.get('name') as string
  const description = formData.get('description') as string || undefined

  if (!id || !name) throw new Error('ID y nombre son requeridos')

  await prisma.gerencia.update({
    where: { id },
    data: { name: name.toUpperCase(), description }
  })
  revalidatePath('/gerencias')
  revalidatePath('/projects')
}

export async function deleteGerencia(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('ID es requerido')

  await prisma.gerencia.delete({ where: { id } })
  revalidatePath('/gerencias')
  revalidatePath('/projects')
}

export async function getGerencias() {
  return prisma.gerencia.findMany({
    include: { areas: true },
    orderBy: { name: 'asc' }
  })
}

// =============================================
// CRUD: PROYECTOS
// =============================================

export async function createProject(formData: FormData) {
  const name = formData.get('name') as string
  const description = formData.get('description') as string || undefined
  const status = (formData.get('status') as string) || 'PLANNING'
  const areaId = formData.get('areaId') as string || undefined

  if (!name) throw new Error('El nombre del proyecto es requerido')

  await prisma.project.create({
    data: { name, description, status: status as ProjectStatus, areaId: areaId || null }
  })
  revalidatePath('/projects')
  revalidatePath('/')
}

export async function updateProject(formData: FormData) {
  const id = formData.get('id') as string
  const name = formData.get('name') as string
  const description = formData.get('description') as string || undefined
  const status = formData.get('status') as string

  if (!id || !name) throw new Error('ID y nombre son requeridos')

  await prisma.project.update({
    where: { id },
    data: { name, description, status: status as ProjectStatus }
  })
  revalidatePath('/projects')
  revalidatePath('/')
}

export async function deleteProject(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('ID es requerido')

  await prisma.project.delete({ where: { id } })
  revalidatePath('/projects')
  revalidatePath('/')
}

// =============================================
// CRUD: TAREAS
// =============================================

/**
 * Parsea el campo `tags` del FormData. Espera JSON.stringify(string[]).
 * Devuelve un array deduplicado (case-insensitive, lowercase).
 * Fallback `[]` ante cualquier error de parseo o valor ausente.
 */
function parseTagsFromFormData(formData: FormData): string[] {
  const raw = formData.get('tags')
  if (typeof raw !== 'string' || !raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out = new Set<string>()
    for (const v of parsed) {
      if (typeof v !== 'string') continue
      const t = v.trim().toLowerCase()
      if (t) out.add(t)
    }
    return Array.from(out)
  } catch {
    return []
  }
}

/**
 * Normaliza la URL de referencia que llega por FormData. Acepta `null`
 * o cadena vacía para indicar "sin enlace". Rechaza protocolos distintos
 * a http/https. Espejo del helper en `actions/collaborators.ts` —
 * duplicado intencional para que `createTask` no dependa del archivo
 * `'use server'` de colaboradores.
 */
function parseReferenceUrlFromFormData(formData: FormData): string | null {
  const raw = formData.get('referenceUrl')
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('URL de referencia inválida')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL de referencia inválida (solo http/https)')
  }
  return parsed.toString()
}

export async function createTask(formData: FormData) {
  const title = formData.get('title') as string
  const projectId = formData.get('projectId') as string
  const status = (formData.get('status') as string) || 'TODO'
  const priority = (formData.get('priority') as string) || 'MEDIUM'
  const type = (formData.get('type') as string) || 'AGILE_STORY'
  const parentId = formData.get('parentId') as string || undefined
  const assigneeId = formData.get('assigneeId') as string || undefined
  const endDateStr = formData.get('endDate') as string
  const description = formData.get('description') as string || undefined
  const tags = parseTagsFromFormData(formData)
  const referenceUrl = parseReferenceUrlFromFormData(formData)

  // Story Points (Ola P2) — opcional, escala Fibonacci. Validamos aquí para
  // que el form HTML clásico (sin server action dedicada) tampoco persista
  // valores fuera de escala. La UI ya restringe el select.
  const storyPointsRaw = formData.get('storyPoints')
  let storyPoints: number | null = null
  if (typeof storyPointsRaw === 'string' && storyPointsRaw.trim()) {
    const n = Number(storyPointsRaw)
    const allowed = [1, 2, 3, 5, 8, 13, 21]
    if (Number.isInteger(n) && allowed.includes(n)) {
      storyPoints = n
    }
  }

  if (!title || !projectId) throw new Error('Título y proyecto son requeridos')

  // Generar mnemónico automático: PRIM-1, INFRA-1...
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  const prefix = project?.name.split(' ').map(w => w[0]).join('').substring(0, 4).toUpperCase() || 'TASK'
  const count = await prisma.task.count({ where: { projectId } })
  const mnemonic = `${prefix}-${count + 1}`

  await prisma.task.create({
    data: {
      title,
      mnemonic,
      description,
      projectId,
      status: status as TaskStatus,
      priority: priority as Priority,
      type: type as TaskType,
      parentId: parentId || null,
      assigneeId: assigneeId || null,
      startDate: formData.get('startDate') ? new Date(formData.get('startDate') as string) : null,
      endDate: endDateStr ? new Date(endDateStr) : null,
      ...(tags.length > 0 ? { tags } : {}),
      ...(referenceUrl ? { referenceUrl } : {}),
      ...(storyPoints !== null ? { storyPoints } : {}),
    }
  })
  invalidateCpmCache(projectId)
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
  revalidatePath('/workload')
  revalidatePath('/mindmaps')
  revalidatePath('/dashboards')
}

export async function updateTask(formData: FormData) {
  const id = formData.get('id') as string
  const title = formData.get('title') as string
  const status = formData.get('status') as string
  const priority = formData.get('priority') as string
  const type = formData.get('type') as string
  const assigneeId = formData.get('assigneeId') as string || undefined
  const endDateStr = formData.get('endDate') as string
  const description = formData.get('description') as string || undefined
  const progress = formData.get('progress') ? Number(formData.get('progress')) : undefined
  const plannedValue = formData.get('plannedValue') ? Number(formData.get('plannedValue')) : undefined
  const actualCost = formData.get('actualCost') ? Number(formData.get('actualCost')) : undefined
  const startDateStr = formData.get('startDate') as string
  const userId = formData.get('userId') as string || undefined // ID del usuario que hace el cambio
  const userRoles = formData.get('userRoles') as string // JSON array de roles del usuario

  if (!id) throw new Error('ID es requerido')

  // ─── Control de Acceso ───────────────────────────────────────────
  // 1. Obtener la tarea y su proyecto
  const taskToUpdate = await prisma.task.findUnique({ 
    where: { id },
    include: { project: { include: { assignments: true } } }
  })
  if (!taskToUpdate) throw new Error('Tarea no encontrada')

  // 2. Verificar si el usuario es ADMIN/SUPER_ADMIN o si está asignado al proyecto
  const roles = userRoles ? JSON.parse(userRoles) : []
  const isAdmin = roles.some((r: string) => r === 'ADMIN' || r === 'SUPER_ADMIN')
  
  if (!isAdmin && userId) {
    const isAssigned = taskToUpdate.project.assignments.some(a => a.userId === userId)
    if (!isAssigned) {
      throw new Error('No tienes permisos para editar tareas en este proyecto. Debes estar asignado al mismo.')
    }
  }
  // ─────────────────────────────────────────────────────────────────

  // Obtener estado anterior para el historial
  const oldTask = taskToUpdate // ya la tenemos


  const data: Record<string, unknown> = {}
  type HistoryEntry = { field: string; oldValue: string; newValue: string; userId: string | null }
  const historyEntries: HistoryEntry[] = []

  const checkChange = (field: string, newValue: unknown, oldValue: unknown) => {
    if (newValue !== undefined && String(newValue) !== String(oldValue)) {
      data[field] = newValue
      historyEntries.push({
        field,
        oldValue: String(oldValue ?? ''),
        newValue: String(newValue ?? ''),
        userId: userId || null
      })
    }
  }

  if (title) checkChange('title', title, oldTask.title)
  if (status) checkChange('status', status as TaskStatus, oldTask.status)
  if (priority) checkChange('priority', priority as Priority, oldTask.priority)
  if (type) checkChange('type', type as TaskType, oldTask.type)
  if (description !== undefined) checkChange('description', description, oldTask.description)
  if (assigneeId !== undefined) checkChange('assigneeId', assigneeId || null, oldTask.assigneeId)
  if (startDateStr !== undefined) checkChange('startDate', startDateStr ? new Date(startDateStr) : null, oldTask.startDate)
  if (endDateStr !== undefined) checkChange('endDate', endDateStr ? new Date(endDateStr) : null, oldTask.endDate)
  if (progress !== undefined) checkChange('progress', progress, oldTask.progress)
  if (plannedValue !== undefined) checkChange('plannedValue', plannedValue, oldTask.plannedValue)
  if (actualCost !== undefined) checkChange('actualCost', actualCost, oldTask.actualCost)

  await prisma.$transaction([
    prisma.task.update({ where: { id }, data }),
    ...(historyEntries.length > 0 ? [prisma.taskHistory.createMany({
      data: historyEntries.map(h => ({ ...h, taskId: id }))
    })] : [])
  ])

  // Invalidar cache CPM si la mutación afectó a campos relevantes
  // (fechas, hito). El resto de campos no afecta al grafo, pero el coste
  // de invalidar es trivial frente a la complejidad de discriminar.
  invalidateCpmCache(taskToUpdate.projectId)

  // Ola P2 · Equipo P2-4 — Si el status cambió, recalcular KRs vinculados
  // (sólo afecta KRs metric=TASKS_COMPLETED). Best-effort: errores aquí no
  // deben bloquear la actualización de la tarea.
  if (status && status !== oldTask.status) {
    try {
      await recomputeKeyResultsForTask(id)
    } catch (err) {
      console.error('[goals] recomputeKeyResultsForTask falló desde updateTask', err)
    }
  }

  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
  revalidatePath('/workload')
  revalidatePath('/mindmaps')
  revalidatePath('/goals')
}

export async function deleteTask(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('ID es requerido')

  // Capturar projectId antes del delete para invalidar el cache CPM.
  const t = await prisma.task.findUnique({
    where: { id },
    select: { projectId: true },
  })

  await prisma.task.delete({ where: { id } })
  if (t) invalidateCpmCache(t.projectId)
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
  revalidatePath('/workload')
  revalidatePath('/mindmaps')
}

export async function addDependency(formData: FormData) {
  const predecessorId = formData.get('predecessorId') as string
  const successorId = formData.get('successorId') as string
  const type = (formData.get('type') as string) || 'FINISH_TO_START'

  await prisma.taskDependency.upsert({
    where: { predecessorId_successorId: { predecessorId, successorId } },
    update: { type: type as DependencyType },
    create: { predecessorId, successorId, type: type as DependencyType }
  })

  // Invalidar CPM del proyecto del predecesor (mismo proyecto que el sucesor
  // por construcción en el resto del código).
  const pred = await prisma.task.findUnique({
    where: { id: predecessorId },
    select: { projectId: true },
  })
  if (pred) invalidateCpmCache(pred.projectId)
  revalidatePath('/gantt')
}

export async function removeDependency(formData: FormData) {
  const predecessorId = formData.get('predecessorId') as string
  const successorId = formData.get('successorId') as string

  // Capturar projectId antes del delete (para invalidar cache).
  const pred = await prisma.task.findUnique({
    where: { id: predecessorId },
    select: { projectId: true },
  })

  await prisma.taskDependency.delete({
    where: { predecessorId_successorId: { predecessorId, successorId } }
  })
  if (pred) invalidateCpmCache(pred.projectId)
  revalidatePath('/gantt')
}

export async function updateTaskStatus(id: string, status: string) {
  await prisma.task.update({
    where: { id },
    data: { status: status as TaskStatus }
  })
  // Ola P2 · Equipo P2-4 — Recompute KRs vinculados (idempotente, best-effort).
  try {
    await recomputeKeyResultsForTask(id)
  } catch (err) {
    console.error('[goals] recomputeKeyResultsForTask falló desde updateTaskStatus', err)
  }
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/goals')
}

// =============================================
// CRUD: USUARIOS (Catálogo)
// =============================================

export async function createUser(formData: FormData) {
  const name = formData.get('name') as string
  const email = formData.get('email') as string
  const roleIds = formData.getAll('roleIds') as string[]

  if (!name || !email) throw new Error('Nombre y email son requeridos')

  await prisma.user.create({
    data: { 
      name, 
      email, 
      roles: {
        create: roleIds.map(roleId => ({ roleId }))
      }
    }
  })
  revalidatePath('/workload')
  revalidatePath('/settings/users')
}

// =============================================
// CRUD: ROLES Y PERMISOS
// =============================================

export async function createRole(formData: FormData) {
  const name = formData.get('name') as string
  const description = formData.get('description') as string || undefined
  const allowedViews = formData.get('allowedViews') as string // JSON string array

  if (!name) throw new Error('El nombre del rol es requerido')

  await prisma.role.create({
    data: { 
      name: name.toUpperCase(), 
      description,
      permissions: allowedViews 
        ? { allowedViews: JSON.parse(allowedViews) } 
        : undefined
    }
  })
  revalidatePath('/settings/roles')
}

export async function deleteRole(formData: FormData) {
  const id = formData.get('id') as string
  await prisma.role.delete({ where: { id } })
  revalidatePath('/settings/roles')
}

// =============================================
// CRUD: EQUIPOS
// =============================================

export async function createTeam(formData: FormData) {
  const name = formData.get('name') as string
  const description = formData.get('description') as string || undefined

  if (!name) throw new Error('El nombre del equipo es requerido')

  await prisma.team.create({
    data: { name: name.trim(), description }
  })
  revalidatePath('/settings/teams')
}

export async function updateTeam(formData: FormData) {
  const id = formData.get('id') as string
  const name = formData.get('name') as string
  const description = formData.get('description') as string || null

  if (!id) throw new Error('ID es requerido')
  if (!name) throw new Error('El nombre del equipo es requerido')

  await prisma.team.update({
    where: { id },
    data: { name: name.trim(), description }
  })
  revalidatePath('/settings/teams')
}

export async function deleteTeam(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('ID es requerido')

  await prisma.team.delete({ where: { id } })
  revalidatePath('/settings/teams')
}

export async function addMemberToTeam(formData: FormData) {
  const teamId = formData.get('teamId') as string
  const userId = formData.get('userId') as string
  if (!teamId || !userId) throw new Error('teamId y userId son requeridos')

  await prisma.teamMember.create({
    data: { teamId, userId }
  })
  revalidatePath('/settings/teams')
}

export async function removeMemberFromTeam(formData: FormData) {
  const teamId = formData.get('teamId') as string
  const userId = formData.get('userId') as string
  if (!teamId || !userId) throw new Error('teamId y userId son requeridos')

  await prisma.teamMember.delete({
    where: { teamId_userId: { teamId, userId } }
  })
  revalidatePath('/settings/teams')
}

// =============================================
// ASIGNACIÓN DE PROYECTOS
// =============================================

export async function assignUserToProject(projectId: string, userId: string) {
  await prisma.projectAssignment.create({
    data: { projectId, userId }
  })
  revalidatePath('/projects')
}

export async function removeUserFromProject(projectId: string, userId: string) {
  await prisma.projectAssignment.delete({
    where: { projectId_userId: { projectId, userId } }
  })
  revalidatePath('/projects')
}


export async function deleteUser(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('ID es requerido')

  await prisma.user.delete({ where: { id } })
  revalidatePath('/workload')
  revalidatePath('/settings/users')
}

// =============================================
// CRUD: ÁREAS (Catálogo - dependiente de Gerencia)
// =============================================

export async function createArea(formData: FormData) {
  const name = formData.get('name') as string
  const description = formData.get('description') as string || undefined
  const gerenciaId = formData.get('gerenciaId') as string

  if (!name) throw new Error('Nombre es requerido')
  if (!gerenciaId) throw new Error('Gerencia es requerida')

  await prisma.area.create({ data: { name, description, gerenciaId } })
  revalidatePath('/projects')
  revalidatePath('/gerencias')
}

export async function updateArea(formData: FormData) {
  const id = formData.get('id') as string
  const name = formData.get('name') as string
  const description = formData.get('description') as string || undefined
  const gerenciaId = formData.get('gerenciaId') as string

  if (!id || !name) throw new Error('ID y nombre son requeridos')

  const data: Record<string, unknown> = { name, description }
  if (gerenciaId) data.gerenciaId = gerenciaId

  await prisma.area.update({ where: { id }, data })
  revalidatePath('/projects')
  revalidatePath('/gerencias')
}

export async function deleteArea(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('ID es requerido')

  await prisma.area.delete({ where: { id } })
  revalidatePath('/projects')
  revalidatePath('/gerencias')
}

// =============================================
// CRUD: SPRINTS
// =============================================

export async function createSprint(formData: FormData) {
  const name = formData.get('name') as string
  const projectId = formData.get('projectId') as string
  const goal = formData.get('goal') as string || undefined
  const startDate = formData.get('startDate') as string
  const endDate = formData.get('endDate') as string

  if (!name || !projectId || !startDate || !endDate) {
    throw new Error('Nombre, proyecto y fechas son requeridos')
  }

  await prisma.sprint.create({
    data: {
      name,
      goal,
      projectId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    }
  })
  revalidatePath('/projects')
  revalidatePath('/kanban')
}

// =============================================
// HELPERS de lectura (para catálogos en formularios)
// =============================================

export async function getProjects() {
  return prisma.project.findMany({ orderBy: { name: 'asc' } })
}

export async function getUsers() {
  return prisma.user.findMany({ orderBy: { name: 'asc' } })
}

export async function getAreas() {
  return prisma.area.findMany({
    include: { gerencia: true },
    orderBy: { name: 'asc' }
  })
}

export async function getAreasByGerencia(gerenciaId: string) {
  return prisma.area.findMany({
    where: { gerenciaId },
    orderBy: { name: 'asc' }
  })
}

// =============================================
// CRUD: COMENTARIOS / SEGUIMIENTO
// =============================================

export async function createComment(formData: FormData) {
  const content = formData.get('content') as string
  const taskId = formData.get('taskId') as string
  const authorId = formData.get('authorId') as string || undefined
  const isInternal = formData.get('isInternal') === 'true'

  if (!content || !taskId) throw new Error('Contenido y tarea son requeridos')

  await prisma.comment.create({
    data: {
      content,
      taskId,
      authorId: authorId || null,
      isInternal,
    },
  })

  const mentions = content.match(/@[\w.-]+@[\w.-]+\.\w+|@[\w.-]+/g)
  if (mentions) {
    const handles = Array.from(new Set(mentions.map((m) => m.substring(1))))

    // `@todos` (case-insensitive) es un alias para "todos los implicados":
    // assignee + colaboradores. Si aparece junto a otras menciones, se
    // unen los conjuntos (con dedupe por id de usuario abajo).
    const broadcastAll = handles.some((h) => h.toLowerCase() === 'todos')
    const explicitHandles = handles.filter((h) => h.toLowerCase() !== 'todos')

    const [mentionedUsers, task, author] = await Promise.all([
      explicitHandles.length > 0
        ? prisma.user.findMany({
            where: {
              OR: [{ email: { in: explicitHandles } }, { name: { in: explicitHandles } }],
            },
            select: { id: true, email: true, name: true },
          })
        : Promise.resolve([] as { id: string; email: string; name: string }[]),
      prisma.task.findUnique({
        where: { id: taskId },
        select: {
          title: true,
          mnemonic: true,
          assigneeId: true,
          parent: { select: { title: true } },
          collaborators: { select: { userId: true } },
        },
      }),
      authorId
        ? prisma.user.findUnique({ where: { id: authorId }, select: { name: true } })
        : Promise.resolve(null),
    ])

    // Resolución de destinatarios:
    //   1. Menciones explícitas (`@nombre`, `@email`).
    //   2. Si hay `@todos`, sumar `assigneeId` + colaboradores de la tarea.
    //   3. Dedupe por id (Set), excluir al autor del comentario.
    const recipientIds = new Set<string>()
    for (const u of mentionedUsers) recipientIds.add(u.id)
    if (broadcastAll && task) {
      if (task.assigneeId) recipientIds.add(task.assigneeId)
      for (const c of task.collaborators) recipientIds.add(c.userId)
    }
    if (authorId) recipientIds.delete(authorId)

    if (task && recipientIds.size > 0) {
      // Cargamos el shape mínimo que el email necesita. Para destinatarios
      // que ya teníamos por `mentionedUsers` evitamos un round-trip extra,
      // pero los provenientes de `@todos` requieren su email/name.
      const knownById = new Map(mentionedUsers.map((u) => [u.id, u]))
      const missingIds = [...recipientIds].filter((id) => !knownById.has(id))
      const extra = missingIds.length
        ? await prisma.user.findMany({
            where: { id: { in: missingIds } },
            select: { id: true, email: true, name: true },
          })
        : []

      const recipients = [...recipientIds]
        .map((id) => knownById.get(id) ?? extra.find((u) => u.id === id))
        .filter((u): u is { id: string; email: string; name: string } => Boolean(u))

      const authorName = author?.name ?? 'Un colaborador'
      const parentTitle = task.parent?.title ?? null
      // Resend ya está integrado con `after()` no-bloqueante. NO añadimos
      // rate limiting aquí: deuda registrada del proyecto, separada.
      // Riesgo conocido: un comentario con `@todos` puede emitir N+M
      // correos donde M = colaboradores; documentado en el PR.
      const mnemonicPrefix = task.mnemonic ? `[${task.mnemonic}] ` : ''
      const inAppTitle = `${authorName} te mencionó en ${mnemonicPrefix}${task.title}`
      const inAppBody = content.length > 280 ? `${content.slice(0, 277)}...` : content
      const inAppLink = `/list?taskId=${encodeURIComponent(taskId)}`

      after(async () => {
        // Canal email — respeta `NotificationPreference.emailMentions` por
        // destinatario antes de invocar Resend (deshabilitar email no
        // afecta in-app: el centro siempre recibe).
        const prefs = await prisma.notificationPreference.findMany({
          where: { userId: { in: recipients.map((r) => r.id) } },
          select: { userId: true, emailMentions: true },
        })
        const optedOut = new Set(
          prefs.filter((p) => !p.emailMentions).map((p) => p.userId),
        )
        await Promise.all(
          recipients
            .filter((u) => !optedOut.has(u.id))
            .map((user) =>
              sendMentionNotification({
                to: user.email,
                recipientName: user.name,
                authorName,
                taskTitle: task.title,
                taskMnemonic: task.mnemonic,
                commentContent: content,
                taskId,
                parentTaskTitle: parentTitle,
                isInternal,
              }),
            ),
        )

        // Canal in-app — siempre activo en P1. Tolera fallos: si Prisma
        // rechaza por FK o JSON inválido se loguea sin tirar el batch.
        try {
          await createNotificationsBatch(
            recipients.map((user) => ({
              userId: user.id,
              type: 'MENTION' as const,
              title: inAppTitle,
              body: inAppBody,
              link: inAppLink,
              data: {
                taskId,
                taskMnemonic: task.mnemonic ?? null,
                authorName,
                isInternal,
              },
            })),
          )
        } catch (err) {
          console.error('[notifications] createComment batch falló', err)
        }
      })
    }
  }

  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
}

export async function createAttachment(formData: FormData) {
  const taskId = formData.get('taskId') as string
  const filename = formData.get('filename') as string
  const url = formData.get('url') as string
  const userId = formData.get('userId') as string || undefined

  if (!taskId || !filename || !url) throw new Error('Datos incompletos para el adjunto')

  await prisma.attachment.create({
    data: { taskId, filename, url, userId: userId || null }
  })
  revalidatePath('/list')
}

export async function getTaskWithDetails(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      project: true,
      assignee: true,
      subtasks: { include: { assignee: true } },
      collaborators: { include: { user: true } },
      comments: {
        include: { author: true },
        orderBy: { createdAt: 'desc' },
      },
      history: {
        include: { user: true },
        orderBy: { createdAt: 'desc' }
      },
      attachments: {
        include: { user: true },
        orderBy: { createdAt: 'desc' }
      },
      predecessors: { include: { predecessor: true } },
      successors: { include: { successor: true } },
    },
  })
}

// =============================================
// SUBTAREAS INLINE (Sprint 3)
// =============================================
// Operaciones puntuales sobre subtareas hijas, expuestas para el
// listado inline del tab "Subtareas" del formulario de tarea.
//
// Convenciones compartidas con `updateTask`:
//   - Errores tipados con prefijo en corchetes: `[INVALID_INPUT]`,
//     `[NOT_FOUND]`, `[FORBIDDEN]`. El cliente puede hacer match si
//     necesita comportarse distinto, y el toast se queda con el
//     mensaje legible que sigue al prefijo.
//   - Hardcode SUPER_ADMIN mientras no exista sesión real (mismo hack
//     que `updateTask`); pasar `userRoles` desde el cliente para que el
//     futuro switch a auth sea simétrico.
//   - Historial: misma forma `{ field, oldValue, newValue, userId }`.
//   - Revalidación: las cinco vistas de tareas + brain.

type RoleCheckInput = {
  userId?: string | null
  userRoles?: string[]
}

/**
 * Genera el siguiente mnemónico para un proyecto siguiendo la misma
 * convención que `createTask` (prefijo de iniciales del nombre del
 * proyecto + correlativo basado en `task.count`).
 *
 * Idéntica derivación intencional: si `createTask` cambia el algoritmo,
 * deberíamos extraer un helper compartido en una iteración posterior.
 */
async function nextMnemonicForProject(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({ where: { id: projectId } })
  const prefix =
    project?.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .substring(0, 4)
      .toUpperCase() || 'TASK'
  const count = await prisma.task.count({ where: { projectId } })
  return `${prefix}-${count + 1}`
}

/**
 * Crea una subtarea inline (fila "Añadir subtarea... Enter") y devuelve
 * el shape mínimo que el cliente necesita para inyectarla en el state
 * local del tab sin tener que re-fetchear el padre completo.
 *
 * Hereda `projectId` y `type` del padre — la subtarea no puede vivir
 * en otro proyecto que el de su padre.
 */
export async function createSubtaskInline(input: {
  parentId: string
  title: string
  assigneeId?: string | null
  userId?: string | null
  userRoles?: string[]
}): Promise<{
  id: string
  mnemonic: string | null
  title: string
  status: TaskStatus
  assigneeId: string | null
}> {
  const title = input.title?.trim() ?? ''
  if (!input.parentId || !title) {
    throw new Error('[INVALID_INPUT] título o padre requerido')
  }

  const parent = await prisma.task.findUnique({
    where: { id: input.parentId },
    select: { id: true, projectId: true, type: true },
  })
  if (!parent) throw new Error('[NOT_FOUND] tarea padre no encontrada')

  // Control de acceso: mismo patrón debug que `updateTask`. Cuando exista
  // sesión, validar que el usuario esté asignado al proyecto.
  const roles = input.userRoles ?? []
  const isAdmin = roles.some((r) => r === 'ADMIN' || r === 'SUPER_ADMIN')
  void isAdmin // explícito: por ahora siempre permitido si llega userRoles

  const mnemonic = await nextMnemonicForProject(parent.projectId)

  const created = await prisma.task.create({
    data: {
      title,
      mnemonic,
      projectId: parent.projectId,
      type: parent.type,
      status: 'TODO',
      priority: 'MEDIUM',
      parentId: parent.id,
      assigneeId: input.assigneeId || null,
    },
    select: {
      id: true,
      mnemonic: true,
      title: true,
      status: true,
      assigneeId: true,
    },
  })

  revalidateTaskViews()
  return created
}

/**
 * Cierra/abre una subtarea desde el checkbox del listado inline.
 *
 * - `done=true` → status `DONE`, progress 100.
 * - `done=false` → status `TODO`, progress 0.
 *
 * Crea entrada de historial sólo del campo `status` (el progress es
 * derivado y se considera ruido para el timeline humano).
 */
export async function toggleSubtaskDone(input: {
  id: string
  done: boolean
} & RoleCheckInput): Promise<{ id: string; status: TaskStatus; progress: number }> {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const current = await prisma.task.findUnique({
    where: { id: input.id },
    select: { id: true, status: true, progress: true },
  })
  if (!current) throw new Error('[NOT_FOUND] subtarea no encontrada')

  const nextStatus: TaskStatus = input.done ? 'DONE' : 'TODO'
  const nextProgress = input.done ? 100 : 0

  const [updated] = await prisma.$transaction([
    prisma.task.update({
      where: { id: input.id },
      data: { status: nextStatus, progress: nextProgress },
      select: { id: true, status: true, progress: true },
    }),
    prisma.taskHistory.create({
      data: {
        taskId: input.id,
        field: 'status',
        oldValue: String(current.status),
        newValue: String(nextStatus),
        userId: input.userId || null,
      },
    }),
  ])

  revalidateTaskViews()
  return updated
}

/**
 * Reasigna una subtarea desde el mini-selector inline. `assigneeId=null`
 * desasigna explícitamente (no es lo mismo que omitir el campo).
 */
export async function assignSubtaskInline(input: {
  id: string
  assigneeId: string | null
} & RoleCheckInput): Promise<{ id: string; assigneeId: string | null }> {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const current = await prisma.task.findUnique({
    where: { id: input.id },
    select: { id: true, assigneeId: true },
  })
  if (!current) throw new Error('[NOT_FOUND] subtarea no encontrada')

  // No-op: si no cambió, no escribimos historial ni revalidamos vistas.
  const nextAssignee = input.assigneeId || null
  if (nextAssignee === (current.assigneeId || null)) {
    return { id: current.id, assigneeId: current.assigneeId ?? null }
  }

  const [updated] = await prisma.$transaction([
    prisma.task.update({
      where: { id: input.id },
      data: { assigneeId: nextAssignee },
      select: { id: true, assigneeId: true },
    }),
    prisma.taskHistory.create({
      data: {
        taskId: input.id,
        field: 'assigneeId',
        oldValue: current.assigneeId ?? '',
        newValue: nextAssignee ?? '',
        userId: input.userId || null,
      },
    }),
  ])

  revalidateTaskViews()
  return updated
}

/**
 * Lista de subtareas serializadas para el tab. Sólo se invoca si el
 * cliente no las recibió ya como prop (`task.subtasks`) — evitamos un
 * round-trip innecesario en el caso común.
 */
export async function getSubtasks(parentId: string): Promise<SerializedTask[]> {
  if (!parentId) return []
  const subtasks = await prisma.task.findMany({
    where: { parentId },
    include: { assignee: true },
    orderBy: { createdAt: 'asc' },
  })
  return subtasks.map((s) => serializeTask(s as unknown as Record<string, unknown>))
}

