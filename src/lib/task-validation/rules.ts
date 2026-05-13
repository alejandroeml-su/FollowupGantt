/**
 * Fase 4 (2026-05-13) · Motor de Reglas de Validación de Tareas.
 *
 * Implementa las reglas del documento "Definición Extendida de Tareas":
 *   - G-01..G-04: Globales (núcleo común)
 *   - I-01..I-10: ITIL específicas
 *   - P-01..P-10: PMI específicas
 *   - S-01..S-09: Scrum específicas
 *
 * Output: lista de objetos `RuleViolation` con código, mensaje y campo.
 * Una tarea está "definitionComplete = true" si NO hay violations.
 *
 * No-goals (deuda futura):
 *   - Reglas que requieren BD (P-05: suma de allocation_pct cross-task;
 *     P-07: ciclos de predecesores; S-02: DoR de historia padre). Se
 *     dejan stubs comentados. Las implementamos cuando exista la
 *     infraestructura necesaria.
 *   - Reglas que requieren CMDB / SLA / SupportGroup (I-03, I-10) —
 *     deferred a Fase 3.
 */

import type { ItilAttributes } from '@/lib/itil/types'
import type { ScrumAttributes } from '@/lib/scrum/types'
import type { PmiAttributes } from '@/lib/pmi/types'
import type { UserStory } from '@/lib/user-story/types'

export type RuleSeverity = 'error' | 'warning'

export type RuleViolation = {
  code: string
  message: string
  field?: string
  severity: RuleSeverity
}

export type ValidationInput = {
  type: 'AGILE_STORY' | 'PMI_TASK' | 'ITIL_TICKET' | string
  status: string
  title: string | null | undefined
  description: string | null | undefined
  priority: string | null | undefined
  assigneeId: string | null | undefined
  acceptanceCriteria?: string | null
  startDate?: Date | string | null
  endDate?: Date | string | null
  isMilestone?: boolean
  plannedValue?: number | null
  itilAttributes?: ItilAttributes | null
  scrumAttributes?: ScrumAttributes | null
  pmiAttributes?: PmiAttributes | null
  userStory?: UserStory | null
}

// ─── Helpers ─────────────────────────────────────────────────────────

function err(code: string, message: string, field?: string): RuleViolation {
  return { code, message, field, severity: 'error' }
}

function warn(code: string, message: string, field?: string): RuleViolation {
  return { code, message, field, severity: 'warning' }
}

// ─── Reglas globales ─────────────────────────────────────────────────

function checkGlobalRules(input: ValidationInput): RuleViolation[] {
  const out: RuleViolation[] = []

  // G-01: title, description, priority, assigneeId no nulos
  if (!input.title?.trim()) out.push(err('G-01', 'Título es obligatorio', 'title'))
  if (!input.description?.trim())
    out.push(err('G-01', 'Descripción es obligatoria', 'description'))
  if (!input.priority?.trim())
    out.push(err('G-01', 'Prioridad es obligatoria', 'priority'))
  if (!input.assigneeId)
    out.push(err('G-01', 'Responsable es obligatorio', 'assigneeId'))

  // G-04: acceptance_criteria longitud mínima 30 caracteres
  // Para AGILE_STORY este texto vive en `userStory.criteria` (concatenado);
  // para los demás puede venir como campo aparte. Permitimos cumplimiento
  // por cualquiera de los dos canales.
  const ac =
    (input.acceptanceCriteria ?? '').trim() ||
    (input.userStory?.criteria ?? [])
      .map((c) => c.text)
      .join(' · ')
  if (input.type === 'AGILE_STORY') {
    if (ac.length < 30) {
      out.push(
        err(
          'G-04',
          'Criterios de aceptación deben sumar al menos 30 caracteres',
          'acceptanceCriteria',
        ),
      )
    }
  }

  return out
}

// ─── Reglas ITIL ────────────────────────────────────────────────────

