import 'server-only'

/**
 * Wave R5-Extended · CMDB Impact Analysis
 * ───────────────────────────────────────────────────────────────────
 *
 * Dado un CI raíz, calcula la cascada de CIs que se verían afectados
 * si el raíz cayera (status DOWN / INCIDENT). La semántica del modelo
 * `CIRelation` es:
 *
 *   "A DEPENDS_ON B"  →  fromCI = A, toCI = B
 *   "A RUNS_ON   B"   →  fromCI = A, toCI = B
 *   "A USES      B"   →  fromCI = A, toCI = B
 *   "A CONTAINS  B"   →  fromCI = A (contenedor), toCI = B (contenido)
 *
 * En todos los casos: si `toCI` cae, `fromCI` queda afectado.
 *
 * Por eso, dado un `rootCiId` (el CI que pensamos que va a fallar),
 * recorremos las relaciones donde `toCIId = rootCiId` y caminamos
 * hacia los `fromCI` correspondientes. Recursivamente: cada `fromCI`
 * se convierte en el siguiente "punto afectado" y volvemos a buscar
 * quién depende de él (relaciones donde `toCIId = fromCI.id`).
 *
 * Detección de ciclos: el grafo permite ciclos largos (A → B → C → A).
 * Llevamos un `Set` de IDs por la rama actual (path-local) y NO
 * recursamos sobre CIs ya visitados en ese path. Un mismo CI puede
 * aparecer en dos ramas independientes (diamond pattern) — eso es
 * legítimo y se renderiza dos veces, una por cada ruta de impacto.
 *
 * Tareas activas: para cada CI afectado cargamos sus `TaskCILink`
 * cuyo `task.status` NO esté en {DONE} (el modelo Task tiene un
 * único estado terminal `DONE` por enum `TaskStatus`). El status
 * `archivedAt` también lo excluimos por consistencia con el resto
 * del repo. Esto permite al gestor de servicios anticipar qué
 * tickets/historias quedarían bloqueadas si el CI raíz cayera.
 *
 * NO se incluye:
 *  - El propio CI raíz dentro de `children` (es la raíz).
 *  - CIs retirados (`retiredAt != null`) — quedan filtrados.
 *  - Simulación what-if (out of scope R5E).
 *  - Triggers de notificación al cambiar status (out of scope R5E).
 */

import prisma from '@/lib/prisma'
import type {
  CIRelationKind,
  CILinkRole,
  CIType,
  CIStatus,
  CICriticality,
} from '@prisma/client'

// ─────────────────────────── Types ───────────────────────────

export type ImpactCI = {
  id: string
  code: string
  name: string
  type: CIType
  status: CIStatus
  criticality: CICriticality
  environment: string | null
}

export type ImpactActiveTask = {
  id: string
  mnemonic: string | null
  title: string
  status: string
  type: string
  role: CILinkRole
  project: { id: string; name: string } | null
}

export type ImpactNode = {
  ci: ImpactCI
  /** `null` para el root; el `kind` de la arista que conduce a este CI. */
  relationKind: CIRelationKind | null
  /** Profundidad (0 = root). */
  depth: number
  children: ImpactNode[]
  /** Tareas vivas vinculadas al CI vía `TaskCILink`. */
  activeTasks: ImpactActiveTask[]
}

export type ImpactCascadeResult = {
  root: ImpactNode
  /** Lista plana ordenada por DFS pre-order (excluye root). */
  affected: ImpactNode[]
  /** Total de CIs afectados (excluye root). */
  totalAffected: number
  /** Total de tareas activas en TODA la cascada (sin contar duplicados). */
  totalActiveTasks: number
  /** Si se truncó la búsqueda al `maxDepth`. */
  depthLimitHit: boolean
}

// ─────────────────────────── Options ───────────────────────────

const DEFAULT_MAX_DEPTH = 5

export type ComputeImpactCascadeOptions = {
  /** Profundidad máxima (default 5). Cota dura para evitar recursión
   *  costosa en grafos densos. */
  maxDepth?: number
}

// ─────────────────────────── Helpers ───────────────────────────

