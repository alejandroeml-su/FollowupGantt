/**
 * Wave P9 · Agile Maturity (HU-9.3) — Historia de Usuario formal.
 *
 * Tipos + helpers puros (sin server-only) para el campo `Task.userStory`.
 * El campo en Prisma es `Json?` y este módulo provee el contrato + helpers
 * de validación/normalización para callers cliente y server.
 *
 * Shape canónico:
 *   {
 *     asA:    string   // "Como un Project Owner"
 *     iWant:  string   // "Quiero crear Epics"
 *     soThat: string   // "Para agrupar Stories"
 *     criteria: Array<{
 *       id:     string  // uuid
 *       text:   string
 *       done:   boolean
 *       doneAt?: string  // ISO date opcional
 *     }>
 *   }
 *
 * Convención: si una Task no tiene userStory aún, el campo es `null` en
 * BD. Los componentes UI deben mostrar la sección vacía con CTA "Agregar
 * historia de usuario" en vez de fallar.
 */

export type AcceptanceCriterion = {
  id: string
  text: string
  done: boolean
  doneAt?: string | null
}

export type UserStory = {
  asA: string
  iWant: string
  soThat: string
  criteria: AcceptanceCriterion[]
}

/** Plantilla vacía. Útil al hacer "Agregar historia de usuario" inicial. */
export function emptyUserStory(): UserStory {
  return { asA: '', iWant: '', soThat: '', criteria: [] }
}

/** Genera id estable para CAs nuevos (lado cliente). El server puede
 *  validar/regenerar, pero typically deja pasar el id del cliente. */
export function generateCriterionId(): string {
  // crypto.randomUUID disponible en Node 16+ y todos los browsers modernos.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `ca-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Valida y normaliza un payload Json arbitrario al shape `UserStory`.
 * Si el input es inválido (tipo incorrecto, criteria mal-formado), devuelve
 * `null` — el caller decide si mostrar empty state o fallback.
 *
 * Defensa-en-profundidad: la BD es Json sin schema; cualquier código que
 * persistió mal o un import legacy puede traer payloads sucios.
 */
export function normalizeUserStory(raw: unknown): UserStory | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const asA = typeof r.asA === 'string' ? r.asA : ''
  const iWant = typeof r.iWant === 'string' ? r.iWant : ''
  const soThat = typeof r.soThat === 'string' ? r.soThat : ''

  const rawCriteria = Array.isArray(r.criteria) ? r.criteria : []
  const criteria: AcceptanceCriterion[] = []
  for (const c of rawCriteria) {
    if (!c || typeof c !== 'object') continue
    const cc = c as Record<string, unknown>
    if (typeof cc.id !== 'string' || typeof cc.text !== 'string') continue
    criteria.push({
      id: cc.id,
      text: cc.text,
      done: cc.done === true,
      doneAt: typeof cc.doneAt === 'string' ? cc.doneAt : null,
    })
  }

  // Si todos los campos están vacíos, devolver null para que el UI
  // muestre el empty state en lugar de un objeto vacío.
  if (!asA && !iWant && !soThat && criteria.length === 0) return null

  return { asA, iWant, soThat, criteria }
}

/**
 * Cuenta cuántos CAs están sin marcar. Util para el badge en filas y
 * para el guard "no se puede mover a DONE con CAs pendientes".
 */
export function countPendingCriteria(story: UserStory | null | undefined): number {
  if (!story) return 0
  return story.criteria.filter((c) => !c.done).length
}

/**
 * Retorna el progreso porcentual basado en CAs marcados. Si no hay CAs,
 * retorna `null` (UI debe mostrar — en lugar de 0%).
 */
export function userStoryCompletionRate(
  story: UserStory | null | undefined,
): number | null {
  if (!story || story.criteria.length === 0) return null
  const done = story.criteria.filter((c) => c.done).length
  return Math.round((done / story.criteria.length) * 100)
}
