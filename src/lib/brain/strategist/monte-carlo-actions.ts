'use server'

/**
 * Wave P20-B · Brain Strategist Monte Carlo — Server actions.
 *
 * Carga proyectos activos del workspace del usuario, sus tareas con
 * fechas, las cross-dependencies y arma el input determinista para el
 * simulador `runMonteCarloPortfolio`. Persiste el resultado consolidado
 * en `BrainStrategistInsight` con `kind: PREDICTIVE_SCENARIO`.
 *
 * Errores tipados:
 *   - [INVALID_INPUT]  iteraciones inválidas / parámetro corrupto.
 *   - [NO_PROJECTS]    workspace sin proyectos activos.
 *   - [NOT_FOUND]      proyecto referenciado no existe.
 *   - [UNAUTHORIZED]   sin sesión (heredado de requireUser).
 */

import { z } from 'zod'
import { type Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import {
  runMonteCarloPortfolio,
  seedRandom,
  probabilityFinishBy,
  type MonteCarloInput,
  type MonteCarloResult,
  type MonteCarloProjectInput,
} from './monte-carlo'

const DEFAULT_ITERATIONS = 10_000
const MAX_ITERATIONS = 100_000
const DEFAULT_STD_FACTOR = 0.25
const MIN_DURATION_DAYS = 1

const InputSchema = z.object({
  iterations: z.number().int().min(100).max(MAX_ITERATIONS).optional(),
  stdFactor: z.number().min(0.01).max(2).optional(),
  /** Si se pasa, deja muestras descartadas al final (no afecta percentiles). */
  targetDate: z.string().datetime().optional(),
  /** Seed para tests/reproducibilidad. */
  seed: z.number().int().optional(),
})

export type RunMonteCarloInput = z.input<typeof InputSchema>

export interface RunMonteCarloResponse {
  result: MonteCarloResult
  probabilityOnTime: number | null
  targetDate: string | null
  insightId: string | null
  scanned: {
    projects: number
    tasks: number
    crossDeps: number
  }
}

/**
 * Ejecuta Monte Carlo cross-project sobre los proyectos activos del
 * workspace del usuario actual y persiste el resumen.
 */
export async function runMonteCarloAcrossProjects(
  input: RunMonteCarloInput = {},
): Promise<RunMonteCarloResponse> {
  const user = await requireUser()

  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(
      `[INVALID_INPUT] ${parsed.error.issues.map((i) => i.message).join(', ')}`,
    )
  }
  const {
    iterations = DEFAULT_ITERATIONS,
    stdFactor = DEFAULT_STD_FACTOR,
    targetDate,
    seed,
  } = parsed.data

  // Proyectos activos del workspace del usuario.
  // El user puede no tener workspaceId (legacy); en ese caso queda null
  // y la query filtra workspaceId: null (proyectos sin workspace).
  const workspaceId = user.workspaceId ?? null
  const projects = await prisma.project.findMany({
    where: {
      OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }],
      ...(workspaceId ? { workspaceId } : { workspaceId: null }),
    },
    select: {
      id: true,
      name: true,
      tasks: {
        where: { archivedAt: null },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          progress: true,
          status: true,
          plannedValue: true,
        },
        orderBy: { position: 'asc' },
      },
    },
  })

  if (projects.length === 0) {
    throw new Error('[NO_PROJECTS] No hay proyectos activos para simular')
  }

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const todayIso = today.toISOString()

  const mcProjects: MonteCarloProjectInput[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    tasks: p.tasks
      .map((t) => {
        const meanDays = estimateTaskMeanDays(
          t.startDate,
          t.endDate,
          t.status,
          t.progress ?? 0,
        )
        const std = Math.max(0, meanDays * stdFactor)
        return {
          id: t.id,
          projectId: p.id,
          durationDaysMean: meanDays,
          durationDaysStd: std,
        }
      })
      // Filtra DONE/CANCELLED y tareas con duración 0 (no aportan).
      .filter((t) => t.durationDaysMean > 0),
  }))

  // Cross-project deps del workspace (filtramos por tasks en scope).
  const inScopeTaskIds = new Set<string>()
  for (const p of mcProjects) for (const t of p.tasks) inScopeTaskIds.add(t.id)

  const crossDepsRows = await prisma.crossProjectDependency.findMany({
    where: {
      sourceTaskId: { in: Array.from(inScopeTaskIds) },
      targetTaskId: { in: Array.from(inScopeTaskIds) },
    },
    select: { sourceTaskId: true, targetTaskId: true },
  })

  const mcInput: MonteCarloInput = {
    projects: mcProjects,
    crossDeps: crossDepsRows.map((d) => ({
      predecessorTaskId: d.sourceTaskId,
      successorTaskId: d.targetTaskId,
    })),
    today: todayIso,
  }

  // Filtrado defensivo: si todos los proyectos quedaron sin tareas tras
  // el clamp, devolvemos NO_PROJECTS para que la UI muestre estado vacío.
  const totalTasks = mcProjects.reduce((acc, p) => acc + p.tasks.length, 0)
  if (totalTasks === 0) {
    throw new Error('[NO_PROJECTS] Proyectos activos sin tareas planificables')
  }

  const rng = seed !== undefined ? seedRandom(seed) : seedRandom()
  const result = runMonteCarloPortfolio(mcInput, iterations, { rng })

  const probabilityOnTime =
    targetDate !== undefined ? probabilityFinishBy(result, targetDate) : null

  // Payload persistente: shape PREDICTIVE_SCENARIO documentado en schema.
  // Guardamos sólo los percentiles + metadatos (samples no se persisten
  // para no inflar el Json column con ~10k floats).
  const payload = {
    type: 'monte_carlo_portfolio',
    iterations,
    today: todayIso,
    stdFactor,
    targetDate: targetDate ?? null,
    probabilityOnTime,
    portfolio: result.portfolio,
    projects: result.projects.map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      p10: p.p10,
      p50: p.p50,
      p90: p.p90,
      meanDays: p.meanDays,
      stdDays: p.stdDays,
    })),
    scanned: {
      projects: projects.length,
      tasks: totalTasks,
      crossDeps: crossDepsRows.length,
    },
  } as const

  const inserted = await prisma.brainStrategistInsight.create({
    data: {
      workspaceId,
      kind: 'PREDICTIVE_SCENARIO',
      severity: 'LOW',
      payload: payload as unknown as Prisma.InputJsonValue,
      summary: monteCarloSummary(result, probabilityOnTime, targetDate ?? null),
      status: 'NEW',
    },
    select: { id: true },
  })

  return {
    result,
    probabilityOnTime,
    targetDate: targetDate ?? null,
    insightId: inserted.id,
    scanned: {
      projects: projects.length,
      tasks: totalTasks,
      crossDeps: crossDepsRows.length,
    },
  }
}

