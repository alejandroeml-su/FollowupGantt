import prisma from '@/lib/prisma'
import type {
  CpmDependencyInput,
  CpmInput,
  CpmTaskInput,
  DependencyType,
} from './cpm'

const MS_PER_DAY = 86_400_000

function diffDaysUTC(a: Date, b: Date): number {
  return Math.round(
    (Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
      Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) /
      MS_PER_DAY,
  )
}

function mapDepType(t: string): DependencyType {
  switch (t) {
    case 'START_TO_START':
      return 'SS'
    case 'FINISH_TO_FINISH':
      return 'FF'
    case 'START_TO_FINISH':
      return 'SF'
    case 'FINISH_TO_START':
    default:
      return 'FS'
  }
}

/**
 * Carga las tareas no archivadas + dependencias de un proyecto y las mapea
 * al formato puro que consume `computeCpm`.
 *
 * - duration: días enteros entre startDate y endDate (mínimo 1 si la tarea
 *   no es hito y tiene fechas; 0 si es hito; 1 como fallback si faltan
 *   fechas).
 * - earliestStartConstraint: días desde projectStart hasta startDate; 0 si
 *   la tarea inicia antes que el projectStart (la del proyecto se ancla en
 *   la mínima startDate de las tareas).
 */
export async function loadCpmInputForProject(
  projectId: string,
): Promise<CpmInput> {
  const tasksDb = await prisma.task.findMany({
    where: { projectId, archivedAt: null },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      isMilestone: true,
    },
  })

  const taskIds = tasksDb.map((t) => t.id)
  const depsDb = taskIds.length
    ? await prisma.taskDependency.findMany({
        where: {
          OR: [
            { predecessorId: { in: taskIds } },
            { successorId: { in: taskIds } },
          ],
        },
        select: {
          predecessorId: true,
          successorId: true,
          type: true,
          lagDays: true,
        },
      })
    : []

  // Determinar projectStart: la mínima startDate disponible, o hoy si nadie
  // tiene fecha (degenerado).
  const dated = tasksDb
    .map((t) => t.startDate)
    .filter((d): d is Date => d instanceof Date)
  const projectStart =
    dated.length > 0
      ? new Date(Math.min(...dated.map((d) => d.getTime())))
      : new Date()
  // Normalizar a 00:00 UTC
  projectStart.setUTCHours(0, 0, 0, 0)

  const tasks: CpmTaskInput[] = tasksDb.map((t) => {
    let duration = 1
    if (t.isMilestone) {
      duration = 0
    } else if (t.startDate && t.endDate) {
      duration = Math.max(1, diffDaysUTC(t.startDate, t.endDate))
    }
    const earliestStartConstraint = t.startDate
      ? Math.max(0, diffDaysUTC(projectStart, t.startDate))
      : undefined
    return {
      id: t.id,
      duration,
      isMilestone: !!t.isMilestone,
      earliestStartConstraint,
    }
  })

  const dependencies: CpmDependencyInput[] = depsDb.map((d) => ({
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    type: mapDepType(d.type),
    lag: d.lagDays ?? 0,
  }))

  return { projectStart, tasks, dependencies }
}
