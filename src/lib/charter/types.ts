/**
 * Wave P11-PMI (HU-12.1) — Project Charter PMBOK.
 *
 * Documento que autoriza formalmente el inicio del proyecto y otorga
 * autoridad al Project Manager. Es un artefacto clave del PMBOK
 * (Integration Management · Develop Project Charter).
 *
 * Persistido en `Project.charter` Json. Versionado vía `version` para
 * tracking de revisiones (cambia cada vez que se aprueba un cambio
 * mayor en el charter).
 */

export interface CharterMilestone {
  name: string
  /** ISO date string. */
  targetDate: string | null
}

export interface ProjectCharter {
  vision: string
  businessJustification: string
  successCriteria: string[]
  milestones: CharterMilestone[]
  approvedAt: string | null
  approvedBy: string | null
  version: number
}

export const EMPTY_CHARTER: ProjectCharter = {
  vision: '',
  businessJustification: '',
  successCriteria: [],
  milestones: [],
  approvedAt: null,
  approvedBy: null,
  version: 0,
}

export function normalizeCharter(raw: unknown): ProjectCharter {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_CHARTER }
  const r = raw as Record<string, unknown>
  return {
    vision: typeof r.vision === 'string' ? r.vision : '',
    businessJustification:
      typeof r.businessJustification === 'string' ? r.businessJustification : '',
    successCriteria: Array.isArray(r.successCriteria)
      ? r.successCriteria.filter(
          (x): x is string => typeof x === 'string' && x.trim().length > 0,
        )
      : [],
    milestones: Array.isArray(r.milestones)
      ? r.milestones
          .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
          .map((m) => ({
            name: typeof m.name === 'string' ? m.name : '',
            targetDate:
              typeof m.targetDate === 'string' && m.targetDate.length > 0
                ? m.targetDate
                : null,
          }))
          .filter((m) => m.name.trim().length > 0)
      : [],
    approvedAt:
      typeof r.approvedAt === 'string' && r.approvedAt.length > 0
        ? r.approvedAt
        : null,
    approvedBy:
      typeof r.approvedBy === 'string' && r.approvedBy.length > 0
        ? r.approvedBy
        : null,
    version: typeof r.version === 'number' ? r.version : 0,
  }
}

export function isCharterApproved(c: ProjectCharter): boolean {
  return !!c.approvedAt && !!c.approvedBy
}
