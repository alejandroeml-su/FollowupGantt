import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Tests del módulo de sesiones (Ola P3 · Auth completo).
 *
 * Cubre:
 *   - listActiveSessions filtra por userId + futuro `expires` y marca
 *     `isCurrent` en la sesión cuya cookie firmada coincide.
 *   - revokeSession lanza [FORBIDDEN] si la sesión es de otro user
 *     (defensa IDOR).
 *   - revokeSession idempotente cuando el id no existe.
 *   - revokeOtherSessions excluye la sesión actual.
 *   - describeUserAgent mapea OS+browser razonablemente.
 *   - extractRequestMetadata trunca UA largo + parsea XFF CSV.
 */

vi.mock('server-only', () => ({}))

const sessionFindMany = vi.fn()
const sessionFindUnique = vi.fn()
const sessionDelete = vi.fn()
const sessionDeleteMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    session: {
      findMany: (...a: unknown[]) => sessionFindMany(...a),
      findUnique: (...a: unknown[]) => sessionFindUnique(...a),
      delete: (...a: unknown[]) => sessionDelete(...a),
      deleteMany: (...a: unknown[]) => sessionDeleteMany(...a),
      create: vi.fn(),
    },
  },
}))

const requireUserMock = vi.fn()
vi.mock('@/lib/auth/get-current-user', () => ({
  requireUser: () => requireUserMock(),
}))

const cookieGet = vi.fn()
const cookieSet = vi.fn()
const cookieDelete = vi.fn()
const headerGet = vi.fn()

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (...a: unknown[]) => cookieGet(...a),
    set: (...a: unknown[]) => cookieSet(...a),
    delete: (...a: unknown[]) => cookieDelete(...a),
  }),
  headers: () => ({
    get: (...a: unknown[]) => headerGet(...a),
  }),
}))

beforeEach(() => {
  sessionFindMany.mockReset()
  sessionFindUnique.mockReset()
  sessionDelete.mockReset()
  sessionDeleteMany.mockReset()
  requireUserMock.mockReset()
  cookieGet.mockReset()
  cookieSet.mockReset()
  cookieDelete.mockReset()
  headerGet.mockReset()
  process.env.AUTH_SECRET = 'test-secret-at-least-16-chars-long'
})

// Construye una cookie firmada idéntica a la que produce session.ts.
async function signedCookie(token: string): Promise<string> {
  const { createHmac } = await import('node:crypto')
  const sig = createHmac('sha256', process.env.AUTH_SECRET!)
    .update(token)
    .digest('base64url')
  return `${token}.${sig}`
}

describe('listActiveSessions', () => {
  it('1. marca isCurrent en la sesión cuya cookie firmada coincide', async () => {
    requireUserMock.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'A',
      roles: ['SUPER_ADMIN'],
    })
    const currentToken = 'tok-current'
    cookieGet.mockReturnValue({ value: await signedCookie(currentToken) })
    sessionFindMany.mockResolvedValue([
      {
        id: 's1',
        sessionToken: currentToken,
        userAgent: 'Mozilla/5.0 (Windows) Chrome/120',
        ipAddress: '1.1.1.1',
        lastSeenAt: new Date(),
        createdAt: new Date(),
        expires: new Date(Date.now() + 86_400_000),
      },
      {
        id: 's2',
        sessionToken: 'other-tok',
        userAgent: 'Mozilla/5.0 (iPhone) Safari',
        ipAddress: '2.2.2.2',
        lastSeenAt: null,
        createdAt: new Date(),
        expires: new Date(Date.now() + 86_400_000),
      },
    ])
    const { listActiveSessions } = await import('@/lib/auth/sessions')
    const list = await listActiveSessions()
    expect(list).toHaveLength(2)
    expect(list[0]!.isCurrent).toBe(true)
    expect(list[1]!.isCurrent).toBe(false)
  })

  it('2. sin cookie, ninguna sesión es current', async () => {
    requireUserMock.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'A',
      roles: [],
    })
    cookieGet.mockReturnValue(undefined)
    sessionFindMany.mockResolvedValue([
      {
        id: 's1',
        sessionToken: 'x',
        userAgent: null,
        ipAddress: null,
        lastSeenAt: null,
        createdAt: new Date(),
        expires: new Date(Date.now() + 1_000_000),
      },
    ])
    const { listActiveSessions } = await import('@/lib/auth/sessions')
    const list = await listActiveSessions()
    expect(list[0]!.isCurrent).toBe(false)
  })
})

