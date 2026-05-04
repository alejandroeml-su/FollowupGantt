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
})

export type ApplyWBSInput = z.input<typeof applyInputSchema>

// ─────────────────────────── Resultado ─────────────────────────────────

export interface ApplyWBSResult {
  projectId: string
  projectCreated: boolean
  phaseCount: number
  taskCount: number
  dependencyCount: number
  /** Mapa title → taskId (post-suffix) por si la UI quiere navegar tras crear. */
  titleToId: Record<string, string>
  warnings: string[]
}

// ─────────────────────────── Action ────────────────────────────────────

export async function applyGeneratedWBS(input: ApplyWBSInput): Promise<ApplyWBSResult> {
  const user = await requireUser()

  const parsed = applyInputSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Input inválido')
  }
  const { wbs, projectId, overrideProjectName, refuseIfHasPhases } = parsed.data

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
      const created = await tx.project.create({
        data: {
          name: overrideProjectName ?? wbs.projectName,
          description: wbs.description,
          status: 'PLANNING',
          managerId: user.id,
        },
        select: { id: true },
      })
      project = created
      projectCreated = true
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

    return {
      projectId: project.id,
      projectCreated,
      phaseCount: phaseIds.length,
      taskCount,
      dependencyCount,
      titleToId: Object.fromEntries(titleToId),
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

