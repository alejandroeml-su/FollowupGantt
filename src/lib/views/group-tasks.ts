/**
 * Ola P2 · Equipo P2-1 — Helper de agrupación dinámica de tareas.
 *
 * Recibe una lista plana de `SerializedTask` y devuelve un array de
 * `TaskGroup` ordenado de forma estable según el tipo de agrupación.
 *
 * Convenciones:
 *   - "Sin asignar/sin sprint/sin fase…" siempre va al final con key
 *     vacía (`''`) para que el cliente lo identifique sin un boolean extra.
 *   - Para `tags`, una tarea aparece en TODOS los grupos correspondientes
 *     a sus etiquetas (multi-bucket). Si no tiene tags, cae a "Sin etiquetas".
 *   - Para `custom_field:<id>`, se busca el `CustomFieldDef` por id en el
 *     contexto. Si no resuelve → fallback "Sin agrupar" (todos en un grupo).
 *     Si el field es MULTI_SELECT, multi-bucket también.
 *
 * El helper es PURE: no depende de zustand ni Next; tests directos contra
 * fixtures.
 */

import type { SerializedTask } from '@/lib/types'

export type GroupKey =
  | 'assignee'
  | 'sprint'
  | 'phase'
  | 'status'
  | 'priority'
  | 'tags'
  | `custom_field:${string}`

export interface TaskGroup {
  key: string
  label: string
  count: number
  tasks: SerializedTask[]
}

export interface GroupContext {
  users?: ReadonlyArray<{ id: string; name: string }>
  sprints?: ReadonlyArray<{ id: string; name: string }>
  phases?: ReadonlyArray<{ id: string; name: string }>
  customFields?: ReadonlyArray<{
    id: string
    label: string
    type:
      | 'TEXT'
      | 'NUMBER'
      | 'DATE'
      | 'BOOLEAN'
      | 'SELECT'
      | 'MULTI_SELECT'
      | 'URL'
    options?: Array<{ value: string; label: string }> | null
  }>
  /**
   * Mapa opcional `taskId → { fieldId → value }`. Cuando se agrupa por
   * `custom_field:<id>` el helper consulta este mapa en lugar de exigir que
   * los valores vengan embebidos en `SerializedTask` (no lo están).
   */
  customFieldValuesByTask?: Record<string, Record<string, unknown>>
}

const STATUS_LABELS: Record<string, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  DONE: 'Done',
}

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
}

// Orden canónico de status/priority → estos no se ordenan alfabético sino por
// su semántica de pipeline.
const STATUS_ORDER = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']
const PRIORITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

/**
 * Empaqueta un array de `[key, label, tasks]` en `TaskGroup[]`. Centraliza
 * el `count` para que los callers no tengan que duplicarlo.
 */
function buildGroups(
  buckets: Map<string, { label: string; tasks: SerializedTask[] }>,
  emptyKey: string | null,
): TaskGroup[] {
  const out: TaskGroup[] = []
  for (const [key, b] of buckets.entries()) {
    out.push({ key, label: b.label, count: b.tasks.length, tasks: b.tasks })
  }
  // Empuja el "Sin asignar/Sin sprint/…" al final para UX consistente.
  if (emptyKey !== null) {
    out.sort((a, b) => {
      if (a.key === emptyKey) return 1
      if (b.key === emptyKey) return -1
      return 0
    })
  }
  return out
}

/**
 * Devuelve el orden estable preservando inserción. Usa Map para mantener el
 * orden en el que las claves se ven por primera vez en `tasks`.
 */
function groupByScalar(
  tasks: SerializedTask[],
  resolve: (t: SerializedTask) => { key: string; label: string },
  emptyKey: string,
): TaskGroup[] {
  const buckets = new Map<string, { label: string; tasks: SerializedTask[] }>()
  for (const t of tasks) {
    const { key, label } = resolve(t)
    const existing = buckets.get(key)
    if (existing) {
      existing.tasks.push(t)
    } else {
      buckets.set(key, { label, tasks: [t] })
    }
  }
  return buildGroups(buckets, emptyKey)
}

