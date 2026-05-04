/**
 * Ola P5 · Equipo P5-4 · AI Insights — barrel del módulo.
 *
 * Re-exports puros (sin side-effects). Las heurísticas son determinísticas
 * y no dependen de Prisma; consumibles tanto desde el server action como
 * desde tests.
 */

export {
  categorizeTask,
  listCategories,
} from './categorize'
export type {
  CategorizationResult,
  TaskCategory,
} from './categorize'

export { predictDelayRisk } from './predict-risk'
export type {
  RiskAssigneeHistory,
  RiskLevel,
  RiskResult,
  RiskTaskInput,
} from './predict-risk'

export { suggestNextActions } from './suggest-actions'
export type {
  NextAction,
  SuggestProjectInput,
  SuggestSprintInput,
  SuggestTaskInput,
} from './suggest-actions'
