/**
 * PMI Task Attributes — extensión del modelo Task para tareas de tipo
 * PMI_TASK siguiendo el documento "Definición Extendida de Tareas".
 * Persistido en `Task.pmiAttributes` como Json.
 *
 * Cubre los campos del documento (sección 3.3) que NO existen ya como
 * columnas en `Task` (las que SÍ existen: startDate, endDate, plannedValue,
 * actualCost, isMilestone, progress, dependencies — se quedan donde están).
 *
 * Mapping al documento (sección 3.3, sólo nuevos):
 *   - wbs_code           → wbsCode
 *   - phase              → phaseName (string libre; la FK Phase ya existe)
 *   - duration_optimistic → durationOptimistic (PERT)
 *   - duration_pessimistic → durationPessimistic (PERT)
 *   - schedule_constraint → scheduleConstraint
 *   - raci               → raci { responsible, accountable, consulted, informed }
 *   - deliverable        → deliverable
 *   - quality_criteria   → qualityCriteria
 *   - assumptions        → assumptions
 *
 * NOTA: la regla P-06 del documento exige *exactamente un* Accountable.
 * Se modela como string opcional (un único userId/nombre).
 */

export type PmiScheduleConstraint =
  | 'ASAP'
  | 'ALAP'
  | 'MSO' // Must Start On
  | 'MFO' // Must Finish On
  | 'SNET' // Start No Earlier Than
  | 'SNLT' // Start No Later Than
  | 'FNET' // Finish No Earlier Than
  | 'FNLT' // Finish No Later Than

export type PmiRaci = {
  responsible?: string[]
  accountable?: string // único por regla P-06
  consulted?: string[]
  informed?: string[]
}

export type PmiAttributes = {
  wbsCode?: string | null
  phaseName?: string | null
  deliverable?: string | null
  qualityCriteria?: string | null
  scheduleConstraint?: PmiScheduleConstraint | null
  raci?: PmiRaci | null
  assumptions?: string | null
  durationOptimistic?: number | null
  durationPessimistic?: number | null
}

export function emptyPmiAttributes(): PmiAttributes {
  return {}
}

export function normalizePmiAttributes(raw: unknown): PmiAttributes | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  const constraints: PmiScheduleConstraint[] = [
    'ASAP',
    'ALAP',
    'MSO',
    'MFO',
    'SNET',
    'SNLT',
    'FNET',
    'FNLT',
  ]

  const pickString = (k: string) =>
    typeof r[k] === 'string' && r[k] !== '' ? (r[k] as string) : null

  const pickNum = (k: string) =>
    typeof r[k] === 'number' && !isNaN(r[k] as number) ? (r[k] as number) : null

  let raci: PmiRaci | null = null
  if (r.raci && typeof r.raci === 'object') {
    const raw = r.raci as Record<string, unknown>
    const arrStr = (v: unknown): string[] | undefined =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string' && x.length > 0)
        : undefined
    raci = {
      responsible: arrStr(raw.responsible),
      accountable:
        typeof raw.accountable === 'string' && raw.accountable !== ''
          ? raw.accountable
          : undefined,
      consulted: arrStr(raw.consulted),
      informed: arrStr(raw.informed),
    }
    // Si todo vino vacío, devolvemos null para no inflar el Json.
    if (
      !raci.responsible?.length &&
      !raci.accountable &&
      !raci.consulted?.length &&
      !raci.informed?.length
    ) {
      raci = null
    }
  }

  const result: PmiAttributes = {
    wbsCode: pickString('wbsCode'),
    phaseName: pickString('phaseName'),
    deliverable: pickString('deliverable'),
    qualityCriteria: pickString('qualityCriteria'),
    scheduleConstraint:
      typeof r.scheduleConstraint === 'string' &&
      constraints.includes(r.scheduleConstraint as PmiScheduleConstraint)
        ? (r.scheduleConstraint as PmiScheduleConstraint)
        : null,
    raci,
    assumptions: pickString('assumptions'),
    durationOptimistic: pickNum('durationOptimistic'),
    durationPessimistic: pickNum('durationPessimistic'),
  }

  // Si todos los campos están vacíos, retornar null (consistente con userStory).
  const anySet = Object.values(result).some(
    (v) => v !== null && v !== undefined,
  )
  return anySet ? result : null
}
