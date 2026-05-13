/**
 * Scrum Task Attributes — extensión del modelo Task para tareas de tipo
 * AGILE_STORY siguiendo el documento "Definición Extendida de Tareas".
 * Persistido en `Task.scrumAttributes` como Json siguiendo el patrón
 * `itilAttributes`/`userStory`.
 *
 * NOTA: el campo `userStory` (Wave P9) ya cubre la historia padre con sus
 * criterios de aceptación. Este módulo cubre los atributos *de tarea*
 * dentro de la historia (técnico, no de producto): tipo de trabajo,
 * estado de tablero, horas, DoD, etc.
 *
 * Mapping al documento (sección 3.4):
 *   - task_kind       → taskKind
 *   - board_status    → boardStatus
 *   - hours_estimate  → hoursEstimate
 *   - hours_remaining → hoursRemaining
 *   - hours_logged    → hoursLogged
 *   - components      → components
 *   - blockers        → blockers
 *   - dod_checklist   → dodChecklist
 *   - commits         → commits
 *   - pull_requests   → pullRequests
 *   - review_notes    → reviewNotes
 */

export type ScrumTaskKind =
  | 'Dev'
  | 'Test'
  | 'Design'
  | 'Docs'
  | 'Spike'
  | 'TechDebt'
  | 'Bug'

export type ScrumBoardStatus = 'ToDo' | 'InProgress' | 'InReview' | 'Done'

export type ScrumBlocker = {
  description: string
  since: string // ISO date
}

export type ScrumDoDItem = {
  item: string
  checked: boolean
}

export type ScrumAttributes = {
  taskKind: ScrumTaskKind
  boardStatus: ScrumBoardStatus
  hoursEstimate: number
  hoursRemaining: number
  hoursLogged?: number
  components?: string[]
  blockers?: ScrumBlocker[]
  dodChecklist: ScrumDoDItem[]
  commits?: string[]
  pullRequests?: string[]
  reviewNotes?: string | null
}

export function emptyScrumAttributes(): ScrumAttributes {
  return {
    taskKind: 'Dev',
    boardStatus: 'ToDo',
    hoursEstimate: 0,
    hoursRemaining: 0,
    dodChecklist: [
      { item: 'Tests unitarios', checked: false },
      { item: 'Code review aprobado', checked: false },
      { item: 'Documentación actualizada', checked: false },
    ],
  }
}

export function normalizeScrumAttributes(raw: unknown): ScrumAttributes | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const kinds: ScrumTaskKind[] = ['Dev', 'Test', 'Design', 'Docs', 'Spike', 'TechDebt', 'Bug']
  const statuses: ScrumBoardStatus[] = ['ToDo', 'InProgress', 'InReview', 'Done']

  const taskKind: ScrumTaskKind =
    typeof r.taskKind === 'string' && kinds.includes(r.taskKind as ScrumTaskKind)
      ? (r.taskKind as ScrumTaskKind)
      : 'Dev'
  const boardStatus: ScrumBoardStatus =
    typeof r.boardStatus === 'string' && statuses.includes(r.boardStatus as ScrumBoardStatus)
      ? (r.boardStatus as ScrumBoardStatus)
      : 'ToDo'

  const num = (v: unknown, fallback = 0) =>
    typeof v === 'number' && !isNaN(v) ? v : fallback

  const arrStr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined

  const blockers: ScrumBlocker[] | undefined = Array.isArray(r.blockers)
    ? (r.blockers as unknown[])
        .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
        .map((b) => ({
          description: typeof b.description === 'string' ? b.description : '',
          since: typeof b.since === 'string' ? b.since : new Date().toISOString(),
        }))
        .filter((b) => b.description.length > 0)
    : undefined

  const dodRaw = Array.isArray(r.dodChecklist) ? r.dodChecklist : []
  const dodChecklist: ScrumDoDItem[] = (dodRaw as unknown[])
    .filter((it): it is Record<string, unknown> => !!it && typeof it === 'object')
    .map((it) => ({
      item: typeof it.item === 'string' ? it.item : '',
      checked: it.checked === true,
    }))
    .filter((it) => it.item.length > 0)

  return {
    taskKind,
    boardStatus,
    hoursEstimate: num(r.hoursEstimate, 0),
    hoursRemaining: num(r.hoursRemaining, 0),
    hoursLogged: typeof r.hoursLogged === 'number' ? r.hoursLogged : undefined,
    components: arrStr(r.components),
    blockers,
    dodChecklist,
    commits: arrStr(r.commits),
    pullRequests: arrStr(r.pullRequests),
    reviewNotes: typeof r.reviewNotes === 'string' && r.reviewNotes !== '' ? r.reviewNotes : null,
  }
}
