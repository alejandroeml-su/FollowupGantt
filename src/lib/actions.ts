'use server'

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

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
    data: { name, description, status: status as any, areaId: areaId || null }
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
    data: { name, description, status: status as any }
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
      status: status as any,
      priority: priority as any,
      type: type as any,
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
  const assigneeId = formData.get('assigneeId') as string || undefined
  const endDateStr = formData.get('endDate') as string
  const description = formData.get('description') as string || undefined

  if (!id) throw new Error('ID es requerido')

  const data: Record<string, unknown> = {}
  if (title) data.title = title
  if (status) data.status = status
  if (priority) data.priority = priority
  if (description !== undefined) data.description = description
  if (assigneeId) data.assigneeId = assigneeId
  if (endDateStr) data.endDate = new Date(endDateStr)

  await prisma.task.update({ where: { id }, data })
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
    data: { status: status as any }
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
    data: { name, email, role: role as any }
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

export async function createComment(formData: FormData) {
  const content = formData.get('content') as string
  const taskId = formData.get('taskId') as string
  const authorId = formData.get('authorId') as string || undefined

  if (!content || !taskId) throw new Error('Contenido y tarea son requeridos')

  await prisma.comment.create({
    data: { content, taskId, authorId: authorId || null }
  })
  revalidatePath('/list')
  revalidatePath('/kanban')
  revalidatePath('/gantt')
  revalidatePath('/table')
}

export async function getTaskWithComments(taskId: string) {
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
    },
  })
}

