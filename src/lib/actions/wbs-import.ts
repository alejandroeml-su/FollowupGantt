'use server'

/**
 * Wave P7 · Equipo P7-2 · WBS Generator — Server Action `applyGeneratedWBS`.
 *
 * Persiste un WBS generado a las tablas `Project`, `Phase`, `Task` y
 * `TaskDependency`. Toda la operación corre en `prisma.$transaction` para
 * garantizar atomicidad: si falla a mitad, no queda nada huérfano.
 *
 * Estrategia de IDs y dependencias:
 *   - Cada `WBSTask` se identifica por `title` (string libre del LLM). En la
 *     normalización lowercase+trim resolvemos referencias `dependsOn`.
 *   - Si dos tasks colisionan por título, la SEGUNDA recibe sufijo " (2)",
 *     " (3)", … y los `dependsOn` que apunten a esa siguen al primer match
 *     (decisión documentada). Esto cubre el caso "Pruebas" repetido en dos
 *     fases.
 *   - Las dependencias se crean tras todas las tasks (segunda pasada): el
 *     mapa título→id está completo y se evitan inserciones con FK pendiente.
 *   - Tipo de dependencia: siempre FINISH_TO_START (lag 0). Refinable a
 *     futuro cuando el LLM diferencie tipos.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import {
  wbsSchema,
  type WBSTask,
} from '@/lib/ai/wbs/wbs-schema'
import {
  seedOnboardingKit,
  shouldSeedKit,
  type SeededKit,
} from '@/lib/onboarding/seed-kit'

// ─────────────────────────── Errores tipados ───────────────────────────

export type WBSImportErrorCode =
  | 'INVALID_INPUT'
  | 'PROJECT_NOT_FOUND'
  | 'UNAUTHORIZED'

function actionError(code: WBSImportErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ─────────────────────────── Schema de input ───────────────────────────

const applyInputSchema = z.object({
  wbs: wbsSchema,
  /** Si se pasa, se añade al proyecto existente; si no, crea uno nuevo. */
  projectId: z.string().min(1).optional(),
  /** Override del nombre del proyecto al crear uno nuevo. */
  overrideProjectName: z.string().min(1).max(120).optional(),
  /** Si TRUE, falla cuando el proyecto ya tiene fases (evita mezclar). */
  refuseIfHasPhases: z.boolean().optional(),
  /** Wave P14 — Datos de definición del proyecto (obligatorios al crear). */
  areaId: z.string().min(1).optional(),
  methodology: z.enum(['SCRUM', 'PMI', 'HYBRID']).optional(),
  managerId: z.string().min(1).optional(),
  budget: z.number().nonnegative().optional(),
  budgetCurrency: z.string().min(1).max(8).optional(),
})

export type ApplyWBSInput = z.input<typeof applyInputSchema>

// ─────────────────────────── Resultado ─────────────────────────────────

export interface ApplyWBSResult {
  projectId: string
  projectCreated: boolean
  phaseCount: number
  taskCount: number
  dependencyCount: number
  /** Wave P14 — riesgos creados desde `wbs.risks[]`. */
  riskCount: number
  /** Mapa title → taskId (post-suffix) por si la UI quiere navegar tras crear. */
  titleToId: Record<string, string>
  warnings: string[]
  /**
   * Wave P16-B · Onboarding Kit. Sólo presente cuando se creó un proyecto
   * nuevo con methodology SCRUM/HYBRID. `null` si el caller pasó
   * `projectId` (proyecto existente) o si la metodología es PMI.
   */
  onboardingKit: SeededKit | null
}

// ─────────────────────────── Action ────────────────────────────────────

