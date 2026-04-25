import { tool } from 'ai'
import { z } from 'zod'
import prisma from '@/lib/prisma'

const TASK_STATUS = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const
const PRIORITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
const TASK_TYPE = ['AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET'] as const

const MAX_RESULTS = 20

export const brainTools = {
  listProjects: tool({
    description:
      'Devuelve los proyectos activos (no archivados) con métricas básicas: total de tareas, completadas y % de avance. Útil para responder "¿qué proyectos hay?" o dar contexto antes de búsquedas más específicas.',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe('Máximo de proyectos a devolver (default 10).'),
    }),
    execute: async ({ limit }) => {
      const projects = await prisma.project.findMany({
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          tasks: {
            where: { archivedAt: null },
            select: { status: true, progress: true },
          },
        },
      })
      return projects.map((p) => {
        const total = p.tasks.length
        const done = p.tasks.filter((t) => t.status === 'DONE').length
        const avgProgress =
          total > 0
            ? Math.round(p.tasks.reduce((s, t) => s + (t.progress ?? 0), 0) / total)
            : 0
        return {
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          totalTasks: total,
          doneTasks: done,
          avgProgress,
        }
      })
    },
  }),

  getProjectStatus: tool({
    description:
      'Devuelve métricas detalladas de un proyecto: distribución por estado, tareas críticas, atrasadas, y agregados EVM (planned/actual/earned value) si están disponibles.',
    inputSchema: z.object({
      projectId: z
        .string()
        .optional()
        .describe('ID exacto del proyecto. Si no se provee, usar projectName.'),
      projectName: z
        .string()
        .optional()
        .describe('Nombre del proyecto (búsqueda parcial insensitive). Usar solo si no hay projectId.'),
    }),
    execute: async ({ projectId, projectName }) => {
      if (!projectId && !projectName) {
        return { error: 'Debes proveer projectId o projectName.' }
      }
      const project = await prisma.project.findFirst({
        where: projectId
          ? { id: projectId }
          : { name: { contains: projectName!, mode: 'insensitive' } },
        select: {
          id: true,
          name: true,
          description: true,
          status: true,
          tasks: {
            where: { archivedAt: null },
            select: {
              id: true,
              title: true,
              status: true,
              priority: true,
              progress: true,
              endDate: true,
              plannedValue: true,
              actualCost: true,
              earnedValue: true,
            },
          },
        },
      })
      if (!project) return { error: 'Proyecto no encontrado.' }

      const now = new Date()
      const byStatus = Object.fromEntries(
        TASK_STATUS.map((s) => [s, project.tasks.filter((t) => t.status === s).length]),
      )
      const critical = project.tasks.filter(
        (t) => t.priority === 'CRITICAL' && t.status !== 'DONE',
      )
      const overdue = project.tasks.filter(
        (t) => t.endDate && t.endDate < now && t.status !== 'DONE',
      )
      const sum = (xs: (number | null | undefined)[]) =>
        xs.reduce<number>((s, x) => s + (x ?? 0), 0)

      return {
        id: project.id,
        name: project.name,
        status: project.status,
        totalTasks: project.tasks.length,
        byStatus,
        criticalOpen: critical.length,
        overdueCount: overdue.length,
        avgProgress:
          project.tasks.length > 0
            ? Math.round(sum(project.tasks.map((t) => t.progress)) / project.tasks.length)
            : 0,
        evm: {
          plannedValue: sum(project.tasks.map((t) => t.plannedValue)),
          actualCost: sum(project.tasks.map((t) => t.actualCost)),
          earnedValue: sum(project.tasks.map((t) => t.earnedValue)),
        },
        criticalTasks: critical.slice(0, 5).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          progress: t.progress,
        })),
      }
    },
  }),

  searchTasks: tool({
    description:
      'Busca tareas por texto libre (título o descripción) con filtros opcionales de estado, prioridad, tipo, proyecto o asignado. Devuelve máximo 20 resultados ordenados por updatedAt desc.',
    inputSchema: z.object({
      query: z.string().optional().describe('Texto a buscar en título y descripción (insensitive).'),
      status: z.enum(TASK_STATUS).optional(),
      priority: z.enum(PRIORITY).optional(),
      type: z.enum(TASK_TYPE).optional(),
      projectId: z.string().optional(),
      assigneeName: z
        .string()
        .optional()
        .describe('Nombre parcial del usuario asignado (insensitive).'),
    }),
    execute: async ({ query, status, priority, type, projectId, assigneeName }) => {
      const tasks = await prisma.task.findMany({
        where: {
          archivedAt: null,
          ...(query && {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { description: { contains: query, mode: 'insensitive' } },
            ],
          }),
          ...(status && { status }),
          ...(priority && { priority }),
          ...(type && { type }),
          ...(projectId && { projectId }),
          ...(assigneeName && {
            assignee: { name: { contains: assigneeName, mode: 'insensitive' } },
          }),
        },
        take: MAX_RESULTS,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          mnemonic: true,
          title: true,
          status: true,
          priority: true,
          type: true,
          progress: true,
          startDate: true,
          endDate: true,
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true } },
        },
      })
      return tasks.map((t) => ({
        id: t.id,
        mnemonic: t.mnemonic,
        title: t.title,
        status: t.status,
        priority: t.priority,
        type: t.type,
        progress: t.progress,
        startDate: t.startDate?.toISOString().slice(0, 10) ?? null,
        endDate: t.endDate?.toISOString().slice(0, 10) ?? null,
        project: t.project,
        assignee: t.assignee,
      }))
    },
  }),

  getTaskDetails: tool({
    description:
      'Devuelve el detalle completo de una tarea por ID o por mnemónico (ej. "PROJ-1"): descripción, fechas, progreso, dependencias, comentarios recientes e historial de cambios (últimos 10).',
    inputSchema: z.object({
      id: z.string().optional().describe('UUID de la tarea.'),
      mnemonic: z.string().optional().describe('Mnemónico legible (ej. "INFR-3").'),
    }),
    execute: async ({ id, mnemonic }) => {
      if (!id && !mnemonic) return { error: 'Debes proveer id o mnemonic.' }
      const task = await prisma.task.findFirst({
        where: id ? { id } : { mnemonic: mnemonic! },
        include: {
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true } },
          predecessors: {
            include: {
              predecessor: { select: { id: true, mnemonic: true, title: true, status: true } },
            },
          },
          successors: {
            include: {
              successor: { select: { id: true, mnemonic: true, title: true, status: true } },
            },
          },
          comments: {
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              content: true,
              createdAt: true,
              author: { select: { name: true } },
            },
          },
          history: {
            take: 10,
            orderBy: { createdAt: 'desc' },
            select: {
              field: true,
              oldValue: true,
              newValue: true,
              createdAt: true,
            },
          },
        },
      })
      if (!task) return { error: 'Tarea no encontrada.' }
      return {
        id: task.id,
        mnemonic: task.mnemonic,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        type: task.type,
        progress: task.progress,
        startDate: task.startDate?.toISOString().slice(0, 10) ?? null,
        endDate: task.endDate?.toISOString().slice(0, 10) ?? null,
        project: task.project,
        assignee: task.assignee,
        predecessors: task.predecessors.map((d) => ({
          type: d.type,
          task: d.predecessor,
        })),
        successors: task.successors.map((d) => ({
          type: d.type,
          task: d.successor,
        })),
        recentComments: task.comments.map((c) => ({
          author: c.author?.name ?? 'Anónimo',
          content: c.content,
          at: c.createdAt.toISOString(),
        })),
        recentHistory: task.history,
      }
    },
  }),

  getOverdueTasks: tool({
    description:
      'Devuelve las tareas atrasadas (endDate < hoy y status != DONE), ordenadas por prioridad y fecha de vencimiento. Filtrable por proyecto o asignado.',
    inputSchema: z.object({
      projectId: z.string().optional(),
      assigneeName: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    execute: async ({ projectId, assigneeName, limit }) => {
      const tasks = await prisma.task.findMany({
        where: {
          archivedAt: null,
          status: { not: 'DONE' },
          endDate: { lt: new Date() },
          ...(projectId && { projectId }),
          ...(assigneeName && {
            assignee: { name: { contains: assigneeName, mode: 'insensitive' } },
          }),
        },
        take: limit,
        orderBy: [{ priority: 'desc' }, { endDate: 'asc' }],
        select: {
          id: true,
          mnemonic: true,
          title: true,
          status: true,
          priority: true,
          progress: true,
          endDate: true,
          project: { select: { id: true, name: true } },
          assignee: { select: { id: true, name: true } },
        },
      })
      const now = Date.now()
      return tasks.map((t) => ({
        id: t.id,
        mnemonic: t.mnemonic,
        title: t.title,
        status: t.status,
        priority: t.priority,
        progress: t.progress,
        endDate: t.endDate?.toISOString().slice(0, 10) ?? null,
        daysOverdue: t.endDate
          ? Math.ceil((now - t.endDate.getTime()) / 86_400_000)
          : null,
        project: t.project,
        assignee: t.assignee,
      }))
    },
  }),
}
