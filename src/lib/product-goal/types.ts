/**
 * Wave P11-Scrum (HU-11.1) — Product Goal types y normalización.
 *
 * Scrum Guide 2020: el Product Goal es un commitment del Product
 * Backlog que describe el estado futuro deseado del producto. Es la
 * referencia en la que el Scrum Team se enfoca durante un horizonte
 * mayor a un sprint. El Product Owner es responsable de definirlo.
 *
 * Shape persistido en `Project.productGoal` Json:
 *   {
 *     statement: string,            // declaración (~140 chars max)
 *     successMetrics: string[],     // cómo medir cumplimiento
 *     targetDate: string | null,    // ISO date opcional
 *     lastReviewedAt: string | null // último refresh del PO
 *   }
 */

export interface ProductGoal {
  statement: string
  successMetrics: string[]
  targetDate: string | null
  lastReviewedAt: string | null
}

export const EMPTY_PRODUCT_GOAL: ProductGoal = {
  statement: '',
  successMetrics: [],
  targetDate: null,
  lastReviewedAt: null,
}

/** Normaliza cualquier valor Json a ProductGoal seguro. */
export function normalizeProductGoal(raw: unknown): ProductGoal {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PRODUCT_GOAL }
  const r = raw as Record<string, unknown>
  return {
    statement: typeof r.statement === 'string' ? r.statement : '',
    successMetrics: Array.isArray(r.successMetrics)
      ? r.successMetrics.filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      : [],
    targetDate:
      typeof r.targetDate === 'string' && r.targetDate.length > 0
        ? r.targetDate
        : null,
    lastReviewedAt:
      typeof r.lastReviewedAt === 'string' && r.lastReviewedAt.length > 0
        ? r.lastReviewedAt
        : null,
  }
}

export function isProductGoalDefined(g: ProductGoal): boolean {
  return g.statement.trim().length > 0
}
