/**
 * Wave R5 Extended · US-Reporting-PDF — Route Handler.
 *
 * `GET /api/v2/reports/[projectId]?kind=status` →
 *   PDF binario del Status Report PMI.
 * `GET /api/v2/reports/[projectId]?kind=sprint-review&sprintId=<id>` →
 *   PDF binario del Sprint Review Report.
 *
 * Convención repo:
 *   - Errores tipados sólo dentro de server actions. En route handlers
 *     devolvemos `NextResponse.json({ error }, { status })` y reescribimos
 *     los `[CODE] ...` que vengan de la lib en JSON.
 *
 * Auth & RBAC:
 *   - Cookie de sesión via `getCurrentUser()`. Sin sesión → 401.
 *   - RBAC vía `resolveProjectVisibility` dentro de `generateProjectReport`.
 *     Si el usuario no ve el proyecto, devolvemos 403 (la audit event
 *     `access.denied` ya la registra `canViewProject` indirectamente cuando
 *     se llama desde otros paths; aquí sólo registramos `report.exported`
 *     en el path exitoso).
 *
 * Runtime: `nodejs` obligatorio — `@react-pdf/renderer` requiere Node APIs.
 * NO se puede correr en edge.
 */

import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { headers as nextHeaders } from 'next/headers'

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { recordAuditEventSafe } from '@/lib/audit/events'
import {
  generateProjectReport,
  type ProjectReportKind,
} from '@/lib/reports/generate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ───────────────────────── Helpers ─────────────────────────

function parseKind(value: string | null): ProjectReportKind | null {
  if (value === 'status' || value === 'sprint-review') return value
  return null
}

function errorCodeFrom(err: unknown): string | null {
  if (err instanceof Error) {
    const match = /^\[([A-Z_]+)\]/.exec(err.message)
    return match?.[1] ?? null
  }
  return null
}

async function extractRequestMeta(): Promise<{
  ipAddress: string | null
  userAgent: string | null
}> {
  const h = await nextHeaders()
  const fwd = h.get('x-forwarded-for')
  const ip = fwd ? fwd.split(',')[0]?.trim() ?? null : h.get('x-real-ip')
  return { ipAddress: ip ?? null, userAgent: h.get('user-agent') }
}

// ───────────────────────── Handler ─────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params

  // 1. Sesión obligatoria.
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { error: 'UNAUTHORIZED', message: 'Sesión requerida.' },
      { status: 401 },
    )
  }

  // 2. Parse query params.
  const url = new URL(request.url)
  const kind = parseKind(url.searchParams.get('kind'))
  const sprintId = url.searchParams.get('sprintId') ?? undefined
  if (!kind) {
    return NextResponse.json(
      {
        error: 'INVALID_INPUT',
        message:
          "Parámetro 'kind' inválido. Usa 'status' o 'sprint-review'.",
      },
      { status: 400 },
    )
  }
  if (kind === 'sprint-review' && !sprintId) {
    return NextResponse.json(
      {
        error: 'INVALID_INPUT',
        message:
          "El parámetro 'sprintId' es obligatorio para kind='sprint-review'.",
      },
      { status: 400 },
    )
  }

  // 3. Generación.
  try {
    const { buffer, filename } = await generateProjectReport({
      sessionUser: user,
      projectId,
      kind,
      sprintId,
    })

    // 4. Audit (mejor esfuerzo).
    const meta = await extractRequestMeta()
    void recordAuditEventSafe({
      actorId: user.id,
      action: 'report.exported',
      entityType: 'project',
      entityId: projectId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        projectId,
        kind,
        sprintId: sprintId ?? null,
      },
    })

    // 5. Respuesta PDF binaria. `Uint8Array` para compat con `Response` de
    //    Web Streams API; el buffer original de @react-pdf/renderer es
    //    Node Buffer (subclase de Uint8Array) pero envolvemos defensivo.
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    })
  } catch (err) {
    const code = errorCodeFrom(err)
    const message =
      err instanceof Error ? err.message.replace(/^\[[A-Z_]+\]\s*/, '') : 'Error desconocido.'

    if (code === 'FORBIDDEN') {
      return NextResponse.json(
        { error: 'FORBIDDEN', message },
        { status: 403 },
      )
    }
    if (code === 'NOT_FOUND') {
      return NextResponse.json(
        { error: 'NOT_FOUND', message },
        { status: 404 },
      )
    }
    if (code === 'INVALID_INPUT') {
      return NextResponse.json(
        { error: 'INVALID_INPUT', message },
        { status: 400 },
      )
    }

    console.error('[reports] generateProjectReport failed', err)
    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: 'No se pudo generar el PDF.',
      },
      { status: 500 },
    )
  }
}
