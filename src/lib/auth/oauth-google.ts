import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

/**
 * SSO Google · OAuth 2.0 + OIDC con PKCE (Ola P3 · Auth completo).
 *
 * Decisión técnica:
 *   - NO usamos `next-auth`: Edwin pidió implementación nativa con
 *     `crypto` + redirects manuales para auditar el flujo y reducir
 *     superficie de ataque (evitar polyfills server-only del paquete).
 *   - PKCE (RFC 7636) con `code_challenge_method=S256` — requerido por
 *     Google para clientes públicos y mitigación CSRF de tokens.
 *   - `state` aleatorio firmado fuera (en la cookie `oauth_state`) para
 *     defenderse de CSRF en el callback.
 *   - Respuesta esperada: `code` + `state` → intercambiar por
 *     `id_token` (JWT JOSE) que parseamos a mano (sin verificar firma
 *     porque viene del exchange directo en TLS — siguiendo
 *     "Authorization Code with PKCE" de Google que asume TLS).
 *
 * Errores tipados:
 *   - `[OAUTH_ERROR]` para fallos de red / parsing / state mismatch.
 *   - `[OAUTH_DISABLED]` si faltan env vars (provider no configurado).
 *
 * Variables de entorno requeridas:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   NEXT_PUBLIC_APP_URL  (usado para redirect_uri)
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPES = ['openid', 'email', 'profile'].join(' ')

export interface GoogleProfile {
  sub: string
  email: string
  email_verified: boolean
  name: string
  picture?: string
}

export interface OAuthAuthorizeUrl {
  url: string
  state: string
  codeVerifier: string
}

function getConfig(): {
  clientId: string
  clientSecret: string
  redirectUri: string
} {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  if (!clientId || !clientSecret) {
    throw new Error('[OAUTH_DISABLED] GOOGLE_CLIENT_ID/SECRET no configurado')
  }
  return {
    clientId,
    clientSecret,
    redirectUri: `${appUrl}/api/auth/oauth/google`,
  }
}

/**
 * Genera el code_verifier (43-128 chars URL-safe random) y devuelve su
 * SHA-256 base64url encoded como code_challenge (RFC 7636 §4.2).
 */
export function generatePkce(): {
  codeVerifier: string
  codeChallenge: string
} {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

/**
 * Construye la URL de autorización con PKCE + state. El caller debe
 * persistir `state` y `codeVerifier` en cookies HttpOnly antes de
 * redirigir al usuario.
 */
export function buildAuthorizeUrl(): OAuthAuthorizeUrl {
  const { clientId, redirectUri } = getConfig()
  const { codeVerifier, codeChallenge } = generatePkce()
  const state = randomBytes(16).toString('base64url')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'online',
    prompt: 'select_account',
  })

  return {
    url: `${AUTH_URL}?${params.toString()}`,
    state,
    codeVerifier,
  }
}

/**
 * Parser ligero de JWT (no verifica firma — el id_token viene del
 * exchange POST directo a Google sobre TLS). Devuelve el payload o
 * `null` si el formato es inválido.
 */
function parseIdToken(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')
    return JSON.parse(payload) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Intercambia `code` + `code_verifier` por tokens y devuelve el perfil
 * decodificado del id_token. Lanza `[OAUTH_ERROR]` ante cualquier
 * fallo (red, formato, status no-2xx).
 */
export async function exchangeCodeForProfile(
  code: string,
  codeVerifier: string,
): Promise<GoogleProfile> {
  const { clientId, clientSecret, redirectUri } = getConfig()

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })

  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (err) {
    throw new Error(
      `[OAUTH_ERROR] Fallo de red al intercambiar code: ${(err as Error).message}`,
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`[OAUTH_ERROR] token endpoint ${response.status}: ${text}`)
  }

  const json = (await response.json()) as { id_token?: string }
  if (!json.id_token) {
    throw new Error('[OAUTH_ERROR] respuesta sin id_token')
  }

  const payload = parseIdToken(json.id_token)
  if (!payload) {
    throw new Error('[OAUTH_ERROR] id_token mal formado')
  }

  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const email = typeof payload.email === 'string' ? payload.email : ''
  if (!sub || !email) {
    throw new Error('[OAUTH_ERROR] id_token sin sub/email')
  }

  return {
    sub,
    email: email.toLowerCase(),
    email_verified: Boolean(payload.email_verified),
    name: typeof payload.name === 'string' ? payload.name : email,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  }
}

export const GOOGLE_PROVIDER_ID = 'google' as const
