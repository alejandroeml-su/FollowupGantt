/**
 * R3.0 · Fase 2 · SSO/SAML — Mapeo Assertion → MappedSsoProfile.
 *
 * Puro (sin Prisma/Next) para que sea testeable en aislamiento.
 */

import type { WorkspaceRole } from '@prisma/client'
import {
  ssoError,
  type MappedSsoProfile,
  type ParsedSamlAssertion,
  type SsoAttributeMap,
} from './types'

const ROLE_PRIORITY: Record<WorkspaceRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MEMBER: 2,
}

/**
 * Resuelve el `WorkspaceRole` cuando el assertion contiene un atributo
 * `groups` y `attributeMap.roleMap` define equivalencias. Si el usuario
 * pertenece a varios grupos mapeados, devuelve el de mayor privilegio
 * según `ROLE_PRIORITY`. Si no hay match → null (caller decide default).
 */
export function resolveWorkspaceRole(
  groups: string[],
  roleMap: Record<string, WorkspaceRole> | undefined,
): WorkspaceRole | null {
  if (!roleMap || groups.length === 0) return null
  let best: WorkspaceRole | null = null
  for (const g of groups) {
    const mapped = roleMap[g]
    if (!mapped) continue
    if (!best || ROLE_PRIORITY[mapped] > ROLE_PRIORITY[best]) {
      best = mapped
    }
  }
  return best
}

/**
 * Convierte un Assertion ya validado + la configuración del provider en
 * un perfil normalizado que las server actions pueden persistir.
 *
 * @throws `[MISSING_EMAIL]` si no encuentra el atributo email exigido por
 *         `attributeMap.email`.
 */
export function mapAssertionToProfile(input: {
  assertion: ParsedSamlAssertion
  attributeMap: SsoAttributeMap
}): MappedSsoProfile {
  const { assertion, attributeMap } = input
  const emailRaw = assertion.attributes[attributeMap.email]
  if (!emailRaw) {
    ssoError(
      'MISSING_EMAIL',
      `atributo email "${attributeMap.email}" no presente en assertion`,
    )
  }
  const email = emailRaw.trim().toLowerCase()
  const name = attributeMap.name
    ? (assertion.attributes[attributeMap.name] ?? deriveNameFromEmail(email))
    : deriveNameFromEmail(email)

  let workspaceRole: WorkspaceRole | null = null
  if (attributeMap.groups) {
    const groups = assertion.attributesMulti[attributeMap.groups] ?? []
    workspaceRole = resolveWorkspaceRole(groups, attributeMap.roleMap)
  }

  return {
    externalId: assertion.nameId,
    email,
    name,
    workspaceRole,
  }
}

function deriveNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || email
}

/**
 * Valida el shape genérico del JSON que el admin guarda en
 * `SsoProvider.attributeMap`. Tolerante: rellena defaults si faltan
 * campos opcionales. Lanza `[INVALID_INPUT]` si `email` es vacío.
 */
export function parseAttributeMap(raw: unknown): SsoAttributeMap {
  if (!raw || typeof raw !== 'object') {
    ssoError('INVALID_INPUT', 'attributeMap debe ser objeto')
  }
  const obj = raw as Record<string, unknown>
  const email = typeof obj.email === 'string' ? obj.email.trim() : ''
  if (!email) {
    ssoError('INVALID_INPUT', 'attributeMap.email es obligatorio')
  }
  const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : undefined
  const groups = typeof obj.groups === 'string' && obj.groups.trim() ? obj.groups.trim() : undefined
  let roleMap: Record<string, WorkspaceRole> | undefined
  if (obj.roleMap && typeof obj.roleMap === 'object') {
    const entries = Object.entries(obj.roleMap as Record<string, unknown>)
    const out: Record<string, WorkspaceRole> = {}
    for (const [k, v] of entries) {
      if (typeof v === 'string' && isWorkspaceRole(v)) {
        out[k] = v
      }
    }
    if (Object.keys(out).length > 0) {
      roleMap = out
    }
  }
  return { email, name, groups, roleMap }
}

function isWorkspaceRole(v: string): v is WorkspaceRole {
  return v === 'OWNER' || v === 'ADMIN' || v === 'MEMBER'
}
