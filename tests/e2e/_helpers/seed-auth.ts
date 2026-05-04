/**
 * P3-4 · Helper de seed de autenticación para la suite E2E.
 *
 * Crea (o reutiliza) un `User` + `Role` + `UserRole` + `Session` en la BD
 * compartida con prefijo `e2e_` y devuelve el `sessionToken` ya firmado
 * con HMAC + el valor de cookie listo para inyectar en el `context` de
 * Playwright.
 *
 * Patrón de uso:
 *
 *   import { test } from '@playwright/test'
 *   import { seedAuthUser, applyAuthCookie } from './_helpers/seed-auth'
 *
 *   test.beforeEach(async ({ context }) => {
 *     const { cookieValue } = await seedAuthUser('e2e@test.local', 'ADMIN')
 *     await applyAuthCookie(context, cookieValue)
 *   })
 *
 * Diseño:
 *  - Idempotente: re-runs reutilizan el mismo userId/sessionToken gracias
 *    a `upsert` y a un token deterministicamente derivado del email
 *    (HMAC sobre `auth-seed:${email}`). Esto hace que los tests sean
 *    repetibles sin contaminar la BD.
 *  - El token sigue el shape que `parseCookieValue` espera:
 *    `${sessionToken}.${HMAC(sessionToken)}`. Reusa `node:crypto`
 *    directamente para no importar `'server-only'` desde el helper.
 *  - Auto-carga `.env`/`.env.local` igual que `seed.ts` para funcionar
 *    desde dev-server local sin env vars exportadas.
 *  - Permite múltiples roles separados por coma (`'ADMIN,SUPER_ADMIN'`)
 *    para escenarios que exigen permisos compuestos.
 *
 * RELACIÓN CON `E2E_BYPASS_AUTH`:
 *  - Si la suite exporta `E2E_BYPASS_AUTH=true`, el proxy permite cargar
 *    rutas protegidas SIN cookie. Eso solo evita el redirect a /login
 *    — las páginas que llaman `getCurrentUser()` seguirán sin usuario.
 *  - Para tests funcionales reales, usar este helper + cookie. El
 *    bypass es para smoke tests de UI que no consultan al usuario.
 */

import { createHmac, createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import type { BrowserContext } from '@playwright/test'

const E2E_AUTH_PREFIX = 'e2e_auth_'
const SESSION_COOKIE_NAME = 'fg_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 días (alineado con auth/session.ts)

let cachedClient: PrismaClient | null = null

function ensureEnvLoaded(): void {
  if (process.env.DATABASE_URL) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require('dotenv') as typeof import('dotenv')
  dotenv.config({ path: '.env.local' })
  if (!process.env.DATABASE_URL) dotenv.config({ path: '.env' })
}

function getClient(): PrismaClient {
  if (cachedClient) return cachedClient
  ensureEnvLoaded()
  if (!process.env.DATABASE_URL) {
    throw new Error(
      '[E2E_AUTH_NO_DB] DATABASE_URL no disponible — `seedAuthUser` requiere BD. ' +
        'Verifica .env / .env.local o export DATABASE_URL antes de invocar Playwright.',
    )
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const adapter = new PrismaPg(pool)
  cachedClient = new PrismaClient({ adapter })
  return cachedClient
}

function getAuthSecret(): string {
  // Misma lógica que `src/lib/auth/session.ts`: en dev cae en un secret
  // estático (suficiente para que la verificación HMAC del proxy y de
  // `getSession()` matchee con la cookie que inyectemos).
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[E2E_AUTH_NO_SECRET] AUTH_SECRET requerido en producción',
      )
    }
    return 'dev-only-insecure-secret-replace-in-production-please'
  }
  return secret
}

function signToken(token: string): string {
  return createHmac('sha256', getAuthSecret()).update(token).digest('base64url')
}

function deterministicTokenFor(email: string): string {
  // base64url(sha256('auth-seed:' + email)). 32 bytes → 43 chars sin
  // padding. Determinístico → re-runs reutilizan el mismo token y el
  // upsert sobre `Session` no rompe la unique constraint.
  return createHash('sha256')
    .update(`auth-seed:${email}`)
    .digest('base64url')
}

function deterministicId(prefix: string, email: string): string {
  // ID estable y único por email. Mantiene el prefijo `e2e_auth_` para
  // que el cleanup pueda filtrar selectivamente.
  const hash = createHash('sha256').update(email).digest('hex').slice(0, 16)
  return `${prefix}${hash}`
}

