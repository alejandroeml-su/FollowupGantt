import { describe, it, expect } from 'vitest'

/**
 * Ola P4 · P4-5 · Unit tests para `src/lib/integrations/github.ts`.
 *
 * Validadores y parser puros (no hay I/O en P4 — esto cambia cuando se
 * añadan webhooks inbound o llamadas REST autenticadas).
 */

import {
  validateRepoFullName,
  validateIssueNumber,
  parseGitHubReference,
  buildIssueUrl,
  buildPrUrl,
  buildLinkUrl,
  validateGitHubConfig,
} from '@/lib/integrations/github'

describe('validateRepoFullName', () => {
  it('acepta owner/repo simples', () => {
    expect(validateRepoFullName('alejandroeml-su/FollowupGantt')).toBe(
      'alejandroeml-su/FollowupGantt',
    )
    expect(validateRepoFullName('vercel/next.js')).toBe('vercel/next.js')
  })

  it('trim spaces', () => {
    expect(validateRepoFullName('  a/b  ')).toBe('a/b')
  })

  it('rechaza shape inválido', () => {
    expect(() => validateRepoFullName('')).toThrow(/INVALID_CONFIG/)
    expect(() => validateRepoFullName('only-one')).toThrow(/INVALID_CONFIG/)
    expect(() => validateRepoFullName('a//b')).toThrow(/INVALID_CONFIG/)
    expect(() => validateRepoFullName('-a/b')).toThrow(/INVALID_CONFIG/)
  })
})

describe('validateIssueNumber', () => {
  it('acepta entero positivo (numérico o string)', () => {
    expect(validateIssueNumber(42)).toBe(42)
    expect(validateIssueNumber('42')).toBe(42)
  })

  it('rechaza ≤0, decimal, NaN', () => {
    expect(() => validateIssueNumber(0)).toThrow(/INVALID_CONFIG/)
    expect(() => validateIssueNumber(-1)).toThrow(/INVALID_CONFIG/)
    expect(() => validateIssueNumber(1.5)).toThrow(/INVALID_CONFIG/)
    expect(() => validateIssueNumber('abc')).toThrow(/INVALID_CONFIG/)
  })
})

describe('parseGitHubReference', () => {
  it('parsea URL de issue', () => {
    expect(
      parseGitHubReference('https://github.com/owner/repo/issues/42'),
    ).toEqual({ repoFullName: 'owner/repo', issueNumber: 42, kind: 'ISSUE' })
  })

  it('parsea URL de PR', () => {
    expect(
      parseGitHubReference('https://github.com/owner/repo/pull/7'),
    ).toEqual({ repoFullName: 'owner/repo', issueNumber: 7, kind: 'PR' })
  })

  it('parsea owner/repo#N', () => {
    expect(parseGitHubReference('owner/repo#3')).toEqual({
      repoFullName: 'owner/repo',
      issueNumber: 3,
      kind: 'ISSUE',
    })
  })

  it('parsea #N con defaultRepo', () => {
    expect(parseGitHubReference('#9', { defaultRepo: 'a/b' })).toEqual({
      repoFullName: 'a/b',
      issueNumber: 9,
      kind: 'ISSUE',
    })
    // numero pelado también
    expect(parseGitHubReference('11', { defaultRepo: 'a/b' })).toEqual({
      repoFullName: 'a/b',
      issueNumber: 11,
      kind: 'ISSUE',
    })
  })

  it('rechaza referencia numérica sin defaultRepo', () => {
    expect(() => parseGitHubReference('#9')).toThrow(/defaultRepo/)
  })

  it('rechaza shape no reconocido', () => {
    expect(() => parseGitHubReference('totally-bogus')).toThrow(
      /INVALID_CONFIG.*no reconocida/,
    )
  })
})

describe('buildIssueUrl / buildPrUrl / buildLinkUrl', () => {
  it('construye URLs canónicas', () => {
    expect(buildIssueUrl('a/b', 1)).toBe('https://github.com/a/b/issues/1')
    expect(buildPrUrl('a/b', 1)).toBe('https://github.com/a/b/pull/1')
  })

  it('buildLinkUrl despacha por kind', () => {
    expect(
      buildLinkUrl({ repoFullName: 'a/b', issueNumber: 1, kind: 'PR' }),
    ).toBe('https://github.com/a/b/pull/1')
    expect(
      buildLinkUrl({ repoFullName: 'a/b', issueNumber: 1, kind: 'ISSUE' }),
    ).toBe('https://github.com/a/b/issues/1')
  })
})

describe('validateGitHubConfig', () => {
  it('config vacía es válida', () => {
    expect(validateGitHubConfig({})).toEqual({})
  })

  it('defaultRepo válido se conserva', () => {
    expect(validateGitHubConfig({ defaultRepo: 'a/b' })).toEqual({
      defaultRepo: 'a/b',
    })
  })

  it('defaultRepo inválido lanza', () => {
    expect(() => validateGitHubConfig({ defaultRepo: 'no-slash' })).toThrow(
      /INVALID_CONFIG/,
    )
    expect(() => validateGitHubConfig({ defaultRepo: 123 })).toThrow(
      /INVALID_CONFIG.*string/,
    )
  })

  it('rechaza no-objeto', () => {
    expect(() => validateGitHubConfig(null)).toThrow(/INVALID_CONFIG/)
    expect(() => validateGitHubConfig('foo')).toThrow(/INVALID_CONFIG/)
  })
})
