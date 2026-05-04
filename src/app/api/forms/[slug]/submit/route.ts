/**
 * Ola P5 · Equipo P5-5 — Endpoint público de submission de formularios.
 *
 * `POST /api/forms/<slug>/submit`
 *
 * No requiere auth. Acepta JSON o `application/x-www-form-urlencoded` /
 * `multipart/form-data`. Llama al server action `submitForm` que ejecuta
 * validación, anti-spam, persistencia y disparo de automatizaciones.
 *
 * Códigos HTTP:
 *   200 → { ok: true, submissionId, taskId? }
 *   400 → INVALID_INPUT, FORM_INACTIVE, HONEYPOT_TRIGGERED
 *   404 → FORM_NOT_FOUND
 *   429 → RATE_LIMITED
 *   500 → cualquier otro error inesperado
 */

import { NextResponse, type NextRequest } from 'next/server'
import { submitForm } from '@/lib/actions/forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function extractClientIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()
  return null
}

async function readPayload(req: NextRequest): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) {
    try {
      const j = await req.json()
      if (j && typeof j === 'object' && !Array.isArray(j)) {
        return j as Record<string, unknown>
      }
    } catch {
      return {}
    }
    return {}
  }
  if (
    ct.includes('application/x-www-form-urlencoded') ||
    ct.includes('multipart/form-data')
  ) {
    const fd = await req.formData()
    const out: Record<string, unknown> = {}
    fd.forEach((v, k) => {
      out[k] = typeof v === 'string' ? v : v.name
    })
    return out
  }
  return {}
}

function statusFromError(message: string): number {
  if (message.includes('[FORM_NOT_FOUND]')) return 404
  if (message.includes('[FORM_INACTIVE]')) return 400
  if (message.includes('[INVALID_INPUT]')) return 400
  if (message.includes('[HONEYPOT_TRIGGERED]')) return 400
  if (message.includes('[RATE_LIMITED]')) return 429
  return 500
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  try {
    const payload = await readPayload(req)
    const result = await submitForm({
      slug,
      payload,
      ip: extractClientIp(req),
      userAgent: req.headers.get('user-agent') ?? null,
    })
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error'
    const status = statusFromError(msg)
    return NextResponse.json({ ok: false, error: msg }, { status })
  }
}
