'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import type {
  ProjectStatus,
  TaskStatus,
  Priority,
  TaskType,
  Role,
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

  await prisma.task.create({
    data: {
      title,
      description,
      projectId,
      status: status as TaskStatus,
      priority: priority as Priority,
      type: type as TaskType,
      parentId: parentId || null,
      assigneeId: assigneeId || null,
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
  const userId = formData.get('userId') as string || undefined // ID del usuario que hace el cambio

  if (!id) throw new Error('ID es requerido')

  // Obtener estado anterior para el historial
  const oldTask = await prisma.task.findUnique({ where: { id } })
  if (!oldTask) throw new Error('Tarea no encontrada')

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
  if (endDateStr) checkChange('endDate', new Date(endDateStr), oldTask.endDate)
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
  const role = (formData.get('role') as string) || 'DEVELOPER'

  if (!name || !email) throw new Error('Nombre y email son requeridos')

  await prisma.user.create({
    data: { name, email, role: role as Role }
  })
  revalidatePath('/workload')
}

export async function deleteUser(formData: FormData) {
  const id = formData.get('id') as string
  if (!id) throw new Error('ID es requerido')

  await prisma.user.delete({ where: { id } })
  revalidatePath('/workload')
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

/**
 * Simula el envío de un correo electrónico cuando se menciona a alguien.
 * En producción, esto se integraría con Resend, SendGrid, etc.
 */
async function sendMentionEmail(userEmail: string, taskTitle: string, commentContent: string) {
  console.log(`[EMAIL SIMULATION] Sending to ${userEmail}:`)
  console.log(`Subject: Has sido mencionado en la tarea: ${taskTitle}`)
  console.log(`Body: ${commentContent}`)
}

export async function createComment(formData: FormData) {
  const content = formData.get('content') as string
  const taskId = formData.get('taskId') as string
  const authorId = formData.get('authorId') as string || undefined
  const isInternal = formData.get('isInternal') === 'true'

  if (!content || !taskId) throw new Error('Contenido y tarea son requeridos')

  const comment = await prisma.comment.create({
    data: { 
      content, 
      taskId, 
      authorId: authorId || null,
      isInternal
    },
    include: { task: true }
  })

  // Lógica de menciones: Buscar @email.com o @nombre
  const mentions = content.match(/@[\w.-]+@[\w.-]+\.\w+|@[\w.-]+/g)
  if (mentions) {
    for (const mention of mentions) {
      const target = mention.substring(1) // Quitar el @
      // Buscar usuario por email o nombre
      const user = await prisma.user.findFirst({
        where: { OR: [{ email: target }, { name: target }] }
      })
      if (user) {
        await sendMentionEmail(user.email, comment.task.title, content)
      }
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
      }
    },
  })
}