describe('revokeSession', () => {
  it('3. lanza [FORBIDDEN] cuando la sesión es de otro usuario', async () => {
    requireUserMock.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'A',
      roles: [],
    })
    sessionFindUnique.mockResolvedValue({ userId: 'u2' })
    const { revokeSession } = await import('@/lib/auth/sessions')
    await expect(revokeSession('s1')).rejects.toThrow(/\[FORBIDDEN\]/)
    expect(sessionDelete).not.toHaveBeenCalled()
  })

  it('4. idempotente si la sesión no existe', async () => {
    requireUserMock.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'A',
      roles: [],
    })
    sessionFindUnique.mockResolvedValue(null)
    const { revokeSession } = await import('@/lib/auth/sessions')
    await expect(revokeSession('ghost')).resolves.toBeUndefined()
    expect(sessionDelete).not.toHaveBeenCalled()
  })

  it('5. borra la sesión si pertenece al usuario', async () => {
    requireUserMock.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'A',
      roles: [],
    })
    sessionFindUnique.mockResolvedValue({ userId: 'u1' })
    sessionDelete.mockResolvedValue({})
    const { revokeSession } = await import('@/lib/auth/sessions')
    await revokeSession('s1')
    expect(sessionDelete).toHaveBeenCalledWith({ where: { id: 's1' } })
  })

  it('6. sessionId vacío lanza [INVALID_INPUT]', async () => {
    const { revokeSession } = await import('@/lib/auth/sessions')
    await expect(revokeSession('')).rejects.toThrow(/\[INVALID_INPUT\]/)
  })
})

describe('revokeOtherSessions', () => {
  it('7. excluye la sesión actual del deleteMany', async () => {
    requireUserMock.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'A',
      roles: [],
    })
    cookieGet.mockReturnValue({ value: await signedCookie('cur-tok') })
    sessionDeleteMany.mockResolvedValue({ count: 3 })
    const { revokeOtherSessions } = await import('@/lib/auth/sessions')
    const r = await revokeOtherSessions()
    expect(r).toEqual({ revoked: 3 })
    expect(sessionDeleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        NOT: { sessionToken: 'cur-tok' },
      },
    })
  })
})

describe('describeUserAgent', () => {
  it('8. detecta Chrome en Windows', async () => {
    const { describeUserAgent } = await import('@/lib/auth/sessions')
    expect(
      describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120'),
    ).toBe('Chrome en Windows')
  })

  it('9. detecta Safari en iPhone', async () => {
    const { describeUserAgent } = await import('@/lib/auth/sessions')
    expect(
      describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari/605'),
    ).toBe('Safari en iPhone')
  })

  it('10. devuelve fallback para UA nulo', async () => {
    const { describeUserAgent } = await import('@/lib/auth/sessions')
    expect(describeUserAgent(null)).toBe('Dispositivo desconocido')
  })
})

describe('extractRequestMetadata', () => {
  it('11. parsea XFF CSV (toma la primera IP) y trunca UA largo', async () => {
    const longUa = 'a'.repeat(800)
    headerGet.mockImplementation((name: string) => {
      if (name === 'user-agent') return longUa
      if (name === 'x-forwarded-for') return ' 9.9.9.9, 10.0.0.1, 10.0.0.2'
      return null
    })
    const { extractRequestMetadata } = await import('@/lib/auth/sessions')
    const meta = await extractRequestMetadata()
    expect(meta.ipAddress).toBe('9.9.9.9')
    expect(meta.userAgent).toHaveLength(512)
  })

  it('12. devuelve null cuando no hay headers', async () => {
    headerGet.mockReturnValue(null)
    const { extractRequestMetadata } = await import('@/lib/auth/sessions')
    const meta = await extractRequestMetadata()
    expect(meta).toEqual({ userAgent: null, ipAddress: null })
  })
})
