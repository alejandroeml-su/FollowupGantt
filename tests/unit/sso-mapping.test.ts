import { describe, it, expect } from 'vitest'

/**
 * R3.0 · Fase 2 · SSO/SAML — Tests de mapeo Assertion → MappedSsoProfile.
 *
 * Cubre:
 *   - mapAssertionToProfile aplica attributeMap correcto.
 *   - mapAssertionToProfile lanza [MISSING_EMAIL] si falta el atributo.
 *   - resolveWorkspaceRole prioriza OWNER > ADMIN > MEMBER > VIEWER.
 *   - parseAttributeMap normaliza y rechaza email vacío.
 */

import {
  mapAssertionToProfile,
  resolveWorkspaceRole,
  parseAttributeMap,
} from '@/lib/sso/mapping'
import type { ParsedSamlAssertion } from '@/lib/sso/types'

function buildAssertion(
  attrs: Record<string, string | string[]>,
): ParsedSamlAssertion {
  const attributes: Record<string, string> = {}
  const attributesMulti: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(attrs)) {
    const list = Array.isArray(v) ? v : [v]
    attributes[k] = list[0]
    attributesMulti[k] = list
  }
  return {
    nameId: 'name-id-xyz',
    sessionIndex: 'sess',
    attributes,
    attributesMulti,
    issuer: 'https://idp.example.com/',
    notOnOrAfter: null,
  }
}

describe('mapAssertionToProfile', () => {
  it('1. mapea email + name del assertion', () => {
    const assertion = buildAssertion({
      'http://schemas/email': 'EDWIN@avante.com',
      'http://schemas/name': 'Edwin Martinez',
    })
    const profile = mapAssertionToProfile({
      assertion,
      attributeMap: {
        email: 'http://schemas/email',
        name: 'http://schemas/name',
      },
    })
    expect(profile.externalId).toBe('name-id-xyz')
    expect(profile.email).toBe('edwin@avante.com')
    expect(profile.name).toBe('Edwin Martinez')
    expect(profile.workspaceRole).toBeNull()
  })

  it('2. deriva nombre del email si no hay atributo name', () => {
    const assertion = buildAssertion({ email: 'john.doe@x.com' })
    const profile = mapAssertionToProfile({
      assertion,
      attributeMap: { email: 'email' },
    })
    expect(profile.name).toBe('John Doe')
  })

  it('3. lanza [MISSING_EMAIL] cuando el atributo no existe', () => {
    const assertion = buildAssertion({ otra: 'cosa' })
    expect(() =>
      mapAssertionToProfile({
        assertion,
        attributeMap: { email: 'http://schemas/email' },
      }),
    ).toThrowError(/MISSING_EMAIL/)
  })

  it('4. aplica roleMap a groups y elige el rol más alto', () => {
    const assertion = buildAssertion({
      email: 'u@e.com',
      groups: ['ENG', 'SyncAdmins', 'PMO'],
    })
    const profile = mapAssertionToProfile({
      assertion,
      attributeMap: {
        email: 'email',
        groups: 'groups',
        roleMap: {
          ENG: 'MEMBER',
          SyncAdmins: 'ADMIN',
          PMO: 'MEMBER',
        },
      },
    })
    expect(profile.workspaceRole).toBe('ADMIN')
  })
})

describe('resolveWorkspaceRole', () => {
  it('5. devuelve null si no hay roleMap', () => {
    expect(resolveWorkspaceRole(['A', 'B'], undefined)).toBeNull()
  })

  it('6. devuelve OWNER cuando coincide aunque haya MEMBER también', () => {
    const role = resolveWorkspaceRole(['A', 'B'], {
      A: 'MEMBER',
      B: 'OWNER',
    })
    expect(role).toBe('OWNER')
  })

  it('7. devuelve null si ningún grupo del IdP coincide', () => {
    const role = resolveWorkspaceRole(['X', 'Y'], { Z: 'ADMIN' })
    expect(role).toBeNull()
  })
})

describe('parseAttributeMap', () => {
  it('8. exige email no vacío', () => {
    expect(() => parseAttributeMap({ email: '' })).toThrowError(/INVALID_INPUT/)
    expect(() => parseAttributeMap({})).toThrowError(/INVALID_INPUT/)
    expect(() => parseAttributeMap(null)).toThrowError(/INVALID_INPUT/)
  })

  it('9. limpia espacios y filtra roleMap inválido', () => {
    const map = parseAttributeMap({
      email: '  email  ',
      name: '   ',
      groups: 'g',
      roleMap: {
        A: 'ADMIN',
        B: 'NOT_A_ROLE',
        C: 'OWNER',
      },
    })
    expect(map.email).toBe('email')
    expect(map.name).toBeUndefined()
    expect(map.groups).toBe('g')
    expect(map.roleMap).toEqual({ A: 'ADMIN', C: 'OWNER' })
  })
})