function checkItilRules(input: ValidationInput): RuleViolation[] {
  const out: RuleViolation[] = []
  const it = input.itilAttributes
  // I-01: existe registro itil
  if (!it) {
    out.push(err('I-01', 'Faltan atributos ITIL (tipo de registro, impacto, urgencia)', 'itilAttributes'))
    return out
  }

  // I-04: si status >= In Progress → diagnosis no nulo
  const inProgressOrLater = ['IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'DONE']
  if (
    inProgressOrLater.includes(input.status) &&
    !it.diagnosis?.trim()
  ) {
    out.push(
      err('I-04', 'Diagnóstico requerido al pasar a "En progreso" o estados posteriores', 'diagnosis'),
    )
  }

  // I-05: si status = Resolved/Closed → resolution no nulo
  if (
    ['RESOLVED', 'CLOSED', 'DONE'].includes(input.status) &&
    !it.resolution?.trim()
  ) {
    out.push(
      err('I-05', 'Resolución requerida para cerrar un ticket ITIL', 'resolution'),
    )
  }

  // I-06: Problem + Closed → root_cause obligatorio
  if (
    it.recordType === 'Problem' &&
    ['CLOSED', 'DONE'].includes(input.status) &&
    !it.rootCause?.trim()
  ) {
    out.push(
      err('I-06', 'Causa raíz (RCA) obligatoria para cerrar un Problema', 'rootCause'),
    )
  }

  // I-07: Change → changeType, implementationPlan, rollbackPlan,
  // changeWindowStart, changeWindowEnd no nulos
  if (it.recordType === 'Change') {
    if (!it.changeType)
      out.push(err('I-07', 'Tipo de cambio requerido para Cambios', 'changeType'))
    if (!it.implementationPlan?.trim())
      out.push(err('I-07', 'Plan de implementación requerido', 'implementationPlan'))
    if (!it.rollbackPlan?.trim())
      out.push(err('I-07', 'Plan de rollback requerido', 'rollbackPlan'))
    if (!it.changeWindowStart)
      out.push(err('I-07', 'Inicio de ventana de cambio requerido', 'changeWindowStart'))
    if (!it.changeWindowEnd)
      out.push(err('I-07', 'Fin de ventana de cambio requerido', 'changeWindowEnd'))

    // I-08: Normal/Emergency → cabApproval=TRUE antes de "In Progress"
    if (
      (it.changeType === 'Normal' || it.changeType === 'Emergency') &&
      inProgressOrLater.includes(input.status) &&
      !it.cabApproval
    ) {
      out.push(
        err(
          'I-08',
          'Aprobación CAB requerida para Cambios Normal/Emergency antes de iniciar',
          'cabApproval',
        ),
      )
    }

    // I-09: changeWindowEnd > changeWindowStart
    if (it.changeWindowStart && it.changeWindowEnd) {
      const s = new Date(it.changeWindowStart).getTime()
      const e = new Date(it.changeWindowEnd).getTime()
      if (e <= s) {
        out.push(
          err(
            'I-09',
            'Fin de ventana debe ser posterior al inicio',
            'changeWindowEnd',
          ),
        )
      }
    }
  }

  // I-02 (priority_matrix consistente): se valida implícitamente porque
  // se calcula vía calculatePriorityMatrix() — no se persiste.

  // I-03, I-10: requieren CMDB / SLA — deferred a Fase 3.
  return out
}

// ─── Reglas PMI ─────────────────────────────────────────────────────

function checkPmiRules(input: ValidationInput): RuleViolation[] {
  const out: RuleViolation[] = []
  const pmi = input.pmiAttributes

  // P-01: pmiAttributes presente
  if (!pmi) {
    out.push(
      err(
        'P-01',
        'Faltan atributos PMI (entregable y criterios de calidad como mínimo)',
        'pmiAttributes',
      ),
    )
    return out
  }

  // P-02: wbsCode formato \d+(\.\d+)*
  if (pmi.wbsCode && !/^\d+(\.\d+)*$/.test(pmi.wbsCode)) {
    out.push(
      err('P-02', 'EDT debe seguir el formato 1.2.3 (números separados por puntos)', 'wbsCode'),
    )
  }

  // P-03: endDate >= startDate
  if (input.startDate && input.endDate) {
    const s = new Date(input.startDate as string).getTime()
    const e = new Date(input.endDate as string).getTime()
    if (e < s) {
      out.push(err('P-03', 'Fecha de fin no puede ser anterior a la de inicio', 'endDate'))
    }
  }

  // P-04: isMilestone → start == end (duración 0)
  if (input.isMilestone) {
    if (input.startDate && input.endDate) {
      const s = new Date(input.startDate as string).getTime()
      const e = new Date(input.endDate as string).getTime()
      if (s !== e) {
        out.push(
          warn(
            'P-04',
            'Un hito debería tener duración cero (start = end)',
            'isMilestone',
          ),
        )
      }
    }
  }

  // P-06: exactamente UN Accountable
  if (pmi.raci) {
    if (!pmi.raci.accountable) {
      out.push(err('P-06', 'RACI: debe asignarse exactamente un Accountable', 'raci.accountable'))
    }
  } else {
    // RACI no provisto = sin Accountable → falla regla
    out.push(err('P-06', 'RACI: matriz no definida (falta Accountable)', 'raci'))
  }

  // P-09: optimistic ≤ estimate ≤ pessimistic
  if (
    pmi.durationOptimistic != null &&
    pmi.durationPessimistic != null
  ) {
    if (pmi.durationOptimistic > pmi.durationPessimistic) {
      out.push(
        err(
          'P-09',
          'Duración optimista no puede ser mayor que la pesimista',
          'durationOptimistic',
        ),
      )
    }
  }

  // Entregable + qualityCriteria obligatorios (del doc, columna Obligatorio).
  if (!pmi.deliverable?.trim()) {
    out.push(err('P-DELIVERABLE', 'Entregable es obligatorio', 'deliverable'))
  }
  if (!pmi.qualityCriteria?.trim()) {
    out.push(
      err('P-QUALITY', 'Criterios de calidad son obligatorios', 'qualityCriteria'),
    )
  }

  // P-05, P-07, P-08, P-10: requieren queries cross-task o baseline
  // tracking → deferred a Fase 2/3.
  return out
}

// ─── Reglas Scrum ───────────────────────────────────────────────────

function checkScrumRules(input: ValidationInput): RuleViolation[] {
  const out: RuleViolation[] = []
  const sc = input.scrumAttributes

  // S-01: scrumAttributes presente
  if (!sc) {
    out.push(
      err('S-01', 'Faltan atributos Scrum (tipo de trabajo, horas, DoD)', 'scrumAttributes'),
    )
    return out
  }

  // S-05: hoursRemaining ≤ hoursEstimate al crear
  if (
    typeof sc.hoursRemaining === 'number' &&
    typeof sc.hoursEstimate === 'number' &&
    sc.hoursRemaining > sc.hoursEstimate
  ) {
    out.push(
      warn(
        'S-05',
        'Horas restantes no deberían exceder la estimación inicial sin justificación',
        'hoursRemaining',
      ),
    )
  }

  // S-06: dod_checklist no vacío; si boardStatus = Done → todos checked
  if (sc.dodChecklist.length === 0) {
    out.push(err('S-06', 'Definition of Done no puede estar vacía', 'dodChecklist'))
  } else if (sc.boardStatus === 'Done') {
    const allChecked = sc.dodChecklist.every((d) => d.checked)
    if (!allChecked) {
      out.push(
        err(
          'S-06',
          'No se puede pasar a Done sin completar todos los items de DoD',
          'dodChecklist',
        ),
      )
    }
  }

  // S-07: Bug → componente o reviewNote con origen
  if (sc.taskKind === 'Bug') {
    const hasOrigin =
      (sc.components ?? []).length > 0 ||
      (sc.reviewNotes ?? '').trim().length > 0
    if (!hasOrigin) {
      out.push(
        err(
          'S-07',
          'Bug debe enlazar al menos un componente afectado o nota de origen',
          'components',
        ),
      )
    }
  }

  // S-09: hoursEstimate ≤ umbral (16h default)
  const ESTIMATE_THRESHOLD = 16
  if (
    typeof sc.hoursEstimate === 'number' &&
    sc.hoursEstimate > ESTIMATE_THRESHOLD
  ) {
    out.push(
      warn(
        'S-09',
        `Estimación supera ${ESTIMATE_THRESHOLD}h — considera descomponer la tarea`,
        'hoursEstimate',
      ),
    )
  }

  // S-02, S-03, S-04, S-08: requieren acceso a parent_story, sprint,
  // team. Deferred — se pueden implementar con queries adicionales
  // cuando exista la infra.
  return out
}

// ─── Entry point ────────────────────────────────────────────────────

export function validateTaskDefinition(
  input: ValidationInput,
): RuleViolation[] {
  const violations: RuleViolation[] = []
  violations.push(...checkGlobalRules(input))

  if (input.type === 'ITIL_TICKET') {
    violations.push(...checkItilRules(input))
  } else if (input.type === 'PMI_TASK') {
    violations.push(...checkPmiRules(input))
  } else if (input.type === 'AGILE_STORY') {
    violations.push(...checkScrumRules(input))
  }

  return violations
}

/**
 * `true` cuando no hay violations de severidad 'error'. Las warnings no
 * bloquean la completitud (son advertencias para el usuario, no fallos).
 */
export function isDefinitionComplete(violations: RuleViolation[]): boolean {
  return !violations.some((v) => v.severity === 'error')
}