export function groupTasks(
  tasks: SerializedTask[],
  groupBy: GroupKey | null | undefined,
  ctx: GroupContext = {},
): TaskGroup[] {
  if (!groupBy) {
    return [
      { key: '__all__', label: 'Todas', count: tasks.length, tasks: [...tasks] },
    ]
  }

  if (groupBy === 'assignee') {
    return groupByScalar(
      tasks,
      (t) => {
        if (!t.assigneeId) return { key: '', label: 'Sin asignar' }
        const name =
          t.assignee?.name ??
          ctx.users?.find((u) => u.id === t.assigneeId)?.name ??
          t.assigneeId
        return { key: t.assigneeId, label: name }
      },
      '',
    )
  }

  if (groupBy === 'status') {
    const groups = groupByScalar(
      tasks,
      (t) => ({ key: t.status, label: STATUS_LABELS[t.status] ?? t.status }),
      '__none__',
    )
    // Ordenar por el orden canónico TODO → DONE.
    return groups.sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key),
    )
  }

  if (groupBy === 'priority') {
    const groups = groupByScalar(
      tasks,
      (t) => ({ key: t.priority, label: PRIORITY_LABELS[t.priority] ?? t.priority }),
      '__none__',
    )
    return groups.sort(
      (a, b) =>
        PRIORITY_ORDER.indexOf(a.key) - PRIORITY_ORDER.indexOf(b.key),
    )
  }

  if (groupBy === 'sprint') {
    const sprints = ctx.sprints ?? []
    return groupByScalar(
      tasks,
      (t) => {
        // SerializedTask no expone sprintId ni phaseId hoy; lo leemos del
        // record genérico para no romper el tipo cuando llegue.
        const sprintId = (t as unknown as Record<string, unknown>).sprintId as
          | string
          | null
          | undefined
        if (!sprintId) return { key: '', label: 'Sin sprint' }
        const sprint = sprints.find((s) => s.id === sprintId)
        return { key: sprintId, label: sprint?.name ?? sprintId }
      },
      '',
    )
  }

  if (groupBy === 'phase') {
    const phases = ctx.phases ?? []
    return groupByScalar(
      tasks,
      (t) => {
        const phaseId = (t as unknown as Record<string, unknown>).phaseId as
          | string
          | null
          | undefined
        if (!phaseId) return { key: '', label: 'Sin fase' }
        const phase = phases.find((p) => p.id === phaseId)
        return { key: phaseId, label: phase?.name ?? phaseId }
      },
      '',
    )
  }

  if (groupBy === 'tags') {
    // Multi-bucket: una tarea con [a,b] aparece en grupos "a" y "b".
    const buckets = new Map<
      string,
      { label: string; tasks: SerializedTask[] }
    >()
    const empty: SerializedTask[] = []
    for (const t of tasks) {
      const tags = Array.isArray(t.tags) ? t.tags : []
      if (tags.length === 0) {
        empty.push(t)
        continue
      }
      for (const tag of tags) {
        const ex = buckets.get(tag)
        if (ex) ex.tasks.push(t)
        else buckets.set(tag, { label: tag, tasks: [t] })
      }
    }
    const groups = buildGroups(buckets, null)
    if (empty.length > 0) {
      groups.push({
        key: '',
        label: 'Sin etiquetas',
        count: empty.length,
        tasks: empty,
      })
    }
    return groups
  }

  if (groupBy.startsWith('custom_field:')) {
    const fieldId = groupBy.slice('custom_field:'.length)
    const def = ctx.customFields?.find((f) => f.id === fieldId)
    const valuesByTask = ctx.customFieldValuesByTask ?? {}

    if (!def) {
      // Fallback (D-SV-3): si no podemos resolver la def, devolvemos un único
      // grupo. Mantener el contrato no-throw para que la UI no se caiga si la
      // def fue borrada en otra pestaña.
      return [
        {
          key: '__all__',
          label: 'Sin agrupar (campo no encontrado)',
          count: tasks.length,
          tasks: [...tasks],
        },
      ]
    }

    const optionLabel = (val: string): string => {
      const opts = def.options ?? []
      const o = opts.find((x) => x.value === val)
      return o?.label ?? val
    }

    if (def.type === 'MULTI_SELECT') {
      const buckets = new Map<
        string,
        { label: string; tasks: SerializedTask[] }
      >()
      const empty: SerializedTask[] = []
      for (const t of tasks) {
        const raw = valuesByTask[t.id]?.[fieldId]
        const arr = Array.isArray(raw) ? (raw as string[]) : []
        if (arr.length === 0) {
          empty.push(t)
          continue
        }
        for (const v of arr) {
          const ex = buckets.get(v)
          if (ex) ex.tasks.push(t)
          else buckets.set(v, { label: optionLabel(v), tasks: [t] })
        }
      }
      const groups = buildGroups(buckets, null)
      if (empty.length > 0) {
        groups.push({
          key: '',
          label: `${def.label}: Sin valor`,
          count: empty.length,
          tasks: empty,
        })
      }
      return groups
    }

    // Para los demás tipos: agrupación scalar por su valor stringificado.
    return groupByScalar(
      tasks,
      (t) => {
        const raw = valuesByTask[t.id]?.[fieldId]
        if (raw === undefined || raw === null || raw === '') {
          return { key: '', label: `${def.label}: Sin valor` }
        }
        const stringKey =
          typeof raw === 'boolean' ? (raw ? 'true' : 'false') : String(raw)
        const label =
          def.type === 'SELECT'
            ? optionLabel(stringKey)
            : def.type === 'BOOLEAN'
              ? raw
                ? 'Sí'
                : 'No'
              : stringKey
        return { key: stringKey, label }
      },
      '',
    )
  }

  // Fallback defensivo: clave desconocida → todas en un grupo.
  return [
    { key: '__all__', label: 'Todas', count: tasks.length, tasks: [...tasks] },
  ]
}
