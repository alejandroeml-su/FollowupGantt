import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P4 · Equipo P4-2 — tests del helper de autenticación por token.
 *
 * Mockeamos `@/lib/prisma` para no tocar BD. Cubre extracción del header,
 * validación del formato `fg_*`, lookup por hash, expiración y revocación,
 * y el chequeo de scope.
 */

const findUniqueApiToken = vi.fn()
const updateApiToken = vi.fn().mockResolvedValue({})

vi.mock('@/lib/prisma', () => ({
  default: {
    apiToken: {
      findUnique: (...args: unknown[]) => findUniqueApiToken(...args),
      update: (...args: unknown[]) => updateApiToken(...args),
    },
  },
}))

vi.mock('server-only', () => ({}))

import {
  generateApiToken,
  sha256Hex,
  extractBearerToken,
  authenticateToken,
  authenticateRequest,
  requireScope,
} from '@/lib/api/auth-token'

beforeEach(() => {
  findUniqueApiToken.mockReset()
  updateApiToken.mockReset().mockResolvedValue({})
})

describe('generateApiToken', () => {
  it('genera plaintext con prefijo fg_, hash sha256 hex y prefix display', () => {
    const t = generateApiToken()
    expect(t.plaintext.startsWith('fg_')).toBe(true)
    expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256Hex(t.plaintext)).toBe(t.tokenHash)
    expect(t.prefix.startsWith('fg_')).toBe(true)
    expect(t.prefix.length).toBe(12)
  })

  it('cada llamada produce tokens distintos', () => {
    const a = generateApiToken()
    const b = generateApiToken()
    expect(a.plaintext).not.toBe(b.plaintext)
    expect(a.tokenHash).not.toBe(b.tokenHash)
  })
})

describe('extractBearerToken', () => {
  it('parsea Bearer correctamente', () => {
    expect(extractBearerToken('Bearer fg_abc')).toBe('fg_abc')
    expect(extractBearerToken('Bearer  fg_xyz  ')).toBe('fg_xyz')
  })

  it('null/header inválido devuelve null', () => {
    expect(extractBearerToken(null)).toBeNull()
    expect(extractBearerToken('')).toBeNull()
    expect(extractBearerToken('Basic xxx')).toBeNull()
    expect(extractBearerToken('fg_xxx')).toBeNull()
  })
})

describe('authenticateToken', () => {
  it('lanza [UNAUTHORIZED] si falta prefijo fg_', async () => {
    await expect(authenticateToken('xyz')).rejects.toThrow(/\[UNAUTHORIZED\]/)
    expect(findUniqueApiToken).not.toHaveBeenCalled()
  })

  it('lanza [UNAUTHORIZED] si el hash no existe en BD', async () => {
    findUniqueApiToken.mockResolvedValue(null)
    await expect(authenticateToken('fg_abcdef')).rejects.toThrow(
      /\[UNAUTHORIZED\]/,
    )
  })

  it('lanza [UNAUTHORIZED] si el token está revocado', async () => {
    const plaintext = 'fg_revokedtoken'
    findUniqueApiToken.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      scopes: ['*'],
      expiresAt: null,
      revokedAt: new Date(),
      tokenHash: sha256Hex(plaintext),
    })
    await expect(authenticateToken(plaintext)).rejects.toThrow(/revocado/)
  })

  it('lanza [UNAUTHORIZED] si el token está expirado', async () => {
    const plaintext = 'fg_expiredtoken'
    findUniqueApiToken.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      scopes: ['*'],
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      tokenHash: sha256Hex(plaintext),
    })
    await expect(authenticateToken(plaintext)).rejects.toThrow(/expirado/)
  })

  it('devuelve auth con scopes y userId si todo es válido', async () => {
    const plaintext = 'fg_validtoken1234'
    findUniqueApiToken.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      scopes: ['projects:read', 'tasks:write'],
      expiresAt: null,
      revokedAt: null,
      tokenHash: sha256Hex(plaintext),
    })
    const auth = await authenticateToken(plaintext)
    expect(auth).toEqual({
      tokenId: 't1',
      userId: 'u1',
      scopes: ['projects:read', 'tasks:write'],
      expiresAt: null,
    })
  })
})

describe('authenticateRequest', () => {
  it('lanza si falta header Authorization', async () => {
    const req = new Request('http://x.test/api/v1/projects')
    await expect(authenticateRequest(req)).rejects.toThrow(/\[UNAUTHORIZED\]/)
  })

  it('autentica con header válido', async () => {
    const plaintext = 'fg_headertoken5678'
    findUniqueApiToken.mockResolvedValue({
      id: 't9',
      userId: 'u9',
      scopes: ['projects:read'],
      expiresAt: null,
      revokedAt: null,
      tokenHash: sha256Hex(plaintext),
    })
    const req = new Request('http://x.test/api/v1/projects', {
      headers: { Authorization: `Bearer ${plaintext}` },
    })
    const auth = await authenticateRequest(req)
    expect(auth.tokenId).toBe('t9')
  })
})

describe('requireScope', () => {
  it('no lanza si el scope está cubierto', () => {
    expect(() =>
      requireScope(
        { tokenId: 't1', userId: 'u1', scopes: ['projects:write'], expiresAt: null },
        'projects:read',
      ),
    ).not.toThrow()
  })

  it('lanza [FORBIDDEN] si el scope no está cubierto', () => {
    expect(() =>
      requireScope(
        { tokenId: 't1', userId: 'u1', scopes: ['tasks:read'], expiresAt: null },
        'projects:read',
      ),
    ).toThrow(/\[FORBIDDEN\]/)
  })
})
