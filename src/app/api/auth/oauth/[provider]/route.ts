import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import {
  buildAuthorizeUrl as buildGoogleUrl,
  exchangeCodeForProfile as exchangeGoogle,
  GOOGLE_PROVIDER_ID,
  type GoogleProfile,
} from '@/lib/auth/oauth-google'
import {
  buildAuthorizeUrl as buildMicrosoftUrl,
  exchangeCodeForProfile as exchangeMicrosoft,
  MICROSOFT_PROVIDER_ID,
  type MicrosoftProfile,
} from '@/lib/auth/oauth-microsoft'
import { createSessionWithMetadata } from '@/lib/auth/sessions'

/**
 * Endpoint dual del flujo OAuth (Ola P3 · Auth completo):
 *
 *   - GET sin `code`: inicia el flujo. Genera state + PKCE, los persiste
 *     en cookies HttpOnly y redirige al provider.
 *   - GET con `code` + `state`: callback. Valida cookies, intercambia
 *     code por id_token, upserta `User` + `Account`, crea sesión y
 *     redirige a `/`.
 *
 * Usar como callback en provider:
 *     {APP_URL}/api/auth/oauth/google
 *     {APP_URL}/api/auth/oauth/microsoft
 *
 * Dispara desde la UI:
 *     <a href="/api/auth/oauth/google">Iniciar sesión con Google</a>
 *
 * Errores:
 *   - Cualquier `[OAUTH_ERROR]`/`[OAUTH_DISABLED]` redirige a
 *     `/login?error=<code>` para que la UI muestre mensaje en español.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = Promise<{ provider: string }>

const STATE_COOKIE = 'fg_oauth_state'
const VERIFIER_COOKIE = 'fg_oauth_verifier'
const STATE_TTL_SECONDS = 10 * 60 // 10 minutos

interface UnifiedProfile {
  provider: 'google' | 'microsoft'
  sub: string
  email: string
  name: string
}

function toUnified(
  provider: 'google' | 'microsoft',
  profile: GoogleProfile | MicrosoftProfile,
): UnifiedProfile {
  return {
    provider,
    sub: profile.sub,
    email: profile.email,
    name: profile.name,
  }
}

function loginRedirect(error: string): NextResponse {
  return NextResponse.redirect(
    new URL(
      `/login?error=${encodeURIComponent(error)}`,
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    ),
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { provider } = await params
  if (provider !== GOOGLE_PROVIDER_ID && provider !== MICROSOFT_PROVIDER_ID) {
    return loginRedirect('OAUTH_PROVIDER_DESCONOCIDO')
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')

  // Si el provider devolvió error, propagamos.
  if (errorParam) {
    return loginRedirect(`OAUTH_${errorParam.toUpperCase()}`)
  }

  // ── Sub-flow 1: iniciar autorización ───────────────────────────
  if (!code) {
    try {
      const built =
        provider === GOOGLE_PROVIDER_ID
          ? buildGoogleUrl()
          : buildMicrosoftUrl()
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
      console.warn('[oauth] authorize build failed:', msg)
      return loginRedirect(
        msg.includes('OAUTH_DISABLED') ? 'OAUTH_DISABLED' : 'OAUTH_ERROR',
      )
    }
  }

  // ── Sub-flow 2: callback ───────────────────────────────────────
  const cookieStore = await cookies()
  const expectedState = cookieStore.get(STATE_COOKIE)?.value
  const codeVerifier = cookieStore.get(VERIFIER_COOKIE)?.value

  // Limpiamos las cookies inmediatamente — son one-shot.
  cookieStore.delete(STATE_COOKIE)
  cookieStore.delete(VERIFIER_COOKIE)

  if (!expectedState || !codeVerifier) {
    return loginRedirect('OAUTH_STATE_MISSING')
  }
  if (stateParam !== expectedState) {
    return loginRedirect('OAUTH_STATE_MISMATCH')
  }

  let profile: UnifiedProfile
  try {
    if (provider === GOOGLE_PROVIDER_ID) {
      profile = toUnified('google', await exchangeGoogle(code, codeVerifier))
    } else {
      profile = toUnified(
        'microsoft',
        await exchangeMicrosoft(code, codeVerifier),
      )
    }
  } catch (err) {
    console.warn('[oauth] exchange failed:', (err as Error).message)
    return loginRedirect('OAUTH_EXCHANGE_FAILED')
  }

  if (!profile.email) {
    return loginRedirect('OAUTH_NO_EMAIL')
  }

  // Upsert User + Account. Si el email ya existe (login local previo),
  // lo enlazamos al provider sin pisar datos.
  const user = await prisma.user.upsert({
    where: { email: profile.email },
    update: { name: profile.name || undefined },
    create: { email: profile.email, name: profile.name || profile.email },
    select: { id: true },
  })

  await prisma.account.upsert({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.sub,
      },
    },
    update: { userId: user.id, type: 'oauth' },
    create: {
      userId: user.id,
      type: 'oauth',
      provider: profile.provider,
      providerAccountId: profile.sub,
    },
  })

  await createSessionWithMetadata(user.id)

  return NextResponse.redirect(
    new URL('/', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  )
}
