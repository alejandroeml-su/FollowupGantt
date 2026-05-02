import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'

/**
 * Manejo de sesión cookie + DB para el MVP de Auth (Ola P1).
 *
 * Estrategia:
 *   - La cookie `fg_session` lleva el `sessionToken` (id aleatorio) firmado
 *     con HMAC-SHA-256 usando `AUTH_SECRET`. La firma evita que un cliente
 *     pueda fabricar tokens válidos sin la clave (defensa-en-profundidad,
 *     porque el token también se valida contra la tabla `Session`).
 *   - El registro `Session` en BD permite invalidación inmediata (logout,
 *     ban, expiración) y queda compatible con NextAuth Prisma adapter
 *     cuando se migre a SSO.
 *   - Se usa `node:crypto` (no `jose`) porque no podemos instalar paquetes
 *     en este worktree. La firma HMAC es FIPS y suficiente para Edge ya
 *     que el verifySession siempre toca BD.
 *
 * Errores tipados: `[UNAUTHORIZED]`, `[INVALID_SESSION]`.
 *
 * NOTA: las funciones de cookies de Next 16 son async — `await cookies()`.
 */

const COOKIE_NAME = 'fg_session'
const COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60 // 7 días
const TOKEN_BYTES = 32

function getSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret || secret.length < 16) {
    // Fallback solo en dev para no bloquear arranque local — en producción
    // el bootstrap debe explotar. La validación dura ocurre cuando se
    // intenta firmar/verificar (ver más abajo).
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[UNAUTHORIZED] AUTH_SECRET no configurado en producción',
      )
    }
    return 'dev-only-insecure-secret-replace-in-production-please'
  }
  return secret
}

function sign(token: string): string {
  return createHmac('sha256', getSecret()).update(token).digest('base64url')
}

function buildCookieValue(sessionToken: string): string {
  return `${sessionToken}.${sign(sessionToken)}`
}

function parseCookieValue(value: string | undefined): string | null {
  if (!value) return null
  const idx = value.lastIndexOf('.')
  if (idx <= 0) return null
  const token = value.slice(0, idx)
  const provided = value.slice(idx + 1)
  const expected = sign(token)
  if (provided.length !== expected.length) return null
  // timingSafeEqual exige Buffers del mismo tamaño.
  try {
    if (
      !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
    ) {
      return null
    }
  } catch {
    return null
  }
  return token
}

export interface SessionUser {
  id: string
  email: string
  name: string
  roles: string[]
}

/**
 * Crea sesión en BD + setea cookie firmada. Llamar tras `verifyPassword`.
 * Devuelve el `sessionToken` por si se requiere para tests/E2E.
 */
export async function createSession(userId: string): Promise<string> {
  const sessionToken = randomBytes(TOKEN_BYTES).toString('base64url')
  const expires = new Date(Date.now() + COOKIE_MAX_AGE_SECONDS * 1000)

  await prisma.session.create({
    data: {
      sessionToken,
      userId,
      expires,
    },
  })

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, buildCookieValue(sessionToken), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires,
    path: '/',
  })

  return sessionToken
}

/**
 * Lee la cookie, verifica firma, busca la Session en BD y devuelve el
 * usuario con sus roles. Devuelve `null` si no hay sesión válida (sin
 * lanzar). Para enforcement, ver `requireUser()` en `get-current-user.ts`.
 */
export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(COOKIE_NAME)?.value
  const sessionToken = parseCookieValue(raw)
  if (!sessionToken) return null

  const session = await prisma.session.findUnique({
    where: { sessionToken },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          roles: { include: { role: { select: { name: true } } } },
        },
      },
    },
  })

  if (!session) return null
  if (session.expires.getTime() < Date.now()) {
    // Sesión expirada — limpia silenciosamente.
    await prisma.session.delete({ where: { sessionToken } }).catch(() => {})
    return null
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    roles: session.user.roles.map((ur) => ur.role.name),
  }
}

/**
 * Borra la cookie y elimina el registro en `Session`. Idempotente.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(COOKIE_NAME)?.value
  const sessionToken = parseCookieValue(raw)
  if (sessionToken) {
    await prisma.session.delete({ where: { sessionToken } }).catch(() => {})
  }
  cookieStore.delete(COOKIE_NAME)
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