/** Roles aceptados; alineados con los seedeados por `prisma/seed.ts`. */
export type AuthRole = 'AGENTE' | 'ADMIN' | 'SUPER_ADMIN'

export interface SeedAuthUserResult {
  /** UUID del User insertado (estable por email). */
  userId: string
  /** Email tal como se guardó. */
  email: string
  /** Token random firmable (sin firma). */
  sessionToken: string
  /** Valor completo de cookie (`token.signature`) listo para inyectar. */
  cookieValue: string
  /** Nombre canónico de la cookie. */
  cookieName: string
  /** Roles aplicados (string-name array). */
  roles: AuthRole[]
}

/**
 * Crea/upsertea un `User` + `Role(s)` + `UserRole` + `Session` para tests E2E.
 * El cleanup explícito no es estrictamente necesario (`upsert` mantiene
 * idempotencia entre runs) — si quieres limpiar al final del suite usa
 * `cleanupAuthSeed(email)`.
 *
 * @param email único (también usado para derivar IDs deterministas).
 * @param role rol único o lista separada por coma. Default: `AGENTE`.
 */
export async function seedAuthUser(
  email: string,
  role: AuthRole | `${AuthRole},${AuthRole}` | string = 'AGENTE',
): Promise<SeedAuthUserResult> {
  if (!email || !email.includes('@')) {
    throw new Error(`[E2E_AUTH_BAD_EMAIL] email inválido: ${email}`)
  }

  const prisma = getClient()
  const userId = deterministicId(E2E_AUTH_PREFIX + 'u_', email)
  const sessionToken = deterministicTokenFor(email)
  const expires = new Date(Date.now() + SESSION_TTL_MS)

  const roleNames = role
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean) as AuthRole[]
  if (roleNames.length === 0) roleNames.push('AGENTE')

  // 1) User idempotente.
  await prisma.user.upsert({
    where: { id: userId },
    update: { email, name: `E2E ${email.split('@')[0]}` },
    create: {
      id: userId,
      email,
      name: `E2E ${email.split('@')[0]}`,
    },
  })

  // 2) Roles + UserRole. `Role.name` es unique → upsert por name. El id
  //    se deriva determinísticamente para no chocar con seeds previos.
  for (const name of roleNames) {
    const roleId = deterministicId(E2E_AUTH_PREFIX + 'r_', `role:${name}`)
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { id: roleId, name },
    })
    const dbRole = await prisma.role.findUnique({
      where: { name },
      select: { id: true },
    })
    if (!dbRole) continue
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: dbRole.id } },
      update: {},
      create: { userId, roleId: dbRole.id },
    })
  }

  // 3) Session: borra previa expirada/no-coincidente y upsertea nueva.
  await prisma.session.upsert({
    where: { sessionToken },
    update: { expires, userId },
    create: { sessionToken, userId, expires },
  })

  const signature = signToken(sessionToken)
  const cookieValue = `${sessionToken}.${signature}`

  return {
    userId,
    email,
    sessionToken,
    cookieValue,
    cookieName: SESSION_COOKIE_NAME,
    roles: roleNames,
  }
}

/**
 * Inyecta la cookie de sesión en el `context` de Playwright. Aplica a
 * todos los `page` derivados del context.
 */
export async function applyAuthCookie(
  context: BrowserContext,
  cookieValue: string,
  baseUrl: string = process.env.BASE_URL ?? 'http://localhost:3000',
): Promise<void> {
  const url = new URL(baseUrl)
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: cookieValue,
      domain: url.hostname,
      path: '/',
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax',
      // Playwright requiere expires en segundos epoch.
      expires: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
    },
  ])
}

/**
 * Borra Session/UserRole del usuario sembrado. NO borra el `User` ni los
 * `Role` — son compartidos entre runs. Llamar en `afterAll` si el test
 * suite es sensible a sesiones huérfanas; para la mayoría de specs el
 * upsert idempotente es suficiente.
 */
export async function cleanupAuthSeed(email: string): Promise<void> {
  const prisma = getClient()
  const userId = deterministicId(E2E_AUTH_PREFIX + 'u_', email)
  const sessionToken = deterministicTokenFor(email)
  await prisma.session.deleteMany({ where: { sessionToken } }).catch(() => {})
  await prisma.userRole.deleteMany({ where: { userId } }).catch(() => {})
}

/**
 * Cierra el pool Prisma usado por este helper. Llamar en `globalTeardown`
 * o `afterAll` del último spec.
 */
export async function disconnectAuthClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.$disconnect()
    cachedClient = null
  }
}
