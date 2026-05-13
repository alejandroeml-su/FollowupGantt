/**
 * Fase 4 (2026-05-13) · State Machines de Tareas (ITIL / PMI / Scrum).
 *
 * Implementa los grafos de transición permitida del documento
 * "Definición Extendida de Tareas" (sección 5.5):
 *
 *   ITIL:   New → Assigned → In Progress → Pending → Resolved → Closed
 *           (con ramas: In Progress ↔ Pending, ← desde Pending a In Progress)
 *   PMI:    Not Started → In Progress → (On Hold ↔ In Progress) → Completed | Cancelled
 *   Scrum:  ToDo → InProgress → InReview → Done
 *           (InReview puede regresar a InProgress)
 *
 * Mapeo a los TaskStatus de Prisma:
 *   TODO          → "New" / "Not Started" / "ToDo"
 *   IN_PROGRESS   → "In Progress" / "InProgress"
 *   IN_REVIEW     → "InReview" / "Pending" (ITIL)
 *   DONE          → "Resolved+Closed" / "Completed" / "Done"
 *   BLOCKED       → "On Hold" (PMI) / "Pending" (ITIL)
 *   CANCELLED     → "Cancelled" (PMI)
 *
 * El proyecto usa un enum TaskStatus unificado. Las "transiciones inválidas"
 * solo se aplican cuando el cambio efectivo de status no está en la lista
 * permitida para el `type` de la tarea.
 */

export type TaskTypeEnum = 'AGILE_STORY' | 'PMI_TASK' | 'ITIL_TICKET'

// Adjacencia: para cada status, qué statuses son alcanzables directamente.
type TransitionGraph = Record<string, string[]>

const SCRUM_TRANSITIONS: TransitionGraph = {
  TODO: ['IN_PROGRESS'],
  IN_PROGRESS: ['IN_REVIEW', 'BLOCKED'],
  IN_REVIEW: ['IN_PROGRESS', 'DONE'],
  BLOCKED: ['IN_PROGRESS'],
  DONE: [], // terminal
}

const PMI_TRANSITIONS: TransitionGraph = {
  TODO: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'DONE', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [], // terminal
  CANCELLED: [], // terminal
}

const ITIL_TRANSITIONS: TransitionGraph = {
  TODO: ['IN_PROGRESS', 'CANCELLED'], // New → Assigned/In Progress
  IN_PROGRESS: ['IN_REVIEW', 'DONE', 'BLOCKED'], // → Pending/Resolved
  IN_REVIEW: ['IN_PROGRESS', 'DONE'], // Pending ↔ In Progress, → Resolved
  BLOCKED: ['IN_PROGRESS'],
  DONE: [], // Resolved+Closed terminal
  CANCELLED: [],
}

function getGraph(type: string): TransitionGraph {
  if (type === 'ITIL_TICKET') return ITIL_TRANSITIONS
  if (type === 'PMI_TASK') return PMI_TRANSITIONS
  return SCRUM_TRANSITIONS // AGILE_STORY default
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_TRANSITION'; message: string }

/**
 * Valida si un cambio de status es permitido para el tipo de tarea.
 * Si `from === to`, devuelve ok:true (no-op). Si `from` no está en el
 * grafo, lo aceptamos (estados legacy o seed).
 */
export function canTransition(
  type: string,
  from: string,
  to: string,
): TransitionResult {
  if (from === to) return { ok: true }
  const graph = getGraph(type)
  const adj = graph[from]
  if (!adj) {
    // Estado origen desconocido → permitir (back-compat).
    return { ok: true }
  }
  if (adj.includes(to)) return { ok: true }
  return {
    ok: false,
    code: 'INVALID_TRANSITION',
    message: `Transición ${from} → ${to} no permitida para tareas ${type}. Opciones válidas: ${
      adj.length > 0 ? adj.join(', ') : '(estado terminal)'
    }.`,
  }
}

/**
 * Lista las transiciones válidas desde un estado dado para un tipo.
 * Útil para que la UI muestre solo los botones de status disponibles.
 */
export function allowedTransitions(type: string, from: string): string[] {
  const graph = getGraph(type)
  return graph[from] ?? []
}
