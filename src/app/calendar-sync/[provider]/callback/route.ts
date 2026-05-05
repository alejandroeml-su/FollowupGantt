/**
 * Wave P8 · Equipo P8-5 — OAuth start + callback para conexión Calendar.
 *
 * Flujo dual (espejo del patrón P3-1 `/api/auth/oauth/[provider]`):
 *   - GET sin `code`: inicia el flujo. Genera state + PKCE, los persiste
 *     en cookies HttpOnly y redirige al provider con scopes de Calendar.
 *   - GET con `code` + `state`: callback. Valida state, intercambia
 *     code por (access_token, refresh_token), persiste en
 *     `CalendarConnection` y redirige a `/settings/calendar`.
 *
 * Nota: NO reusamos `/api/auth/oauth/[provider]` (P3-1) porque ese flujo
 * pide solo scopes OIDC `openid email profile` para login y NO solicita
 * `offline_access` ni Calendar.ReadWrite. Aquí necesitamos refresh_token
 * + permisos de Calendar.
 *
 * Errores se redirigen a `/settings/calendar?error=<code>`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { createHash, randomBytes } from 'node:crypto'
import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = Promise<{ provider: string }>

const STATE_COOKIE = 'fg_calsync_state'
const VERIFIER_COOKIE = 'fg_calsync_verifier'
const STATE_TTL_SECONDS = 10 * 60

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ')

const MICROSOFT_SCOPES = [
  'openid',
  'offline_access',
  'Calendars.ReadWrite',
].join(' ')

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

function settingsRedirect(error?: string): NextResponse {
  const url = error
    ? `/settings/calendar?error=${encodeURIComponent(error)}`
    : '/settings/calendar?ok=1'
  return NextResponse.redirect(new URL(url, appUrl()))
}

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')
  return { codeVerifier, codeChallenge }
}

function buildGoogleAuthorizeUrl(): {
  url: string
  state: string
  codeVerifier: string
} {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('[CALSYNC_DISABLED] GOOGLE_CLIENT_ID no configurado')
  }
  const { codeVerifier, codeChallenge } = generatePkce()
  const state = randomBytes(16).toString('base64url')
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl()}/calendar-sync/google/callback`,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline', // ← obliga refresh_token
    prompt: 'consent', // ← garantiza nuevo refresh_token
  })
  return { url: `${GOOGLE_AUTH_URL}?${params.toString()}`, state, codeVerifier }
}

function buildMicrosoftAuthorizeUrl(): {
  url: string
  state: string
  codeVerifier: string
} {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  if (!clientId) {
    throw new Error('[CALSYNC_DISABLED] MICROSOFT_CLIENT_ID no configurado')
  }
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common'
  const { codeVerifier, codeChallenge } = generatePkce()
  const state = randomBytes(16).toString('base64url')
  const authBase = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl()}/calendar-sync/microsoft/callback`,
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  })
  return { url: `${authBase}?${params.toString()}`, state, codeVerifier }
}

interface TokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}

async function exchangeGoogle(
  code: string,
  codeVerifier: string,
): Promise<TokenSet> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('[CALSYNC_DISABLED] Google OAuth no configurado')
  }
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: `${appUrl()}/calendar-sync/google/callback`,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`[CALSYNC_EXCHANGE_FAILED] ${res.status}: ${t}`)
  }
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.access_token) {
    throw new Error('[CALSYNC_EXCHANGE_FAILED] sin access_token')
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt:
      typeof json.expires_in === 'number'
        ? new Date(Date.now() + json.expires_in * 1000)
        : null,
  }
}

async function exchangeMicrosoft(
  code: string,
  codeVerifier: string,
): Promise<TokenSet> {
  const clientId = process.env.MICROSOFT_CLIENT_ID
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('[CALSYNC_DISABLED] Microsoft OAuth no configurado')
  }
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common'
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: `${appUrl()}/calendar-sync/microsoft/callback`,
    grant_type: 'authorization_code',
    code_verifier: codeVerifier,
    scope: MICROSOFT_SCOPES,
  })
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`[CALSYNC_EXCHANGE_FAILED] ${res.status}: ${t}`)
  }
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.access_token) {
    throw new Error('[CALSYNC_EXCHANGE_FAILED] sin access_token')
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt:
      typeof json.expires_in === 'number'
        ? new Date(Date.now() + json.expires_in * 1000)
        : null,
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { provider } = await params
  if (provider !== 'google' && provider !== 'microsoft') {
    return settingsRedirect('CALSYNC_PROVIDER_DESCONOCIDO')
  }

  // Auth: el usuario debe estar logueado para conectar su calendario.
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', appUrl()))
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  if (errorParam) {
    return settingsRedirect(`CALSYNC_${errorParam.toUpperCase()}`)
  }

  // ── Sub-flow 1: iniciar autorización ───────────────────────────
  if (!code) {
    try {
      const built =
        provider === 'google'
          ? buildGoogleAuthorizeUrl()
          : buildMicrosoftAuthorizeUrl()
      const cookieStore = await cookies()
      const cookieOpts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        maxAge: STATE_TTL_SECONDS,
      }
      cookieStore.set(STATE_COOKIE, built.state, cookieOpts)
      cookieStore.set(VERIFIER_COOKIE, built.codeVerifier, cookieOpts)
      return NextResponse.redirect(built.url)
    } catch (err) {
      const msg = (err as Error).message
      console.warn('[calendar-sync] authorize build failed:', msg)
      return settingsRedirect(
        msg.includes('CALSYNC_DISABLED') ? 'CALSYNC_DISABLED' : 'CALSYNC_ERROR',
      )
    }
  }

  // ── Sub-flow 2: callback ───────────────────────────────────────
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(STATE_COOKIE)?.value
  const codeVerifier = cookieStore.get(VERIFIER_COOKIE)?.value

  cookieStore.delete(STATE_COOKIE)
  cookieStore.delete(VERIFIER_COOKIE)

  if (!expectedState || !codeVerifier) {
    return settingsRedirect('CALSYNC_STATE_MISSING')
  }
  if (stateParam !== expectedState) {
    return settingsRedirect('CALSYNC_STATE_MISMATCH')
  }

  let tokens: TokenSet
  try {
    tokens =
      provider === 'google'
        ? await exchangeGoogle(code, codeVerifier)
        : await exchangeMicrosoft(code, codeVerifier)
  } catch (err) {
    console.warn('[calendar-sync] exchange failed:', (err as Error).message)
    return settingsRedirect('CALSYNC_EXCHANGE_FAILED')
  }

  // Persistir / actualizar la conexión del usuario.
  const providerEnum = provider === 'google' ? 'GOOGLE' : 'MICROSOFT'
  await prisma.calendarConnection.upsert({
    where: {
      userId_provider: { userId: user.id, provider: providerEnum },
    },
    create: {
      userId: user.id,
      provider: providerEnum,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      syncEnabled: true,
    },
    update: {
      accessToken: tokens.accessToken,
      // Solo sobreescribimos refreshToken si vino uno nuevo. Google a
      // veces no manda refresh_token en re-auth si ya hay consent activo.
      refreshToken: tokens.refreshToken ?? undefined,
      expiresAt: tokens.expiresAt,
      syncEnabled: true,
    },
  })

  return settingsRedirect()
}
