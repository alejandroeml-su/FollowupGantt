/**
 * Wave P12 (PMI 100%) — EVM snapshot computation.
 *
 * Recopila datos de Cost (Expense) + Schedule (Task progress) + Budget
 * (Project.budget) y produce un snapshot consolidado que se persiste
 * en `EVMSnapshot` para construir la curva-S.
 *
 * Fórmulas PMBOK:
 *   PV  = % planeado × BAC
 *   EV  = % completado × BAC
 *   AC  = Σ Expenses incurridos
 *   CPI = EV / AC
 *   SPI = EV / PV
 *   EAC = BAC / CPI       (asumiendo el patrón de costo continúa)
 *   VAC = BAC - EAC
 */

import prisma from '@/lib/prisma'

export interface EVMComputed {
  plannedValue: number
  earnedValue: number
  actualCost: number
  budgetAtCompletion: number | null
  cpi: number | null
  spi: number | null
  estimateAtCompletion: number | null
  varianceAtCompletion: number | null
}

export async function computeEVMForProject(
  projectId: string,
  asOf: Date = new Date(),
): Promise<EVMComputed> {
  const [project, tasks, expenses] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { budget: true },
    }),
    prisma.task.findMany({
      where: { projectId },
      select: {
        startDate: true,
        endDate: true,
        progress: true,
        plannedValue: true,
      },
    }),
    prisma.expense.findMany({
      where: { projectId, incurredAt: { lte: asOf } },
      select: { amount: true },
    }),
  ])

  const bac = project?.budget ? Number(project.budget) : null

  // PV: suma de plannedValue de tasks cuya startDate <= asOf
  // (proporcional al schedule planeado vs asOf).
  let pv = 0
  let ev = 0
  for (const t of tasks) {
    const tPV = t.plannedValue ? Number(t.plannedValue) : 0
    if (!tPV) continue
    if (!t.startDate || !t.endDate) {
      // Sin fechas — contar full PV solo si ya pasó (heurística simple).
      pv += tPV
      continue
    }
    const start = t.startDate.getTime()
    const end = t.endDate.getTime()
    const at = asOf.getTime()
    if (at <= start) continue
    const planned = at >= end ? 1 : (at - start) / Math.max(1, end - start)
    pv += tPV * planned
    ev += tPV * ((t.progress ?? 0) / 100)
  }

  const ac = expenses.reduce((sum, e) => sum + Number(e.amount), 0)

  const cpi = ac > 0 ? ev / ac : null
  const spi = pv > 0 ? ev / pv : null
  const eac = bac && cpi && cpi > 0 ? bac / cpi : null
  const vac = bac !== null && eac !== null ? bac - eac : null

  return {
    plannedValue: round2(pv),
    earnedValue: round2(ev),
    actualCost: round2(ac),
    budgetAtCompletion: bac,
    cpi: cpi !== null ? round2(cpi) : null,
    spi: spi !== null ? round2(spi) : null,
    estimateAtCompletion: eac !== null ? round2(eac) : null,
    varianceAtCompletion: vac !== null ? round2(vac) : null,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
