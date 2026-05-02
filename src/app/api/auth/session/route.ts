import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

/**
 * GET /api/auth/session
 *
 * Endpoint ligero para que el cliente consulte si hay sesión activa
 * (útil para componentes Client que no pueden importar server-only).
 * Devuelve `{ user: null }` cuando no hay sesión (200, no 401, para que
 * el cliente discrimine sin disparar handlers de error globales).
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ user: null })
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles,
    },
  })
}
