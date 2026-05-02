'use server'

import { z } from 'zod'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'
import {
  BASELINE_CAP_PER_PROJECT,
  BASELINE_LABEL_MAX,
  buildBaselineSnapshot,
  normalizeBaselineLabel,
  parseBaselineSnapshot,
  type BaselineSnapshot,
} from '@/lib/scheduling/baseline-snapshot'

// ───────────────────────── Errores tipados ─────────────────────────

export type BaselineErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'BASELINE_CAP_REACHED'
  | 'INVALID_SNAPSHOT'
  | 'PROJECT_EMPTY'

function actionError(code: BaselineErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Schemas ─────────────────────────

const captureInputSchema = z.object({
  projectId: z.string().min(1),
  label: z.string().max(BASELINE_LABEL_MAX).optional(),
})

export type CaptureBaselineInput = z.input<typeof captureInputSchema>

// ───────────────────────── Cache helpers ─────────────────────────

/**
 * HU-3.2 · Cache de listado de baselines por proyecto.
 *
 * Devuelve la lista lazy (sin `snapshotData`) para que el dropdown la
 * pinte sin pagar el costo de deserializar JSONs grandes. La carga
 * pesada (snapshot completo) se hace on-demand en `getBaselineSnapshot`.
 *
 * Tag de invalidación: `baselines:<projectId>`. Se invalida tras
 * `captureBaseline` (la única mutación por ahora — el delete vendrá en
 * HU posterior).
 */
function getBaselinesByProjectIdCached(projectId: string) {
  return unstable_cache(
    async (id: string) => {
      const rows = await prisma.baseline.findMany({
        where: { projectId: id },
        orderBy: { version: 'desc' },
        select: {
          id: true,
          version: true,
          label: true,
          createdAt: true,
          // taskCount derivado del JSON; si el JSON es enorme el costo
          // sigue siendo O(n) pero solo en miss del cache.
          snapshotData: true,
        },
      })
      return rows.map((r) => {
        const snap = r.snapshotData as { tasks?: unknown[] } | null
        const taskCount = Array.isArray(snap?.tasks) ? snap.tasks.length : 0
        return {
          id: r.id,
          version: r.version,
          label: r.label,
          capturedAt: r.createdAt.toISOString(),
          taskCount,
        }
      })
    },
    ['baselines-by-project', projectId],
    { tags: [`baselines:${projectId}`] },
  )(projectId)
}

export function invalidateBaselinesCache(projectId: string | null | undefined): void {
  if (!projectId) return
  // 'max' = stale-while-revalidate (consistente con invalidateCpmCache).
  revalidateTag(`baselines:${projectId}`, 'max')
}

// ───────────────────────── Server actions ─────────────────────────

/**
 * Lista descriptiva de líneas base de un proyecto para el selector
 * (HU-3.2). NO incluye `snapshotData` para abaratar la red — usar
 * `getBaselineSnapshot(id)` solo cuando el usuario seleccione una.
 */
export async function getBaselinesForProject(projectId: string): Promise<
  Array<{
    id: string
    version: number
    label: string | null
    capturedAt: string
    taskCount: number
  }>
> {
  if (!projectId) return []
  return getBaselinesByProjectIdCached(projectId)
}

/**
 * Carga lazy del snapshot validado. Devuelve `null` si la baseline no
 * existe o si el JSON está corrupto / con shape antiguo
 * (`[INVALID_SNAPSHOT]`). El cliente decide cómo degradar (toast rojo).
 */
export async function getBaselineSnapshot(
  baselineId: string,
): Promise<{ id: string; projectId: string; version: number; snapshot: BaselineSnapshot } | null> {
  if (!baselineId) return null
  const row = await prisma.baseline.findUnique({
    where: { id: baselineId },
    select: { id: true, projectId: true, version: true, snapshotData: true },
  })
  if (!row) return null
  // parseBaselineSnapshot lanza `[INVALID_SNAPSHOT]` si el JSON no respeta
  // el schema; se propaga al caller (server-side la rama está envuelta
  // por Next y se serializa al cliente como Error).
  const snapshot = parseBaselineSnapshot(row.snapshotData)
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    snapshot,
  }
}

/**
 * Captura una nueva línea base para el proyecto.
 *
 * Pipeline:
 *  1. Valida input (zod).
 *  2. Verifica que el proyecto exista y cuenta sus baselines actuales.
 *     Si ya hay >= 20 → `[BASELINE_CAP_REACHED]` (D10).
 *  3. Carga las tareas no archivadas del proyecto.
 *     Si no hay tareas → `[PROJECT_EMPTY]` (defensa: el botón debería
 *     estar disabled, pero re-validamos server-side).
 *  4. Construye el snapshot con `buildBaselineSnapshot`.
 *  5. Persiste con `version = max(version)+1`. La unicidad
 *     `(projectId, version)` previene race conditions: si dos peticiones
 *     concurrentes calculan el mismo `nextVersion`, la 2ª recibe P2002 y
 *     reintentamos una vez. Con tráfico humano (botón manual) el caso es
 *     casi imposible, pero el guard cuesta nada.
 *  6. Invalida el cache de listado y revalida páginas relevantes.
 */
export async function captureBaseline(
  input: CaptureBaselineInput,
): Promise<{ id: string; version: number }> {
  const parsed = captureInputSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { projectId } = parsed.data
  const label = normalizeBaselineLabel(parsed.data.label ?? null)

  // 2. Validación de existencia + cap.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  })
  if (!project) actionError('NOT_FOUND', 'El proyecto no existe')

  const existingCount = await prisma.baseline.count({ where: { projectId } })
  if (existingCount >= BASELINE_CAP_PER_PROJECT) {
    actionError(
      'BASELINE_CAP_REACHED',
      `Máximo ${BASELINE_CAP_PER_PROJECT} líneas base por proyecto`,
    )
  }

  // 3. Tareas no archivadas.
  const dbTasks = await prisma.task.findMany({
    where: { projectId, archivedAt: null },
    select: {
      id: true,
      mnemonic: true,
      title: true,
      startDate: true,
      endDate: true,
      plannedValue: true,
      earnedValue: true,
      actualCost: true,
      progress: true,
      status: true,
    },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  })

  if (dbTasks.length === 0) {
    actionError('PROJECT_EMPTY', 'El proyecto no tiene tareas para capturar')
  }

  // 4. Snapshot puro.
  const snapshot = buildBaselineSnapshot({
    tasks: dbTasks,
    capturedAt: new Date(),
    label,
  })

  // 5. Persistencia con retry simple ante P2002 (duplicado en (projectId,
  // version)). Re-leemos el max y volvemos a intentar UNA vez; si vuelve
  // a fallar, el cap o un bug se hace evidente.
  const insertOnce = async (): Promise<{ id: string; version: number }> => {
    const last = await prisma.baseline.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    })
    const nextVersion = (last?.version ?? 0) + 1

    const created = await prisma.baseline.create({
      data: {
        projectId,
        version: nextVersion,
        label,
        // Cast a Prisma.InputJsonValue: el schema zod ya garantiza shape.
        snapshotData: snapshot as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, version: true },
    })
    return created
  }

  let created: { id: string; version: number }
  try {
    created = await insertOnce()
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Race con otra captura concurrente — reintento simple.
      created = await insertOnce()
    } else {
      throw err
    }
  }

  // 6. Invalidación de caches y rutas dependientes.
  invalidateBaselinesCache(projectId)
  revalidatePath('/gantt')
  revalidatePath(`/projects/${projectId}`)

  return created
}