/** Estados de Task considerados "vivos" (no terminales). `TaskStatus`
 *  sólo tiene un terminal: `DONE`. Mantengo la lista como conjunto por
 *  si el enum crece (ej. CLOSED/CANCELLED en el futuro). */
const TERMINAL_TASK_STATUSES: ReadonlySet<string> = new Set(['DONE'])

function isLiveTaskStatus(status: string): boolean {
  return !TERMINAL_TASK_STATUSES.has(status)
}

// ─────────────────────────── Core ───────────────────────────

/**
 * Calcula la cascada de impacto a partir del CI raíz. Algoritmo:
 *
 *   1. Carga el CI raíz (con sus tareas vivas).
 *   2. DFS limitado por `maxDepth`. En cada paso:
 *      - Para el CI actual, busca relaciones `CIRelation` donde
 *        `toCIId = currentCI.id` (= "alguien que depende de mí").
 *      - Para cada relación, carga `fromCI` + sus tareas vivas.
 *      - Si `fromCI` ya está en el path actual → skip (anti-ciclo).
 *      - Si `fromCI.retiredAt != null` → skip (CI retirado no impacta).
 *      - Recurse con `depth+1` hasta `maxDepth`.
 *
 * Esta función NO valida permisos — el caller (page) debe asegurar
 * que el usuario tiene acceso al CI raíz. La query `prisma.cIRelation`
 * NO está scoped por workspace porque la relación es identificada por
 * sus FK (`fromCIId`/`toCIId`) y ambos CIs están en el mismo workspace
 * por la regla del server action `addCIRelation`. Aún así, devolvemos
 * en ImpactCI sólo CIs que existan vivos.
 */
export async function computeImpactCascade(
  rootCiId: string,
  options?: ComputeImpactCascadeOptions,
): Promise<ImpactCascadeResult> {
  const maxDepth = Math.max(0, options?.maxDepth ?? DEFAULT_MAX_DEPTH)

  // 1. Root CI
  const rootCi = await prisma.configurationItem.findUnique({
    where: { id: rootCiId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      status: true,
      criticality: true,
      environment: true,
    },
  })
  if (!rootCi) {
    throw new Error(`[NOT_FOUND] CI ${rootCiId} no existe`)
  }

  const rootActiveTasks = await loadActiveTasksForCIs([rootCi.id])

  let depthLimitHit = false
  // Set de IDs ya visitados en el path actual (anti-ciclo). Lo paso por
  // valor (copia) a cada llamada hija para que ramas paralelas puedan
  // ver el mismo CI (diamond) sin marcarse mutuamente como ciclo.
  const visit = async (
    ci: ImpactCI,
    depth: number,
    pathIds: ReadonlySet<string>,
  ): Promise<ImpactNode[]> => {
    if (depth >= maxDepth) {
      depthLimitHit = true
      return []
    }

    // "Quién depende de este CI" → relaciones donde toCIId = ci.id.
    const inbound = await prisma.cIRelation.findMany({
      where: { toCIId: ci.id },
      select: {
        kind: true,
        fromCI: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            status: true,
            criticality: true,
            environment: true,
            retiredAt: true,
          },
        },
      },
    })

    if (inbound.length === 0) return []

    // Pre-cargamos tareas activas de TODOS los hijos en una sola query
    // para evitar N+1 al recorrer ramas anchas.
    const childIds = inbound
      .filter((r) => r.fromCI.retiredAt === null)
      .filter((r) => !pathIds.has(r.fromCI.id))
      .map((r) => r.fromCI.id)
    const tasksByCi = await loadActiveTasksForCIs(childIds)

    const nodes: ImpactNode[] = []
    for (const rel of inbound) {
      const child = rel.fromCI
      if (child.retiredAt !== null) continue
      if (pathIds.has(child.id)) continue // ciclo en este path

      const childCi: ImpactCI = {
        id: child.id,
        code: child.code,
        name: child.name,
        type: child.type,
        status: child.status,
        criticality: child.criticality,
        environment: child.environment,
      }

      const nextPath = new Set(pathIds)
      nextPath.add(child.id)
      const grandchildren = await visit(childCi, depth + 1, nextPath)

      nodes.push({
        ci: childCi,
        relationKind: rel.kind,
        depth: depth + 1,
        children: grandchildren,
        activeTasks: tasksByCi.get(child.id) ?? [],
      })
    }
    return nodes
  }

  const rootNode: ImpactNode = {
    ci: rootCi as ImpactCI,
    relationKind: null,
    depth: 0,
    children: await visit(rootCi as ImpactCI, 0, new Set([rootCi.id])),
    activeTasks: rootActiveTasks.get(rootCi.id) ?? [],
  }

  // Flatten DFS pre-order (sin root).
  const affected: ImpactNode[] = []
  const flat = (n: ImpactNode) => {
    for (const c of n.children) {
      affected.push(c)
      flat(c)
    }
  }
  flat(rootNode)

  // Contar tareas únicas (un task puede tocar varios CIs en la cascada).
  const taskIds = new Set<string>()
  const collectTasks = (n: ImpactNode) => {
    for (const t of n.activeTasks) taskIds.add(t.id)
    for (const c of n.children) collectTasks(c)
  }
  collectTasks(rootNode)

  return {
    root: rootNode,
    affected,
    totalAffected: affected.length,
    totalActiveTasks: taskIds.size,
    depthLimitHit,
  }
}

