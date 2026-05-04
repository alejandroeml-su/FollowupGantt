import 'server-only'
import { cookies, headers } from 'next/headers'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import { SESSION_COOKIE_NAME } from '@/lib/auth/session'

/**
 * Session management UI helpers (Ola P3 · Auth completo).
 *
 * Responsabilidades:
 *   - Listar sesiones activas del usuario (para la página
 *     `/settings/sessions`).
 *   - Revocar una sesión por id (botón "Cerrar sesión en este
 *     dispositivo"), validando ownership.
 *   - Helper `extractRequestMetadata()` para que el callback de OAuth
 *     y el loginAction registren userAgent + ipAddress al crear la
 *     `Session`.
 *
 * Nota sobre la cookie firmada: el token guardado en `Session.sessionToken`
 * es el id aleatorio sin la firma HMAC. La cookie del cliente lleva
 * `<token>.<hmac>`. Para identificar la sesión "actual" en la UI
 * verificamos la firma con el secret y comparamos por id.
 */

const TOKEN_BYTES = 32

export interface ActiveSession {
  id: string
  userAgent: string | null
  ipAddress: string | null
  lastSeenAt: Date | null
  createdAt: Date
  expiresAt: Date
  isCurrent: boolean
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[UNAUTHORIZED] AUTH_SECRET no configurado')
    }
    return 'dev-only-insecure-secret-replace-in-production-please'
  }
  return secret
}

function sign(token: string): string {
  return createHmac('sha256', getSecret()).update(token).digest('base64url')
}

function parseCookieValue(value: string | undefined): string | null {
  if (!value) return null
  const idx = value.lastIndexOf('.')
  if (idx <= 0) return null
  const token = value.slice(0, idx)
  const provided = value.slice(idx + 1)
  const expected = sign(token)
  if (provided.length !== expected.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return null
    }
  } catch {
    return null
  }
  return token
}

/**
 * Devuelve la lista de sesiones activas del usuario logueado, ordenadas
 * por `lastSeenAt desc`. Marca `isCurrent` en la sesión que coincide con
 * la cookie del request actual.
 */
export async function listActiveSessions(): Promise<ActiveSession[]> {
  const user = await requireUser()

  const cookieStore = await cookies()
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const currentToken = parseCookieValue(raw)

  const sessions = await prisma.session.findMany({
    where: {
      userId: user.id,
      expires: { gt: new Date() },
    },
    select: {
      id: true,
      sessionToken: true,
      userAgent: true,
      ipAddress: true,
      lastSeenAt: true,
      createdAt: true,
      expires: true,
    },
    orderBy: [{ lastSeenAt: 'desc' }, { createdAt: 'desc' }],
  })

  return sessions.map((s) => ({
    id: s.id,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    lastSeenAt: s.lastSeenAt,
    createdAt: s.createdAt,
    expiresAt: s.expires,
    isCurrent: currentToken !== null && s.sessionToken === currentToken,
  }))
}

/**
 * Revoca una sesión por id. Valida que pertenezca al usuario logueado
 * (defensa contra IDOR). Idempotente: borrar una sesión inexistente no
 * lanza.
 *
 * Lanza `[FORBIDDEN]` si el id pertenece a otro usuario.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  if (!sessionId) {
    throw new Error('[INVALID_INPUT] sessionId requerido')
  }
  const user = await requireUser()

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { userId: true },
  })

  if (!session) return // Ya borrada — idempotente.
  if (session.userId !== user.id) {
    throw new Error('[FORBIDDEN] sesión pertenece a otro usuario')
  }

  await prisma.session.delete({ where: { id: sessionId } })
}

/**
 * Revoca TODAS las sesiones del usuario logueado excepto la actual.
 * Útil tras "Cerrar sesión en otros dispositivos" o cambio de contraseña.
 */
export async function revokeOtherSessions(): Promise<{ revoked: number }> {
  const user = await requireUser()

  const cookieStore = await cookies()
  const raw = cookieStore.get(SESSION_COOKIE_NAME)?.value
  const currentToken = parseCookieValue(raw)

  const result = await prisma.session.deleteMany({
    where: {
      userId: user.id,
      ...(currentToken ? { NOT: { sessionToken: currentToken } } : {}),
    },
  })
  return { revoked: result.count }
}

/**
 * Extrae user-agent + IP del request actual (Next 16 `headers()`).
 * Llamar desde el callback OAuth y el loginAction para enriquecer la
 * tabla `Session` al crearla.
 *
 * Notas:
 *   - `x-forwarded-for` puede venir como CSV — tomamos la primera
 *     (la del cliente, las siguientes son proxies).
 *   - Trunca user-agent a 512 chars (defensa contra UA inflado).
 */
export async function extractRequestMetadata(): Promise<{
  userAgent: string | null
  ipAddress: string | null
}> {
  const h = await headers()
  const ua = h.get('user-agent')
  const xff = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? ''
  const ip = xff.split(',')[0]?.trim() || null
  return {
    userAgent: ua ? ua.slice(0, 512) : null,
    ipAddress: ip,
  }
}

/**
 * Crea una `Session` capturando metadata del request actual. Variante
 * "fat" de `createSession()` (que vive en `session.ts` y no depende de
 * Next headers). Usar desde server actions / route handlers donde
 * `headers()` está disponible.
 *
 * Devuelve el `sessionToken` y setea la cookie firmada.
 */
export async function createSessionWithMetadata(
  userId: string,
): Promise<string> {
  const sessionToken = randomBytes(TOKEN_BYTES).toString('base64url')
  const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
  const expires = new Date(Date.now() + COOKIE_MAX_AGE_MS)
  const meta = await extractRequestMetadata()

  await prisma.session.create({
    data: {
      sessionToken,
      userId,
      expires,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      lastSeenAt: new Date(),
    },
  })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, `${sessionToken}.${sign(sessionToken)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires,
    path: '/',
  })

  return sessionToken
}

/**
 * Heurística simple para mostrar el "device" en la UI a partir del
 * user-agent. No pretende ser perfecta — para UX agradable, no
 * análisis forense.
 */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Dispositivo desconocido'
  const lower = ua.toLowerCase()
  let os = 'Otro'
  if (lower.includes('windows')) os = 'Windows'
  else if (lower.includes('mac os') || lower.includes('macintosh')) os = 'macOS'
  else if (lower.includes('iphone')) os = 'iPhone'
  else if (lower.includes('ipad')) os = 'iPad'
  else if (lower.includes('android')) os = 'Android'
  else if (lower.includes('linux')) os = 'Linux'

  let browser = 'Navegador'
  if (lower.includes('edg/')) browser = 'Edge'
  else if (lower.includes('chrome/') && !lower.includes('chromium'))
    browser = 'Chrome'
  else if (lower.includes('firefox/')) browser = 'Firefox'
  else if (lower.includes('safari/') && !lower.includes('chrome'))
    browser = 'Safari'

  return `${browser} en ${os}`
}
