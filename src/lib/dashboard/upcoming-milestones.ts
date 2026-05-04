import 'server-only'

/**
 * Equipo D3 · Dashboard ejecutivo unificado — helper de hitos próximos.
 *
 * Devuelve los hitos (`Task.isMilestone = true`, status != DONE, no
 * archivados) cuyo `endDate` cae en una ventana [hoy, hoy + days]. La
 * lista viene ordenada por proximidad (endDate asc) y limitada con
 * `take` para no sobrecargar el dashboard.
 *
 * Decisión D3-MS-1: usamos exclusivamente `isMilestone = true` (campo
 * existente en el schema). NO consideramos `duration === 0` como proxy
 * porque no hay un campo `duration` real en `Task` (la duración se
 * calcula vía CPM y no está persistida).
 *
 * Decisión D3-MS-2: el `daysUntil` se calcula con UTC para ser
 * determinista en tests y consistente con el resto del repo (ver
 * `src/lib/actions/reports.ts::diffDaysUTC`).
 */

import prisma from '@/lib/prisma'

const MS_PER_DAY = 86_400_000

function diffDaysUTC(a: Date, b: Date): number {
  const aUTC = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const bUTC = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return Math.round((bUTC - aUTC) / MS_PER_DAY)
}

export type UpcomingMilestone = {
  id: string
  title: string
  endDate: string // ISO
  daysUntil: number
  projectId: string
  projectName: string
  status: 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'
}

export async function getUpcomingMilestones(opts?: {
  days?: number
  take?: number
  now?: Date
}): Promise<UpcomingMilestone[]> {
  const days = opts?.days ?? 14
  const take = opts?.take ?? 5
  const now = opts?.now ?? new Date()

  const horizon = new Date(now.getTime() + days * MS_PER_DAY)

  const rows = await prisma.task.findMany({
    where: {
      isMilestone: true,
      archivedAt: null,
      status: { not: 'DONE' },
      endDate: { gte: now, lte: horizon },
    },
    select: {
      id: true,
      title: true,
      endDate: true,
      status: true,
      project: { select: { id: true, name: true } },
    },
    orderBy: { endDate: 'asc' },
    take,
  })

  return rows
    .filter((r): r is typeof r & { endDate: Date } => r.endDate != null)
    .map((r) => ({
      id: r.id,
      title: r.title,
      endDate: r.endDate.toISOString(),
      daysUntil: diffDaysUTC(now, r.endDate),
      projectId: r.project.id,
      projectName: r.project.name,
      status: r.status as UpcomingMilestone['status'],
    }))
}
