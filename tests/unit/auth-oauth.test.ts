import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * Tests para los providers OAuth Google + Microsoft (Ola P3).
 *
 * Cubre:
 *   - generatePkce produce verifier+challenge URL-safe.
 *   - buildAuthorizeUrl incluye state, code_challenge, scopes y
 *     redirect_uri esperado.
 *   - exchangeCodeForProfile parsea id_token JWT correctamente.
 *   - exchangeCodeForProfile lanza [OAUTH_ERROR] en HTTP 4xx.
 *   - getConfig lanza [OAUTH_DISABLED] sin client_id.
 */

vi.mock('server-only', () => ({}))

beforeEach(() => {
  vi.resetModules()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
  process.env.GOOGLE_CLIENT_ID = 'gid'
  process.env.GOOGLE_CLIENT_SECRET = 'gsec'
  process.env.MICROSOFT_CLIENT_ID = 'mid'
  process.env.MICROSOFT_CLIENT_SECRET = 'msec'
  process.env.MICROSOFT_TENANT_ID = 'common'
})

afterEach(() => {
  vi.restoreAllMocks()
})

function buildJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' }),
  ).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  // Firma fake — no se verifica en el módulo (TLS confianza).
  return `${header}.${body}.fakesig`
}

describe('oauth-google', () => {
  it('1. generatePkce devuelve verifier+challenge base64url', async () => {
    const { generatePkce } = await import('@/lib/auth/oauth-google')
    const { codeVerifier, codeChallenge } = generatePkce()
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(codeVerifier.length).toBeGreaterThan(40)
  })

  it('2. buildAuthorizeUrl incluye PKCE + state + scopes', async () => {
    const { buildAuthorizeUrl } = await import('@/lib/auth/oauth-google')
    const { url, state, codeVerifier } = buildAuthorizeUrl()
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(u.searchParams.get('client_id')).toBe('gid')
    expect(u.searchParams.get('redirect_uri')).toBe(
      'https://app.test/api/auth/oauth/google',
    )
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('scope')).toContain('openid')
    expect(u.searchParams.get('state')).toBe(state)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(codeVerifier).toBeTruthy()
  })

  it('3. exchangeCodeForProfile devuelve perfil del id_token', async () => {
    const idToken = buildJwt({
      sub: 'g-sub-1',
      email: 'EDWIN@avante.com',
      email_verified: true,
      name: 'Edwin',
      picture: 'https://pic',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id_token: idToken }),
      }),
    )
    const { exchangeCodeForProfile } = await import('@/lib/auth/oauth-google')
    const profile = await exchangeCodeForProfile('CODE', 'VERIFIER')
    expect(profile).toEqual({
      sub: 'g-sub-1',
      email: 'edwin@avante.com',
      email_verified: true,
      name: 'Edwin',
      picture: 'https://pic',
    })
  })

  it('4. exchangeCodeForProfile lanza [OAUTH_ERROR] si HTTP no-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'invalid_grant',
        json: async () => ({}),
      }),
    )
    const { exchangeCodeForProfile } = await import('@/lib/auth/oauth-google')
    await expect(
      exchangeCodeForProfile('bad', 'verif'),
    ).rejects.toThrow(/\[OAUTH_ERROR\]/)
  })

  it('5. buildAuthorizeUrl lanza [OAUTH_DISABLED] sin client_id', async () => {
    delete process.env.GOOGLE_CLIENT_ID
    const { buildAuthorizeUrl } = await import('@/lib/auth/oauth-google')
    expect(() => buildAuthorizeUrl()).toThrow(/\[OAUTH_DISABLED\]/)
  })

  it('6. exchangeCodeForProfile rechaza id_token sin email', async () => {
    const idToken = buildJwt({ sub: 'x' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id_token: idToken }),
      }),
    )
    const { exchangeCodeForProfile } = await import('@/lib/auth/oauth-google')
    await expect(
      exchangeCodeForProfile('c', 'v'),
    ).rejects.toThrow(/\[OAUTH_ERROR\]/)
  })
})

describe('oauth-microsoft', () => {
  it('7. buildAuthorizeUrl usa endpoint v2 con tenant', async () => {
    process.env.MICROSOFT_TENANT_ID = 'my-tenant'
    const { buildAuthorizeUrl } = await import('@/lib/auth/oauth-microsoft')
    const { url } = buildAuthorizeUrl()
    expect(url).toMatch(
      /^https:\/\/login\.microsoftonline\.com\/my-tenant\/oauth2\/v2\.0\/authorize/,
    )
  })

  it('8. exchangeCodeForProfile mapea oid+preferred_username', async () => {
    const idToken = buildJwt({
      oid: 'ms-oid-1',
      preferred_username: 'Edwin@avante.com',
      name: 'Edwin Martinez',
      tid: 'tenant-x',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id_token: idToken }),
      }),
    )
    const { exchangeCodeForProfile } = await import(
      '@/lib/auth/oauth-microsoft'
    )
    const profile = await exchangeCodeForProfile('CODE', 'VERIFIER')
    expect(profile).toEqual({
      sub: 'ms-oid-1',
      email: 'edwin@avante.com',
      name: 'Edwin Martinez',
      tenantId: 'tenant-x',
    })
  })

  it('9. exchangeCodeForProfile lanza si la respuesta no trae id_token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      }),
    )
    const { exchangeCodeForProfile } = await import(
      '@/lib/auth/oauth-microsoft'
    )
    await expect(
      exchangeCodeForProfile('c', 'v'),
    ).rejects.toThrow(/\[OAUTH_ERROR\]/)
  })
})
