'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { sendMentionNotification } from '@/lib/email/mention-notification'
import type {
  TaskType,
  ProjectStatus,
  Priority,
  TaskStatus,
  DependencyType,
} from '@prisma/client'

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
    }
  })
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
  const historyEntries: any[] = []

  const checkChange = (field: string, newValue: any, oldValue: any) => {
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

  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
  revalidatePath('/workload')
  revalidatePath('/mindmaps')
}

export async function deleteTask(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('ID es requerido')

  await prisma.task.delete({ where: { id } })
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
  revalidatePath('/gantt')
}

export async function removeDependency(formData: FormData) {
  const predecessorId = formData.get('predecessorId') as string
  const successorId = formData.get('successorId') as string

  await prisma.taskDependency.delete({
    where: { predecessorId_successorId: { predecessorId, successorId } }
  })
  revalidatePath('/gantt')
}

export async function updateTaskStatus(id: string, status: string) {
  await prisma.task.update({
    where: { id },
    data: { status: status as TaskStatus }
  })
  revalidatePath('/list')
  revalidatePath('/kanban')
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
    const [mentionedUsers, task, author] = await Promise.all([
      prisma.user.findMany({
        where: { OR: [{ email: { in: handles } }, { name: { in: handles } }] },
        select: { id: true, email: true, name: true },
      }),
      prisma.task.findUnique({
        where: { id: taskId },
        select: {
          title: true,
          mnemonic: true,
          parent: { select: { title: true } },
        },
      }),
      authorId
        ? prisma.user.findUnique({ where: { id: authorId }, select: { name: true } })
        : Promise.resolve(null),
    ])

    const recipients = mentionedUsers.filter((u) => u.id !== authorId)
    if (task && recipients.length > 0) {
      const authorName = author?.name ?? 'Un colaborador'
      const parentTitle = task.parent?.title ?? null
      after(async () => {
        await Promise.all(
          recipients.map((user) =>
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

