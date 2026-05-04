/**
 * Wave P6 · Equipo A4 — Endpoint de prueba para Web Push.
 *
 * `GET /api/push/test?userId=...&title=...&body=...&url=...`
 *
 * Dispara un push real al usuario indicado (o al default si no se pasa
 * `userId`). Útil para Edwin probar end-to-end desde DevTools sin tener
 * que disparar una mention/asignación real.
 *
 * NOTA: Sin auth real este endpoint queda abierto. En producción debe
 * protegerse — ver TODO en JSDoc cuando se implemente la sesión real.
 */

import { NextRequest, NextResponse } from 'next/server'
import { sendPushToUser } from '@/lib/web-push/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function resolveDefaultUserId(): Promise<string | null> {
  const edwin = await prisma.user.findFirst({
    where: { name: 'Edwin Martinez' },
    select: { id: true },
  })
  if (edwin) return edwin.id
  const fallback = await prisma.user.findFirst({
    orderBy: { name: 'asc' },
    select: { id: true },
  })
  return fallback?.id ?? null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const userId =
    searchParams.get('userId') ?? (await resolveDefaultUserId())

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: 'No se pudo resolver userId' },
      { status: 400 },
    )
  }

  const title = searchParams.get('title') ?? 'FollowupGantt — Test Push'
  const body =
    searchParams.get('body') ??
    'Este es un push de prueba enviado desde /api/push/test.'
  const url = searchParams.get('url') ?? '/notifications'

  try {
    const result = await sendPushToUser(userId, { title, body, url })
    return NextResponse.json({ ok: true, userId, result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500 },
    )
  }
}
