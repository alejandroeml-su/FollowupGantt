/**
 * ITIL Task Attributes — extensión del modelo Task para tareas de tipo
 * ITIL_TICKET. Persistido en `Task.itilAttributes` como columna Json
 * siguiendo el mismo patrón que `Task.userStory` (Wave P9).
 *
 * Fase 1 (2026-05-13): captura los campos mínimos necesarios para que el
 * usuario pueda registrar un incidente/problema/cambio/SR/evento sin
 * dependencias externas (CMDB, SLA templates, support groups). Las
 * referencias FK quedan en deuda registrada para Fase 3.
 *
 * Mapping al documento de Definición Extendida de Tareas (sección 3.2):
 *   - itil_record_type → recordType
 *   - impact, urgency  → impact, urgency
 *   - service_category → serviceCategory (string libre por ahora)
 *   - symptom, diagnosis, workaround, resolution, root_cause → idem
 *   - change_type, risk_assessment, implementation_plan, rollback_plan,
 *     cab_approval, change_window_start/end → solo aplican si
 *     recordType === 'Change'
 *
 * Reglas de validación (Fase 1 mínimas):
 *   - recordType es obligatorio
 *   - impact + urgency son obligatorios
 *   - Si recordType=Problem y status=Closed → rootCause obligatorio
 *     (se valida en server action al cerrar)
 *   - Si recordType=Change → changeType, implementationPlan, rollbackPlan
 *     son obligatorios
 *
 * La matriz `priority_matrix` (P1..P4) se calcula derivada de impact +
 * urgency en el cliente; no se persiste para evitar drift.
 */

export type ItilRecordType =
  | 'Incident'
  | 'Problem'
  | 'Change'
  | 'ServiceRequest'
  | 'Event'

export type ItilImpact = 'Bajo' | 'Medio' | 'Alto'
export type ItilUrgency = 'Baja' | 'Media' | 'Alta'
export type ItilChangeType = 'Standard' | 'Normal' | 'Emergency'

export type ItilAttributes = {
  recordType: ItilRecordType
  serviceCategory?: string | null
  serviceSubcategory?: string | null
  impact: ItilImpact
  urgency: ItilUrgency
  reporter?: string | null
  symptom?: string | null
  diagnosis?: string | null
  workaround?: string | null
  resolution?: string | null
  rootCause?: string | null
  /** Solo aplica cuando recordType === 'Change'. */
  changeType?: ItilChangeType | null
  riskAssessment?: string | null
  implementationPlan?: string | null
  rollbackPlan?: string | null
  cabApproval?: boolean | null
  changeWindowStart?: string | null
  changeWindowEnd?: string | null
}

export function emptyItilAttributes(): ItilAttributes {
  return {
    recordType: 'Incident',
    impact: 'Medio',
    urgency: 'Media',
  }
}

/**
 * Calcula la matriz P1..P4 a partir de impact × urgency. Mapeo
 * estándar ITIL:
 *
 *           Urgencia
 *           Alta  Media  Baja
 *   I Alto   P1    P2    P3
 *   m Medio  P2    P3    P3
 *   p Bajo   P3    P3    P4
 */
export function calculatePriorityMatrix(
  impact: ItilImpact,
  urgency: ItilUrgency,
): 'P1' | 'P2' | 'P3' | 'P4' {
  if (impact === 'Alto' && urgency === 'Alta') return 'P1'
  if ((impact === 'Alto' && urgency === 'Media') || (impact === 'Medio' && urgency === 'Alta')) {
    return 'P2'
  }
  if (impact === 'Bajo' && urgency === 'Baja') return 'P4'
  return 'P3'
}

/**
 * Valida y normaliza un payload Json arbitrario al shape `ItilAttributes`.
 * Si el input es inválido (sin recordType), devuelve `null`.
 */
export function normalizeItilAttributes(raw: unknown): ItilAttributes | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const recordTypes: ItilRecordType[] = [
    'Incident',
    'Problem',
    'Change',
    'ServiceRequest',
    'Event',
  ]
  const impacts: ItilImpact[] = ['Bajo', 'Medio', 'Alto']
  const urgencies: ItilUrgency[] = ['Baja', 'Media', 'Alta']
  const changeTypes: ItilChangeType[] = ['Standard', 'Normal', 'Emergency']

  if (typeof r.recordType !== 'string' || !recordTypes.includes(r.recordType as ItilRecordType)) {
    return null
  }
  const recordType = r.recordType as ItilRecordType

  const impact: ItilImpact =
    typeof r.impact === 'string' && impacts.includes(r.impact as ItilImpact)
      ? (r.impact as ItilImpact)
      : 'Medio'
  const urgency: ItilUrgency =
    typeof r.urgency === 'string' && urgencies.includes(r.urgency as ItilUrgency)
      ? (r.urgency as ItilUrgency)
      : 'Media'

  const pickString = (k: string) =>
    typeof r[k] === 'string' && r[k] !== '' ? (r[k] as string) : null

  return {
    recordType,
    serviceCategory: pickString('serviceCategory'),
    serviceSubcategory: pickString('serviceSubcategory'),
    impact,
    urgency,
    reporter: pickString('reporter'),
    symptom: pickString('symptom'),
    diagnosis: pickString('diagnosis'),
    workaround: pickString('workaround'),
    resolution: pickString('resolution'),
    rootCause: pickString('rootCause'),
    changeType:
      typeof r.changeType === 'string' && changeTypes.includes(r.changeType as ItilChangeType)
        ? (r.changeType as ItilChangeType)
        : null,
    riskAssessment: pickString('riskAssessment'),
    implementationPlan: pickString('implementationPlan'),
    rollbackPlan: pickString('rollbackPlan'),
    cabApproval: typeof r.cabApproval === 'boolean' ? r.cabApproval : null,
    changeWindowStart: pickString('changeWindowStart'),
    changeWindowEnd: pickString('changeWindowEnd'),
  }
}
