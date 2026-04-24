'use server'

import prisma from '@/lib/prisma'

export type PaletteEntry =
  | {
      kind: 'task'
      id: string
      label: string
      hint?: string
      projectId: string
    }
  | {
      kind: 'project'
      id: string
      label: string
      hint?: string
    }

/**
 * Fuente de datos para la paleta de comandos. Devuelve hasta `limit` tareas
 * y proyectos, usados por fuse.js en el cliente. Evita devolver campos
 * sensibles (description, sla).
 */
export async function fetchPaletteData(limit = 200): Promise<PaletteEntry[]> {
  const [tasks, projects] = await Promise.all([
    prisma.task.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        title: true,
        projectId: true,
        project: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    }),
    prisma.project.findMany({
      select: { id: true, name: true, status: true },
      orderBy: { name: 'asc' },
      take: 50,
    }),
  ])

  const out: PaletteEntry[] = []
  for (const p of projects) {
    out.push({
      kind: 'project',
      id: p.id,
      label: p.name,
      hint: p.status,
    })
  }
  for (const t of tasks) {
    out.push({
      kind: 'task',
      id: t.id,
      label: t.title,
      hint: t.project.name,
      projectId: t.projectId,
    })
  }
  return out
}