// ─── Helpers internos (no exportados) ───────────────────────────────

function estimateTaskMeanDays(
  startDate: Date | null,
  endDate: Date | null,
  status: string,
  progress: number,
): number {
  // DONE / CANCELLED no aportan.
  if (status === 'DONE' || status === 'CANCELLED') return 0
  if (!startDate || !endDate) {
    // Fallback: 5 días si no hay fechas (heurística PMI ligera).
    return 5
  }
  const totalDays = Math.max(
    MIN_DURATION_DAYS,
    Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    ),
  )
  // Ajustamos por progreso: lo que falta = totalDays * (1 - progress%).
  const remaining = totalDays * (1 - Math.min(100, Math.max(0, progress)) / 100)
  return Math.max(MIN_DURATION_DAYS, Math.ceil(remaining))
}

function monteCarloSummary(
  result: MonteCarloResult,
  prob: number | null,
  targetDate: string | null,
): string {
  const date = new Date(result.portfolio.totalFinishP50).toLocaleDateString(
    'es-MX',
    { year: 'numeric', month: 'short', day: '2-digit' },
  )
  const probStr =
    prob !== null && targetDate
      ? ` · ${Math.round(prob * 100)}% de cumplir ${new Date(targetDate).toLocaleDateString(
          'es-MX',
          { year: 'numeric', month: 'short', day: '2-digit' },
        )}`
      : ''
  return `Monte Carlo · ${result.iterations.toLocaleString('es-MX')} iteraciones · cierre P50 ${date}${probStr}.`
}
