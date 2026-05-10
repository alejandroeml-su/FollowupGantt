import 'server-only'

/**
 * Wave P18-D · Performance Reports PMI — Queries compartidas.
 *
 * Cargan en bulk los datos necesarios para los 3 reportes ejecutivos
 * (Status / Final / Lessons Summary). Helpers puros que devuelven shape
 * serializable; los renderers HTML/Excel los consumen sin re-querying.
 */

import prisma from '@/lib/prisma'

export interface ProjectReportData {
  project: {
    id: string
    name: string
    description: string | null
    status: string
    methodology: string | null
    startDate: string | null
    endDate: string | null
  }
  tasks: {
    total: number
    done: number
    inProgress: number
    todo: number
    review: number
    totalSp: number
    doneSp: number
  }
  evm: {
    pv: number
    ev: number
    ac: number
    cpi: number
    spi: number
    eac: number
    bac: number | null
  } | null
  risks: {
    high: number
    medium: number
    low: number
    open: number
    closed: number
    topRisks: Array<{
      title: string
      score: number
      tier: string
      status: string
    }>
  }
  defects: {
    open: number
    critical: number
    fixed: number
    total: number
  }
  inspections: {
    pending: number
    pass: number
    fail: number
    total: number
  }
  sprints: Array<{
    name: string
    status: string
    velocityActual: number | null
    startDate: string
    endDate: string
  }>
  lessons: Array<{
    category: string
    title: string
    context: string
    whatHappened: string
    recommendation: string
    createdAt: string
  }>
  generatedAt: string
}

/**
 * Carga bulk de todos los datos del reporte para un proyecto.
 * Single-shot — el caller decide qué subset renderizar.
 */
export async function loadProjectReportData(
  projectId: string,
): Promise<ProjectReportData | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      methodology: true,
      createdAt: true,
      budget: true,
    },
  })
  if (!project) return null

  // Project no tiene start/end propios; los inferimos del min/max de tasks
  // para mostrar rango ejecutivo en el reporte (no es el "schedule baseline"
  // formal pero sirve como heurística).
  const dateBounds = await prisma.task.aggregate({
    where: { projectId, archivedAt: null },
    _min: { startDate: true },
    _max: { endDate: true },
  })

  const [
    taskGroups,
    spAgg,
    doneSpAgg,
    riskRows,
    defectRows,
    inspectionRows,
    sprintRows,
    lessonRows,
    latestEvm,
  ] = await Promise.all([
    prisma.task.groupBy({
      by: ['status'],
      where: { projectId, archivedAt: null },
      _count: { _all: true },
    }),
    prisma.task.aggregate({
      where: { projectId, archivedAt: null },
      _sum: { storyPoints: true },
    }),
    prisma.task.aggregate({
      where: { projectId, archivedAt: null, status: 'DONE' },
      _sum: { storyPoints: true },
    }),
    prisma.risk.findMany({
      where: { projectId },
      select: {
        title: true,
        probability: true,
        impact: true,
        status: true,
      },
      orderBy: [{ probability: 'desc' }, { impact: 'desc' }],
    }),
    prisma.defect.findMany({
      where: { projectId },
      select: { severity: true, status: true },
    }),
    prisma.qualityInspection.findMany({
      where: { projectId },
      select: { result: true },
    }),
    prisma.sprint.findMany({
      where: { projectId },
      select: {
        name: true,
        status: true,
        velocityActual: true,
        startDate: true,
        endDate: true,
      },
      orderBy: { startDate: 'asc' },
    }),
    prisma.lessonLearned.findMany({
      where: { projectId },
      select: {
        category: true,
        title: true,
        context: true,
        whatHappened: true,
        recommendation: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.eVMSnapshot.findFirst({
      where: { projectId },
      orderBy: { snapshotDate: 'desc' },
      select: {
        plannedValue: true,
        earnedValue: true,
        actualCost: true,
        cpi: true,
        spi: true,
        estimateAtCompletion: true,
      },
    }),
  ])

  const totalByStatus = Object.fromEntries(
    taskGroups.map((g) => [g.status, g._count._all]),
  ) as Record<string, number>

  // Calcular score/tier en JS (mismo formato que serializeRisk).
  const scoredRisks = riskRows.map((r) => {
    const score = r.probability * r.impact
    const tier = score >= 20 ? 'CRITICAL' : score >= 12 ? 'HIGH' : score >= 6 ? 'MEDIUM' : 'LOW'
    return { ...r, score, tier }
  })

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      methodology: project.methodology ?? null,
      startDate: dateBounds._min.startDate?.toISOString() ?? null,
      endDate: dateBounds._max.endDate?.toISOString() ?? null,
    },
    tasks: {
      total: Object.values(totalByStatus).reduce((s, n) => s + n, 0),
      done: totalByStatus['DONE'] ?? 0,
      inProgress: totalByStatus['IN_PROGRESS'] ?? 0,
      todo: totalByStatus['TODO'] ?? 0,
      review: totalByStatus['REVIEW'] ?? 0,
      totalSp: spAgg._sum.storyPoints ?? 0,
      doneSp: doneSpAgg._sum.storyPoints ?? 0,
    },
    evm: latestEvm
      ? {
          pv: Number(latestEvm.plannedValue),
          ev: Number(latestEvm.earnedValue),
          ac: Number(latestEvm.actualCost),
          cpi: latestEvm.cpi ?? 0,
          spi: latestEvm.spi ?? 0,
          eac: latestEvm.estimateAtCompletion
            ? Number(latestEvm.estimateAtCompletion)
            : 0,
          bac: project.budget ? Number(project.budget) : null,
        }
      : null,
    risks: {
      high: scoredRisks.filter((r) => r.tier === 'HIGH' || r.tier === 'CRITICAL').length,
      medium: scoredRisks.filter((r) => r.tier === 'MEDIUM').length,
      low: scoredRisks.filter((r) => r.tier === 'LOW').length,
      open: scoredRisks.filter((r) => r.status === 'OPEN' || r.status === 'MITIGATING').length,
      closed: scoredRisks.filter((r) => r.status === 'CLOSED').length,
      topRisks: scoredRisks.slice(0, 10).map((r) => ({
        title: r.title,
        score: r.score,
        tier: r.tier,
        status: r.status,
      })),
    },
    defects: {
      open: defectRows.filter((d) => d.status === 'OPEN' || d.status === 'IN_REVIEW').length,
      critical: defectRows.filter((d) => d.severity === 'CRITICAL' && d.status !== 'FIXED').length,
      fixed: defectRows.filter((d) => d.status === 'FIXED').length,
      total: defectRows.length,
    },
    inspections: {
      pending: inspectionRows.filter((i) => i.result === 'PENDING').length,
      pass: inspectionRows.filter((i) => i.result === 'PASS' || i.result === 'PASS_WITH_DEFECTS').length,
      fail: inspectionRows.filter((i) => i.result === 'FAIL').length,
      total: inspectionRows.length,
    },
    sprints: sprintRows.map((s) => ({
      name: s.name,
      status: s.status,
      velocityActual: s.velocityActual ?? null,
      startDate: s.startDate.toISOString(),
      endDate: s.endDate.toISOString(),
    })),
    lessons: lessonRows.map((l) => ({
      category: l.category,
      title: l.title,
      context: l.context,
      whatHappened: l.whatHappened,
      recommendation: l.recommendation,
      createdAt: l.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  }
}
