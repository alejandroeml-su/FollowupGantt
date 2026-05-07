import 'server-only'
import prisma from '@/lib/prisma'

/**
 * Helper centralizado para cargar el árbol completo de tareas con
 * profundidad N. Resuelve el bug operativo 2026-05-06: Lista, Tabla,
 * Kanban y Gantt sólo cargaban 1 nivel de subtareas (`subtasks: { include: ... }`),
 * por lo que los nietos y bisnietos no aparecían en ninguna vista.
 *
 * Prisma no soporta queries verdaderamente recursivos sin `$queryRaw`.
 * Aquí construimos el `include` anidado a profundidad fija. N=5 cubre
 * el 99% de los casos reales (epic → feature → story → task → subtask).
 *
 * El relation usado es `subtasks` que está definido en `Task` como
 * self-relation `parent ←→ subtasks` con onDelete: Cascade.
 *
 * Uso típico:
 *   const tasks = await prisma.task.findMany({
 *     where: { parentId: null, archivedAt: null },
 *     include: buildTaskTreeInclude({ depth: 5 }),
 *     orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
 *   })
 */

type TaskInclude = {
  assignee: true
  project: { include: { area: { include: { gerencia: true } } } }
  comments: { include: { author: true }; orderBy: { createdAt: 'desc' } }
  history: { include: { user: true }; orderBy: { createdAt: 'desc' } }
  attachments: { include: { user: true }; orderBy: { createdAt: 'desc' } }
  /** Wave P9 — Epic info para badges en surfaces. */
  epic: { select: { id: true; name: true; color: true } }
  subtasks?: {
    where: { archivedAt: null }
    include: TaskInclude
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }]
  }
}

/**
 * Genera un objeto `include` para Prisma con N niveles de subtareas.
 * Cada nivel hereda el mismo set de relaciones (assignee, project,
 * comments, history, attachments) para que el serializer encuentre
 * todo lo que necesita en cualquier profundidad.
 */
export function buildTaskTreeInclude(options: { depth: number }): TaskInclude {
  const { depth } = options
  if (depth < 0) {
    throw new Error('[buildTaskTreeInclude] depth must be >= 0')
  }

  const baseInclude: Omit<TaskInclude, 'subtasks'> = {
    assignee: true,
    project: { include: { area: { include: { gerencia: true } } } },
    comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
    history: { include: { user: true }, orderBy: { createdAt: 'desc' } },
    attachments: { include: { user: true }, orderBy: { createdAt: 'desc' } },
    epic: { select: { id: true, name: true, color: true } },
  }

  if (depth === 0) {
    return baseInclude as TaskInclude
  }

  return {
    ...baseInclude,
    subtasks: {
      where: { archivedAt: null },
      include: buildTaskTreeInclude({ depth: depth - 1 }),
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    },
  }
}

/**
 * Profundidad por defecto del árbol. Si necesitas más niveles para una
 * vista específica, pásalo explícito (`buildTaskTreeInclude({ depth: 7 })`).
 */
export const DEFAULT_TREE_DEPTH = 5

/**
 * Aplana un árbol de tareas en un array sin nesting, preservando un
 * campo `depth` (0 = raíz). Útil para vistas que renderizan listas
 * planas con indentación visual (Tabla, Gantt) en lugar de nesting
 * estructural (Lista con expand/collapse).
 *
 * Excluye archivadas porque la query las filtra. Si llegas con un árbol
 * que pueda contener archivadas (cargado de otro sitio), filtra antes.
 */
export type FlatTaskNode<T extends { id: string; subtasks?: T[] | null }> = T & {
  depth: number
  /** IDs de los ancestros desde la raíz (excluye al nodo en sí). */
  ancestors: string[]
}

export function flattenTaskTree<T extends { id: string; subtasks?: T[] | null }>(
  roots: T[],
): FlatTaskNode<T>[] {
  const out: FlatTaskNode<T>[] = []
  const visit = (node: T, depth: number, ancestors: string[]) => {
    out.push({ ...node, depth, ancestors })
    const kids = node.subtasks ?? []
    for (const kid of kids) {
      visit(kid, depth + 1, [...ancestors, node.id])
    }
  }
  for (const r of roots) visit(r, 0, [])
  return out
}

/**
 * Convenience wrapper: carga las tareas raíz (parentId=null) con
 * subtareas hasta `depth` niveles. La caller decide si quiere nesting
 * (`tasks`) o flat (`flattenTaskTree(tasks)`).
 */
export async function loadTaskTreeRoots(options?: {
  depth?: number
  where?: Parameters<typeof prisma.task.findMany>[0] extends { where?: infer W }
    ? W
    : never
}) {
  const depth = options?.depth ?? DEFAULT_TREE_DEPTH
  return prisma.task.findMany({
    where: { parentId: null, archivedAt: null, ...(options?.where ?? {}) },
    include: buildTaskTreeInclude({ depth }),
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
  })
}