export async function applyGeneratedWBS(input: ApplyWBSInput): Promise<ApplyWBSResult> {
  const user = await requireUser()

  const parsed = applyInputSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Input inválido')
  }
  const {
    wbs,
    projectId,
    overrideProjectName,
    refuseIfHasPhases,
    areaId,
    methodology,
    managerId,
    budget,
    budgetCurrency,
  } = parsed.data

  // Wave P14 — al crear un proyecto nuevo, exigir áreaId + methodology.
  if (!projectId) {
    if (!areaId)
      actionError('INVALID_INPUT', 'areaId es obligatorio al crear un proyecto nuevo')
    if (!methodology)
      actionError('INVALID_INPUT', 'methodology es obligatorio al crear un proyecto nuevo')
  }

  const warnings: string[] = []

  const result = await prisma.$transaction(async (tx) => {
    // 1. Resolver/crear el proyecto.
    let project: { id: string }
    let projectCreated = false
    if (projectId) {
      const existing = await tx.project.findUnique({
        where: { id: projectId },
        include: { phases: { select: { id: true } } },
      })
      if (!existing) actionError('PROJECT_NOT_FOUND', `Proyecto ${projectId} no existe`)
      if (refuseIfHasPhases && existing.phases.length > 0) {
        actionError('INVALID_INPUT', 'El proyecto ya tiene fases; pasa refuseIfHasPhases=false para mezclar')
      }
      project = { id: existing.id }
    } else {
      // Wave P14 — incluir definición completa del proyecto al crear.
      const created = await tx.project.create({
        data: {
          name: overrideProjectName ?? wbs.projectName,
          description: wbs.description,
          status: 'PLANNING',
          managerId: managerId ?? user.id,
          areaId: areaId,
          methodology: methodology ?? 'HYBRID',
          budget: budget !== undefined ? budget : null,
          budgetCurrency: budget !== undefined ? budgetCurrency ?? 'USD' : null,
        },
        select: { id: true },
      })
      project = created
      projectCreated = true

      // Asignar al manager como member para que tenga visibilidad inmediata.
      const ownerId = managerId ?? user.id
      await tx.projectAssignment.upsert({
        where: { projectId_userId: { projectId: created.id, userId: ownerId } },
        update: {},
        create: { projectId: created.id, userId: ownerId },
      })
    }

    // 2. Crear las fases en orden.
    const phaseIds: string[] = []
    const phasesSorted = [...wbs.phases].sort((a, b) => a.order - b.order)
    for (const phase of phasesSorted) {
      const created = await tx.phase.create({
        data: {
          projectId: project.id,
          name: phase.name,
          order: phase.order,
        },
        select: { id: true },
      })
      phaseIds.push(created.id)
    }

    // 3. Crear las tasks (recursivo). Acumulamos title→id con resolución
    //    de colisiones y construimos la lista de dependencias para crear
    //    en una segunda pasada.
    const titleToId = new Map<string, string>()
    const titleCollisions = new Map<string, number>()
    const pendingDeps: Array<{
      successorTitle: string
      predecessorTitle: string
    }> = []

    let taskCount = 0
    for (let i = 0; i < phasesSorted.length; i++) {
      const phase = phasesSorted[i]
      const phaseId = phaseIds[i]
      let position = 0
      for (const task of phase.tasks) {
        await createTaskRecursive({
          tx,
          task,
          projectId: project.id,
          phaseId,
          parentId: null,
          position: position++,
          titleToId,
          titleCollisions,
          pendingDeps,
        })
        taskCount += countTasks(task)
      }
    }

    // 4. Crear dependencias (segunda pasada).
    let dependencyCount = 0
    for (const dep of pendingDeps) {
      const successorId = titleToId.get(normTitle(dep.successorTitle))
      const predecessorId = titleToId.get(normTitle(dep.predecessorTitle))
      if (!successorId || !predecessorId) {
        warnings.push(
          `Dependencia descartada: "${dep.successorTitle}" → "${dep.predecessorTitle}" (no se resolvió)`,
        )
        continue
      }
      if (successorId === predecessorId) {
        warnings.push(
          `Dependencia descartada por self-loop: "${dep.successorTitle}"`,
        )
        continue
      }
      try {
        await tx.taskDependency.create({
          data: {
            successorId,
            predecessorId,
            type: 'FINISH_TO_START',
            lagDays: 0,
          },
        })
        dependencyCount++
      } catch (err) {
        // Conflicto único (predecessorId, successorId): la ignoramos como warning
        warnings.push(
          `Dependencia duplicada ignorada: "${dep.successorTitle}" ← "${dep.predecessorTitle}" (${
            err instanceof Error ? err.message : String(err)
          })`,
        )
      }
    }

    // 5. Wave P14 — Crear riesgos del WBS si hay risks[].
    let riskCount = 0
    if (wbs.risks && wbs.risks.length > 0) {
      for (const r of wbs.risks) {
        try {
          await tx.risk.create({
            data: {
              projectId: project.id,
              title: (r.title ?? r.description.slice(0, 80)).trim(),
              description: r.description,
              probability: r.probability ?? 3,
              impact: r.impact ?? 3,
              mitigation: r.mitigation,
              triggerDelayDays: r.triggerDelayDays ?? null,
              ownerId: managerId ?? user.id,
            },
          })
          riskCount++
        } catch (err) {
          warnings.push(
            `Riesgo ignorado: "${r.title ?? r.description.slice(0, 40)}" (${
              err instanceof Error ? err.message : String(err)
            })`,
          )
        }
      }
    }

    // 6. Wave P16-B · Onboarding Kit (auto-seeding) — sólo al CREAR un
    //    proyecto nuevo y si methodology ∈ {SCRUM, HYBRID}. El helper es
    //    idempotente y respeta contenido pre-existente. Lo invocamos
    //    dentro de la misma `tx` para que falle atómicamente si algo va
    //    mal sin dejar el proyecto a medio sembrar.
    let onboardingKit: SeededKit | null = null
    const effectiveMethodology = methodology ?? 'HYBRID'
    if (projectCreated && shouldSeedKit(effectiveMethodology)) {
      try {
        onboardingKit = await seedOnboardingKit({
          projectId: project.id,
          methodology: effectiveMethodology,
          actorId: managerId ?? user.id,
          tx,
        })
      } catch (err) {
        // El kit no debe romper la creación del proyecto: lo registramos
        // como warning y seguimos. El proyecto queda válido aunque sin kit.
        warnings.push(
          `Onboarding Kit no aplicado: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      }
    }

    return {
      projectId: project.id,
      projectCreated,
      phaseCount: phaseIds.length,
      taskCount,
      dependencyCount,
      riskCount,
      titleToId: Object.fromEntries(titleToId),
      onboardingKit,
    }
  })

  revalidatePath('/projects')
  revalidatePath(`/projects/${result.projectId}`)
  revalidatePath('/list')
  revalidatePath('/gantt')

  return { ...result, warnings }
}

// ─────────────────────────── Helpers ───────────────────────────────────

function normTitle(t: string): string {
  return t.trim().toLowerCase()
}

function countTasks(task: WBSTask): number {
  let n = 1
  if (task.children) for (const c of task.children) n += countTasks(c)
  return n
}

interface CreateRecursiveArgs {
  tx: Prisma.TransactionClient
  task: WBSTask
  projectId: string
  phaseId: string
  parentId: string | null
  position: number
  titleToId: Map<string, string>
  titleCollisions: Map<string, number>
  pendingDeps: Array<{ successorTitle: string; predecessorTitle: string }>
}

async function createTaskRecursive(args: CreateRecursiveArgs): Promise<void> {
  const {
    tx,
    task,
    projectId,
    phaseId,
    parentId,
    position,
    titleToId,
    titleCollisions,
    pendingDeps,
  } = args

  // Resolver colisión por título.
  const baseKey = normTitle(task.title)
  let finalTitle = task.title
  if (titleToId.has(baseKey)) {
    const n = (titleCollisions.get(baseKey) ?? 1) + 1
    titleCollisions.set(baseKey, n)
    finalTitle = `${task.title} (${n})`
  } else {
    titleCollisions.set(baseKey, 1)
  }

  // Mapear type del WBS al enum de Prisma. "PHASE" no existe en Prisma
  // (es un agrupador conceptual): lo convertimos a PMI_TASK.
  const prismaType: 'AGILE_STORY' | 'PMI_TASK' | 'ITIL_TICKET' =
    task.type === 'AGILE_STORY' || task.type === 'ITIL_TICKET' ? task.type : 'PMI_TASK'

  // EstimatedDays → plannedValue (días*8h como proxy a horas EVM).
  const plannedValue = Math.max(1, task.estimatedDays * 8)

  const created = await tx.task.create({
    data: {
      projectId,
      phaseId,
      parentId,
      title: finalTitle,
      description: task.description ?? null,
      type: prismaType,
      status: 'TODO',
      priority: task.priority,
      tags: task.tags ?? [],
      progress: 0,
      isMilestone: false,
      plannedValue,
      position,
    },
    select: { id: true },
  })

  // Registramos por el título FINAL (sufijado) y por el ORIGINAL si todavía
  // no estaba registrado: así las referencias `dependsOn` que usan el título
  // del LLM siguen funcionando (apuntan al PRIMER match).
  titleToId.set(normTitle(finalTitle), created.id)
  if (!titleToId.has(baseKey)) titleToId.set(baseKey, created.id)

  // Registrar dependencias para resolución posterior.
  if (task.dependsOn?.length) {
    for (const predTitle of task.dependsOn) {
      pendingDeps.push({
        successorTitle: finalTitle,
        predecessorTitle: predTitle,
      })
    }
  }

  // Recursión en children.
  if (task.children?.length) {
    let childPos = 0
    for (const child of task.children) {
      await createTaskRecursive({
        ...args,
        task: child,
        parentId: created.id,
        position: childPos++,
      })
    }
  }
}

