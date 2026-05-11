import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { buildAuthnRequest } from '@/lib/sso/saml'

/**
 * R3.0 · Fase 2 · SSO/SAML — Inicio de flujo SAML.
 *
 * GET /api/auth/sso/[providerId]/login
 *
 *   1. Resuelve el provider por id, valida que `enabled = true`.
 *   2. Genera AuthnRequest SAML, persiste el `requestId` en cookie
 *      HttpOnly para validarlo en el callback (ACS).
 *   3. Redirige al `ssoUrl` del IdP.
 *
 * Errores se redirigen a `/login?error=<CODE>` para que la UI muestre
 * mensaje legible.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = Promise<{ providerId: string }>

const REQUEST_ID_COOKIE = 'fg_sso_request_id'
const PROVIDER_COOKIE = 'fg_sso_provider_id'
const COOKIE_TTL_SECONDS = 10 * 60

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

function loginRedirect(error: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(error)}`, appUrl()),
  )
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { providerId } = await params
  if (!providerId) return loginRedirect('SSO_BAD_PROVIDER')

  const provider = await prisma.ssoProvider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      ssoUrl: true,
      enabled: true,
      workspaceId: true,
    },
  })
  if (!provider) return loginRedirect('SSO_PROVIDER_NOT_FOUND')
  if (!provider.enabled) return loginRedirect('SSO_PROVIDER_DISABLED')

  const spEntityId = `${appUrl()}/api/auth/sso/${provider.id}`
  const acsUrl = `${appUrl()}/api/auth/sso/${provider.id}/acs`

  const { requestId, url } = buildAuthnRequest({
    ssoUrl: provider.ssoUrl,
    spEntityId,
    acsUrl,
  })

  const cookieStore = await cookies()
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: COOKIE_TTL_SECONDS,
  }
  cookieStore.set(REQUEST_ID_COOKIE, requestId, cookieOpts)
  cookieStore.set(PROVIDER_COOKIE, provider.id, cookieOpts)

  return NextResponse.redirect(url)
}
