/**
 * P3-4 · Helper de seed de Workspaces para la suite E2E (P4 expansion).
 *
 * Crea (o reutiliza) un `Workspace` + `WorkspaceMember(OWNER)` y opcionalmente
 * sembramos invitaciones pendientes. Idempotente — re-runs reutilizan el
 * mismo workspaceId derivado deterministicamente del slug.
 *
 * Patrón de uso típico:
 *
 *   import { seedAuthUser } from './seed-auth'
 *   import { seedWorkspaceForUser } from './seed-workspace'
 *
 *   const user = await seedAuthUser('ws-owner@e2e.test', 'ADMIN')
 *   const ws = await seedWorkspaceForUser(user.userId, { slug: 'e2e-spec' })
 *
 * IDs del helper viven con prefijo `e2e_ws_` para que el cleanup pueda
 * filtrar selectivamente. NUNCA toca workspaces sin ese prefijo.
 */

import { createHash, randomBytes } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const E2E_WS_PREFIX = 'e2e_ws_'
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
      '[E2E_WS_NO_DB] DATABASE_URL no disponible — `seedWorkspace` requiere BD.',
    )
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
  const adapter = new PrismaPg(pool)
  cachedClient = new PrismaClient({ adapter })
  return cachedClient
}

function deterministicId(prefix: string, key: string): string {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16)
  return `${prefix}${hash}`
}

export interface SeedWorkspaceOptions {
  /** Slug URL-safe único para test. Se usa también para derivar el id estable. */
  slug: string
  /** Nombre legible. Default: `[E2E] ${slug}`. */
  name?: string
  /** Plan del workspace. Default: FREE. */
  plan?: 'FREE' | 'PRO' | 'ENTERPRISE'
}

export interface SeedWorkspaceResult {
  workspaceId: string
  slug: string
  ownerId: string
}

/**
 * Crea un Workspace con `userId` como OWNER, deterministicamente identificable
 * por el slug. Idempotente — upsertea WS y membership.
 */
export async function seedWorkspaceForUser(
  ownerId: string,
  options: SeedWorkspaceOptions,
): Promise<SeedWorkspaceResult> {
  const prisma = getClient()
  const slug = options.slug.trim().toLowerCase()
  if (!slug.match(/^[a-z0-9-]{2,}$/)) {
    throw new Error(`[E2E_WS_BAD_SLUG] slug inválido: ${slug}`)
  }
  const workspaceId = deterministicId(E2E_WS_PREFIX, `ws:${slug}`)
  const name = options.name ?? `[E2E] ${slug}`
  const plan = options.plan ?? 'FREE'

  await prisma.workspace.upsert({
    where: { id: workspaceId },
    update: { name, slug, plan, ownerId },
    create: { id: workspaceId, name, slug, plan, ownerId },
  })

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: { workspaceId, userId: ownerId },
    },
    update: { role: 'OWNER' },
    create: { workspaceId, userId: ownerId, role: 'OWNER' },
  })

  return { workspaceId, slug, ownerId }
}

/**
 * Crea una invitación pendiente para `email` con expiración por default a 7d.
 * El token devuelto es base64url 32 bytes — compatible con `acceptInvitation`.
 */
export async function seedWorkspaceInvitation(args: {
  workspaceId: string
  email: string
  invitedById?: string
  role?: 'ADMIN' | 'MEMBER'
  expiresAt?: Date
}): Promise<{ token: string; invitationId: string }> {
  const prisma = getClient()
  const token = randomBytes(24).toString('base64url')
  const expiresAt =
    args.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const created = await prisma.workspaceInvitation.create({
    data: {
      workspaceId: args.workspaceId,
      email: args.email.trim().toLowerCase(),
      role: args.role ?? 'MEMBER',
      token,
      expiresAt,
      invitedById: args.invitedById,
    },
    select: { id: true, token: true },
  })
  return { token: created.token, invitationId: created.id }
}

/**
 * Borra Workspace + memberships + invitaciones del slug indicado.
 * Idempotente; si nada existe, no falla.
 */
export async function cleanupWorkspaceSeed(slug: string): Promise<void> {
  const prisma = getClient()
  const workspaceId = deterministicId(E2E_WS_PREFIX, `ws:${slug}`)
  await prisma.workspaceInvitation
    .deleteMany({ where: { workspaceId } })
    .catch(() => {})
  await prisma.workspaceMember
    .deleteMany({ where: { workspaceId } })
    .catch(() => {})
  await prisma.workspace.deleteMany({ where: { id: workspaceId } }).catch(() => {})
}

export async function disconnectWorkspaceClient(): Promise<void> {
  if (cachedClient) {
    await cachedClient.$disconnect()
    cachedClient = null
  }
}
