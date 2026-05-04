import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

/**
 * SSO Microsoft (Azure AD / Entra ID) · OAuth 2.0 + OIDC con PKCE.
 *
 * Same shape que `oauth-google.ts` para que el callback handler pueda
 * tratarlos polimórficamente. Diferencias:
 *   - Tenant configurable (`MICROSOFT_TENANT_ID`, default `common` para
 *     multi-tenant + cuentas personales).
 *   - Endpoint v2.0 (mejor compatibilidad OIDC + scopes granulares).
 *   - Scope `User.Read` para perfil + `email` y `profile`.
 *
 * Errores tipados: `[OAUTH_ERROR]`, `[OAUTH_DISABLED]`.
 *
 * Variables de entorno requeridas:
 *   MICROSOFT_CLIENT_ID
 *   MICROSOFT_CLIENT_SECRET
 *   MICROSOFT_TENANT_ID  (opcional, default 'common')
 *   NEXT_PUBLIC_APP_URL  (usado para redirect_uri)
 */

function getEndpoints(tenant: string): { auth: string; token: string } {
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`
  return { auth: `${base}/authorize`, token: `${base}/token` }
}

const SCOPES = ['openid', 'email', 'profile', 'User.Read'].join(' ')

export interface MicrosoftProfile {
  sub: string
  email: string
  name: string
  tenantId?: string
}

export interface OAuthAuthorizeUrl {
  url: string
  state: string
  codeVerifier: string
}

function getConfig(): {
  clientId: string
  clientSecret: string
  tenant: string
  redirectUri: string
} {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  if (!clientId || !clientSecret) {
    throw new Error(
      '[OAUTH_DISABLED] MICROSOFT_CLIENT_ID/SECRET no configurado',
    )
  }
  return {
    clientId,
    clientSecret,
    tenant,
    redirectUri: `${appUrl}/api/auth/oauth/microsoft`,
  }
}

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

export function buildAuthorizeUrl(): OAuthAuthorizeUrl {
  const { clientId, tenant, redirectUri } = getConfig()
  const { auth } = getEndpoints(tenant)
  const { codeVerifier, codeChallenge } = generatePkce()
  const state = randomBytes(16).toString('base64url')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  })

  return {
    url: `${auth}?${params.toString()}`,
    state,
    codeVerifier,
  }
}

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

export async function exchangeCodeForProfile(
  code: string,
  codeVerifier: string,
): Promise<MicrosoftProfile> {
  const { clientId, clientSecret, tenant, redirectUri } = getConfig()
  const { token } = getEndpoints(tenant)

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
    scope: SCOPES,
  })

  let response: Response
  try {
    response = await fetch(token, {
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

  // Microsoft puede mandar `email` o `preferred_username` (UPN).
  const sub =
    typeof payload.oid === 'string'
      ? payload.oid
      : typeof payload.sub === 'string'
        ? payload.sub
        : ''
  const email =
    typeof payload.email === 'string'
      ? payload.email
      : typeof payload.preferred_username === 'string'
        ? payload.preferred_username
        : ''
  if (!sub || !email) {
    throw new Error('[OAUTH_ERROR] id_token sin sub/email')
  }

  return {
    sub,
    email: email.toLowerCase(),
    name: typeof payload.name === 'string' ? payload.name : email,
    tenantId: typeof payload.tid === 'string' ? payload.tid : undefined,
  }
}

export const MICROSOFT_PROVIDER_ID = 'microsoft' as const