/**
 * Carga las tareas vivas vinculadas a un set de CIs en una sola query
 * y las agrupa por `ciId`. "Viva" = `status` no en TERMINAL_TASK_STATUSES
 * y `archivedAt == null`.
 */
async function loadActiveTasksForCIs(
  ciIds: string[],
): Promise<Map<string, ImpactActiveTask[]>> {
  const out = new Map<string, ImpactActiveTask[]>()
  if (ciIds.length === 0) return out

  const links = await prisma.taskCILink.findMany({
    where: {
      ciId: { in: ciIds },
      task: {
        archivedAt: null,
        // El enum TaskStatus actual es {TODO, IN_PROGRESS, REVIEW, DONE}.
        // Filtrar por NOT IN ['DONE'] cubre todos los vivos.
        status: { notIn: Array.from(TERMINAL_TASK_STATUSES) as never[] },
      },
    },
    select: {
      ciId: true,
      role: true,
      task: {
        select: {
          id: true,
          mnemonic: true,
          title: true,
          status: true,
          type: true,
          project: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  for (const link of links) {
    if (!isLiveTaskStatus(link.task.status)) continue // defensa extra
    const arr = out.get(link.ciId) ?? []
    arr.push({
      id: link.task.id,
      mnemonic: link.task.mnemonic,
      title: link.task.title,
      status: link.task.status,
      type: link.task.type,
      role: link.role,
      project: link.task.project,
    })
    out.set(link.ciId, arr)
  }
  return out
}

// ─────────────────────────── Para el badge de TaskCard ───────────────────────────

/**
 * Para un set de Task IDs, devuelve los que tienen al menos un CI
 * vinculado con `status ∈ {INCIDENT, MAINTENANCE}`. Usado por el
 * badge "CI caído" en cards de tareas.
 *
 * Nota: el enum CIStatus del repo NO tiene `DOWN`/`DEGRADED` literales.
 * Mapeamos:
 *   - DOWN     → INCIDENT (CI con incidente activo, indisponible)
 *   - DEGRADED → MAINTENANCE (CI degradado / en mantenimiento programado)
 *
 * El badge se muestra cuando hay AL MENOS un CI en alguno de esos
 * estados linkeado a la tarea (cualquier `role`).
 */
const ALERT_CI_STATUSES: ReadonlySet<CIStatus> = new Set<CIStatus>([
  'INCIDENT',
  'MAINTENANCE',
])

export async function getTasksWithImpactedCI(
  taskIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>()
  if (taskIds.length === 0) return out

  const links = await prisma.taskCILink.findMany({
    where: {
      taskId: { in: taskIds },
      ci: {
        status: { in: Array.from(ALERT_CI_STATUSES) },
        retiredAt: null,
      },
    },
    select: { taskId: true },
  })
  for (const l of links) out.add(l.taskId)
  return out
}
