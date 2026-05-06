/**
 * Wave P7 · Equipo P7-2 · WBS Generator — Schema zod del output del LLM.
 *
 * Define la estructura jerárquica de fases y tareas que el modelo debe
 * devolver. Limita campos largos para evitar prompts inflados y permite
 * recursión controlada en `children` (sub-tareas) hasta una profundidad
 * razonable: usamos `z.lazy` con tope explícito en `MAX_TASK_DEPTH` validado
 * por el caller (el LLM no se "auto-limita", sino que el `assertDepth`
 * post-parsing lo rechaza si pasa el límite).
 */

import { z } from 'zod'

// Límite de profundidad recursiva permitido para `children`. 4 niveles
// (Phase → Task → Subtask → Subsubtask → Subsubsubtask) cubre el 99% de
// los WBS reales y mantiene el context window manejable. Si el LLM
// devuelve algo más profundo, se trunca con `assertDepth`.
export const MAX_TASK_DEPTH = 4

// ─────────────────────────── Sub-schemas ───────────────────────────────

const taskTypeSchema = z.enum(['PHASE', 'AGILE_STORY', 'PMI_TASK', 'ITIL_TICKET'])
const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])

// Schema base de una task (sin recursión). Recursión la añade
// `wbsTaskSchema` debajo vía `z.lazy`.
const baseTaskShape = {
  title: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  type: taskTypeSchema.default('PMI_TASK'),
  estimatedDays: z.number().int().min(1).max(90),
  priority: prioritySchema.default('MEDIUM'),
  // NOTA: arrays sin `.max()` — Anthropic rechaza maxItems. Límites
  // (10) se enforced en system prompt.
  tags: z.array(z.string().min(1).max(40)).optional(),
  /** Títulos de otras tasks de las que depende (FS implícito). */
  dependsOn: z.array(z.string().min(1).max(120)).optional(),
  /** Habilidades sugeridas (para sugerir assignee). */
  suggestedSkills: z.array(z.string().min(1).max(40)).optional(),
}

export type WBSTask = {
  title: string
  description?: string
  type: z.infer<typeof taskTypeSchema>
  estimatedDays: number
  priority: z.infer<typeof prioritySchema>
  tags?: string[]
  dependsOn?: string[]
  suggestedSkills?: string[]
  children?: WBSTask[]
}

export const wbsTaskSchema: z.ZodType<WBSTask> = z.lazy(() =>
  z.object({
    ...baseTaskShape,
    children: z.array(wbsTaskSchema).optional(),
  }),
)

const wbsPhaseSchema = z.object({
  name: z.string().min(1).max(80),
  order: z.number().int().min(0).max(50),
  // Límite 1..50 enforced en system prompt.
  tasks: z.array(wbsTaskSchema),
})

export type WBSPhase = z.infer<typeof wbsPhaseSchema>

const wbsRiskSchema = z.object({
  description: z.string().min(1).max(200),
  mitigation: z.string().min(1).max(200),
})

export const wbsSchema = z.object({
  projectName: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  estimatedDurationDays: z.number().int().min(1).max(730),
  // 1..20 fases y máx 20 risks enforced en system prompt.
  phases: z.array(wbsPhaseSchema),
  risks: z.array(wbsRiskSchema).optional(),
})

export type WBSGenerated = z.infer<typeof wbsSchema>

// ─────────────────────────── Validaciones extra ────────────────────────

/**
 * Valida que la profundidad de `children` no excede `MAX_TASK_DEPTH`.
 * Lanza Error tipado `[INVALID_OUTPUT]` cuando excede.
 */
export function assertDepth(wbs: WBSGenerated, max: number = MAX_TASK_DEPTH): void {
  function walk(task: WBSTask, depth: number): void {
    if (depth > max) {
      throw new Error(
        `[INVALID_OUTPUT] WBS excede profundidad máxima (${max}) en task "${task.title}"`,
      )
    }
    if (task.children?.length) {
      for (const child of task.children) walk(child, depth + 1)
    }
  }
  for (const phase of wbs.phases) {
    for (const task of phase.tasks) walk(task, 1)
  }
}

/**
 * Valida que ninguna `dependsOn` haga referencia a un título inexistente
 * o a sí misma; remueve referencias inválidas (no lanza). Devuelve la
 * lista de avisos para que el caller pueda loguear/mostrar.
 *
 * Nota: la deduplicación por título-completo es voluntariamente flexible
 * (case-sensitive). Para los WBS reales usamos resolución por
 * normalización (lowercase + trim) en `applyGeneratedWBS`.
 */
export function sanitizeDependencies(wbs: WBSGenerated): {
  warnings: string[]
} {
  const warnings: string[] = []
  // Mapa título → existencia
  const titles = new Set<string>()
  function collect(task: WBSTask): void {
    titles.add(task.title.trim().toLowerCase())
    if (task.children) for (const c of task.children) collect(c)
  }
  for (const phase of wbs.phases) for (const task of phase.tasks) collect(task)

  function clean(task: WBSTask): void {
    if (task.dependsOn?.length) {
      const valid: string[] = []
      for (const dep of task.dependsOn) {
        const norm = dep.trim().toLowerCase()
        if (norm === task.title.trim().toLowerCase()) {
          warnings.push(`Task "${task.title}" no puede depender de sí misma`)
          continue
        }
        if (!titles.has(norm)) {
          warnings.push(
            `Task "${task.title}" depende de "${dep}" que no existe en el WBS`,
          )
          continue
        }
        valid.push(dep)
      }
      task.dependsOn = valid
    }
    if (task.children) for (const c of task.children) clean(c)
  }
  for (const phase of wbs.phases) for (const task of phase.tasks) clean(task)
  return { warnings }
}

/**
 * Detecta y rompe ciclos en `dependsOn` con DFS. Cuando encuentra un ciclo,
 * elimina la arista que lo cierra y registra warning. Operación idempotente.
 */
export function breakCycles(wbs: WBSGenerated): { warnings: string[] } {
  const warnings: string[] = []
  // Aplanamos el árbol para iterar por título
  const tasksByTitle = new Map<string, WBSTask>()
  function flatten(task: WBSTask): void {
    tasksByTitle.set(task.title.trim().toLowerCase(), task)
    if (task.children) for (const c of task.children) flatten(c)
  }
  for (const phase of wbs.phases) for (const task of phase.tasks) flatten(task)

  // DFS por colores: 0 = unvisited, 1 = in stack, 2 = done.
  const color = new Map<string, 0 | 1 | 2>()
  for (const k of tasksByTitle.keys()) color.set(k, 0)

  function dfs(key: string): void {
    color.set(key, 1)
    const task = tasksByTitle.get(key)
    if (!task?.dependsOn) {
      color.set(key, 2)
      return
    }
    const kept: string[] = []
    for (const dep of task.dependsOn) {
      const depKey = dep.trim().toLowerCase()
      const c = color.get(depKey)
      if (c === 1) {
        warnings.push(`Ciclo detectado: "${task.title}" → "${dep}" (arista descartada)`)
        continue
      }
      if (c === 0) dfs(depKey)
      kept.push(dep)
    }
    task.dependsOn = kept
    color.set(key, 2)
  }
  for (const k of tasksByTitle.keys()) {
    if (color.get(k) === 0) dfs(k)
  }
  return { warnings }
}
