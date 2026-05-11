import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import {
  parseSamlResponse,
  verifyXmlSignature,
} from '@/lib/sso/saml'
import { mapAssertionToProfile, parseAttributeMap } from '@/lib/sso/mapping'
import { createOrLinkUser } from '@/lib/sso/provisioning'
import { createSessionWithMetadata } from '@/lib/auth/sessions'
import { recordAuditEventSafe } from '@/lib/audit/events'
import type { SsoAttributeMap } from '@/lib/sso/types'

/**
 * R3.0 · Fase 2 · SSO/SAML — Assertion Consumer Service (ACS).
 *
 * POST /api/auth/sso/[providerId]/acs
 *   Recibe el SAML Response del IdP (form-encoded `SAMLResponse`).
 *
 * Pipeline de seguridad:
 *   1. Decode base64 → XML.
 *   2. Verifica firma RSA-SHA256 con `x509Cert` del provider. RECHAZA
 *      cualquier respuesta sin firma o con algoritmo débil.
 *   3. Valida Issuer == provider.entityId.
 *   4. Parsea Assertion, valida NotOnOrAfter.
 *   5. Mapea attributes según `attributeMap` (email obligatorio).
 *   6. JIT provisioning: crea/enlaza User + SsoUserLink + WorkspaceMember.
 *   7. createSessionWithMetadata → cookie firmada.
 *   8. Audit `sso.login.success` / `sso.login.failed`.
 *   9. Redirect a `/`.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = Promise<{ providerId: string }>

const REQUEST_ID_COOKIE = 'fg_sso_request_id'
const PROVIDER_COOKIE = 'fg_sso_provider_id'

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

function loginRedirect(error: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent(error)}`, appUrl()),
  )
}

function clearSsoCookies(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  cookieStore.delete(REQUEST_ID_COOKIE)
  cookieStore.delete(PROVIDER_COOKIE)
}

async function logFailure(input: {
  providerId: string | null
  reason: string
  detail?: string
}) {
  await recordAuditEventSafe({
    action: 'sso.login.failed',
    entityType: 'sso_provider',
    entityId: input.providerId,
    metadata: {
      reason: input.reason,
      detail: input.detail ?? null,
    },
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Params },
): Promise<NextResponse> {
  const { providerId } = await params
  const cookieStore = await cookies()
  const cookieProviderId = cookieStore.get(PROVIDER_COOKIE)?.value ?? null
  clearSsoCookies(cookieStore)

  if (!providerId) {
    await logFailure({ providerId: null, reason: 'BAD_PROVIDER' })
    return loginRedirect('SSO_BAD_PROVIDER')
  }
  if (cookieProviderId && cookieProviderId !== providerId) {
    await logFailure({ providerId, reason: 'PROVIDER_MISMATCH' })
    return loginRedirect('SSO_PROVIDER_MISMATCH')
  }

  // Provider
  const provider = await prisma.ssoProvider.findUnique({
    where: { id: providerId },
    select: {
      id: true,
      workspaceId: true,
      entityId: true,
      x509Cert: true,
      attributeMap: true,
      enabled: true,
    },
  })
  if (!provider) {
    await logFailure({ providerId, reason: 'PROVIDER_NOT_FOUND' })
    return loginRedirect('SSO_PROVIDER_NOT_FOUND')
  }
  if (!provider.enabled) {
    await logFailure({ providerId, reason: 'PROVIDER_DISABLED' })
    return loginRedirect('SSO_PROVIDER_DISABLED')
  }

  // SAMLResponse del form-encoded body.
  let samlResponseRaw: string | null = null
  try {
    const form = await request.formData()
    const v = form.get('SAMLResponse')
    if (typeof v === 'string') samlResponseRaw = v
  } catch {
    samlResponseRaw = null
  }
  if (!samlResponseRaw) {
    await logFailure({ providerId, reason: 'MISSING_SAML_RESPONSE' })
    return loginRedirect('SSO_MISSING_RESPONSE')
  }

  let xml: string
  try {
    xml = Buffer.from(samlResponseRaw, 'base64').toString('utf8')
  } catch {
    await logFailure({ providerId, reason: 'INVALID_BASE64' })
    return loginRedirect('SSO_INVALID_RESPONSE')
  }

  // Verificación de firma — OBLIGATORIA.
  const sigOk = verifyXmlSignature({ xml, x509Cert: provider.x509Cert })
  if (!sigOk) {
    await logFailure({ providerId, reason: 'INVALID_SIGNATURE' })
    return loginRedirect('SSO_INVALID_SIGNATURE')
  }

  // Parseo del Assertion.
  let assertion
  try {
    assertion = parseSamlResponse(xml)
  } catch (err) {
    const msg = (err as Error).message ?? 'unknown'
    await logFailure({
      providerId,
      reason: 'PARSE_FAILED',
      detail: msg,
    })
    return loginRedirect('SSO_INVALID_RESPONSE')
  }

  // Issuer match.
  if (assertion.issuer !== provider.entityId) {
    await logFailure({
      providerId,
      reason: 'ISSUER_MISMATCH',
      detail: `expected ${provider.entityId} got ${assertion.issuer}`,
    })
    return loginRedirect('SSO_ISSUER_MISMATCH')
  }

  // Mapping.
  let attributeMap: SsoAttributeMap
  try {
    attributeMap = parseAttributeMap(provider.attributeMap)
  } catch (err) {
    await logFailure({
      providerId,
      reason: 'BAD_ATTRIBUTE_MAP',
      detail: (err as Error).message,
    })
    return loginRedirect('SSO_CONFIG_ERROR')
  }

  let profile
  try {
    profile = mapAssertionToProfile({ assertion, attributeMap })
  } catch (err) {
    await logFailure({
      providerId,
      reason: 'MAP_FAILED',
      detail: (err as Error).message,
    })
    return loginRedirect('SSO_MISSING_EMAIL')
  }

  // JIT.
  let userId: string
  try {
    const result = await createOrLinkUser({
      workspaceId: provider.workspaceId,
      providerId: provider.id,
      profile,
    })
    userId = result.userId
  } catch (err) {
    await logFailure({
      providerId,
      reason: 'JIT_FAILED',
      detail: (err as Error).message,
    })
    return loginRedirect('SSO_JIT_FAILED')
  }

  await createSessionWithMetadata(userId)

  await recordAuditEventSafe({
    action: 'sso.login.success',
    entityType: 'sso_provider',
    entityId: provider.id,
    actorId: userId,
    metadata: {
      email: profile.email,
      workspaceId: provider.workspaceId,
    },
  })

  return NextResponse.redirect(new URL('/', appUrl()))
}
