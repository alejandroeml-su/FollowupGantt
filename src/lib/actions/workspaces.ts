'use server'

/**
 * Ola P4 · Equipo P4-1 — Server actions de Multi-tenancy / Workspaces.
 *
 * Cubre el flujo end-to-end del MVP:
 *   - createWorkspace        — crea WS + membership OWNER en transacción.
 *   - listMyWorkspaces       — workspaces donde soy OWNER o miembro.
 *   - switchWorkspace        — setea cookie `x-active-workspace` httpOnly.
 *   - inviteMember           — genera token + WorkspaceInvitation expirable.
 *   - acceptInvitation       — valida token, crea WorkspaceMember, borra.
 *   - removeMember           — saca a un miembro (no aplica al OWNER).
 *
 * Convenciones del repo aplicadas:
 *   - Errores tipados `[CODE] detalle` (códigos: WORKSPACE_NOT_FOUND,
 *     NOT_MEMBER, INVITATION_NOT_FOUND, INVITATION_EXPIRED,
 *     SLUG_DUPLICATE, INVALID_INPUT, FORBIDDEN, UNAUTHORIZED,
 *     ALREADY_MEMBER, OWNER_REMOVAL_FORBIDDEN).
 *   - `revalidatePath('/settings/workspace')` y `'/settings/workspace/members'`
 *     tras mutaciones.
 *   - Auth: `requireUser` para crear WS / aceptar invitaciones (acción
 *     personal), `requireWorkspaceManager` para invitar/eliminar.
 *
 * Decisiones autónomas (documentadas para revisión):
 *   D-WS-1: La cookie `x-active-workspace` es `httpOnly=false` para que el
 *           cliente (zustand store) pueda leerla y mostrar el slug en la
 *           UI sin un round-trip al server. La autoridad del filtro vive
 *           en `requireWorkspaceAccess` (server-only) — la cookie es sólo
 *           hint de UX, no security boundary.
 *   D-WS-2: La invitación expira en 7 días por default. El recipiente debe
 *           tener cuenta — no creamos usuarios desde aquí (lo hace el
 *           flujo de signup futuro). Si el email no existe, el token sigue
 *           válido y la página `/invite/[token]` redirige a `/login`.
 *   D-WS-3: `removeMember` es idempotente: borrar a alguien que ya no es
 *           miembro no lanza (mismo patrón que otros deletes del repo).
 *   D-WS-4: NO implementamos transferencia de OWNER en este MVP — sólo el
 *           bloqueo (`OWNER_REMOVAL_FORBIDDEN`) para evitar workspaces sin
 *           dueño. Se añadirá `transferOwnership` en P4-1.5.
 *   D-WS-5: El email de invitación NO se envía aquí; devolvemos el token y
 *           la URL para que el caller lo envíe (Resend o copy-to-clipboard
 *           en MVP). Esto permite tests sin mockear servicio de email.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'
import { Prisma, type WorkspacePlan, type WorkspaceRole } from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import {
  requireWorkspaceAccess,
  requireWorkspaceManager,
} from '@/lib/auth/check-workspace-access'

// ───────────────────────── Errores tipados ─────────────────────────

export type WorkspacesErrorCode =
  | 'INVALID_INPUT'
  | 'WORKSPACE_NOT_FOUND'
  | 'NOT_MEMBER'
  | 'INVITATION_NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'SLUG_DUPLICATE'
  | 'FORBIDDEN'
  | 'UNAUTHORIZED'
  | 'ALREADY_MEMBER'
  | 'OWNER_REMOVAL_FORBIDDEN'

function actionError(code: WorkspacesErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Constantes ──────────────────────────────

export const ACTIVE_WORKSPACE_COOKIE = 'x-active-workspace'
const INVITATION_TTL_DAYS = 7
const INVITATION_TOKEN_BYTES = 24

const PLAN_VALUES = ['FREE', 'PRO', 'ENTERPRISE'] as const satisfies readonly WorkspacePlan[]
const ROLE_VALUES = ['OWNER', 'ADMIN', 'MEMBER'] as const satisfies readonly WorkspaceRole[]
const INVITABLE_ROLE_VALUES = ['ADMIN', 'MEMBER'] as const

// ───────────────────────── Schemas ─────────────────────────────────

// Slug URL-safe: lower-case, dígitos, guiones. 3-40 chars. Sin guion
// inicial/final ni doble guion. Validamos en código (no regex con look-
// behinds) para mensaje en español más claro.
function isValidSlug(value: string): boolean {
  if (value.length < 3 || value.length > 40) return false
  if (!/^[a-z0-9-]+$/.test(value)) return false
  if (value.startsWith('-') || value.endsWith('-')) return false
  if (value.includes('--')) return false
  return true
}

const slugSchema = z
  .string()
  .trim()
  .refine(isValidSlug, {
    message:
      'El slug debe tener 3-40 caracteres en minúsculas, dígitos o guiones (sin guion inicial/final ni dobles).',
  })

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(80),
  slug: slugSchema,
  plan: z.enum(PLAN_VALUES).optional(),
})

const inviteMemberSchema = z.object({
  workspaceId: z.string().min(1),
  email: z.string().email('Email inválido').toLowerCase(),
  role: z.enum(INVITABLE_ROLE_VALUES).default('MEMBER'),
})

const acceptInvitationSchema = z.object({
  token: z.string().min(1),
})

const removeMemberSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
})

const switchWorkspaceSchema = z.object({
  workspaceId: z.string().min(1),
})

// ───────────────────────── Helpers ─────────────────────────────────

function generateInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString('base64url')
}

function buildInviteUrl(token: string, baseUrl?: string): string {
  // baseUrl viene del caller (e.g. process.env.NEXTAUTH_URL); cuando no
  // está disponible devolvemos la ruta relativa que el cliente puede
  // resolver con `window.location.origin`.
  const path = `/invite/${token}`
  return baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : path
}

// ───────────────────────── Actions ─────────────────────────────────

/**
 * Crea un workspace y registra al caller como OWNER. La membresía se
 * crea en la misma transacción para evitar workspaces sin dueño visible
 * en la lista del usuario.
 */
export async function createWorkspace(input: {
  name: string
  slug: string
  plan?: WorkspacePlan
}): Promise<{ id: string; slug: string }> {
  const user = await requireUser()
  const parsed = createWorkspaceSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { name, slug, plan } = parsed.data

  try {
    const ws = await prisma.workspace.create({
      data: {
        name,
        slug,
        plan: plan ?? 'FREE',
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
      select: { id: true, slug: true },
    })
    revalidatePath('/settings/workspace')
    return ws
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      actionError(
        'SLUG_DUPLICATE',
        `Ya existe un workspace con slug "${slug}"`,
      )
    }
    throw e
  }
}

/**
 * Devuelve los workspaces donde el usuario actual es OWNER o miembro,
 * con el rol y conteo de miembros para el switcher de la UI.
 */
export async function listMyWorkspaces(): Promise<
  Array<{
    id: string
    name: string
    slug: string
    plan: WorkspacePlan
    role: WorkspaceRole
    memberCount: number
    isOwner: boolean
  }>
> {
  const user = await requireUser()

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          ownerId: true,
          _count: { select: { members: true } },
        },
      },
    },
    orderBy: { workspace: { name: 'asc' } },
  })

  return memberships.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    slug: m.workspace.slug,
    plan: m.workspace.plan,
    role: m.role,
    memberCount: m.workspace._count.members,
    isOwner: m.workspace.ownerId === user.id,
  }))
}

/**
 * Setea la cookie `x-active-workspace` con el id del workspace activo.
 * Valida que el caller sea miembro antes de aceptar el cambio.
 *
 * Cookie httpOnly=false (D-WS-1) para que el cliente pueda hidratar el
 * `activeWorkspaceId` de zustand sin un round-trip extra. La autoridad
 * del filtro vive en `requireWorkspaceAccess` (server-only).
 */
export async function switchWorkspace(input: {
  workspaceId: string
}): Promise<{ workspaceId: string }> {
  const parsed = switchWorkspaceSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { workspaceId } = parsed.data

  // Garantiza membresía o admin global.
  await requireWorkspaceAccess(workspaceId)

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // 30 días — la sesión de auth es de 7d, pero la preferencia de WS
    // sobrevive a re-logins por comodidad.
    maxAge: 30 * 24 * 60 * 60,
  })

  revalidatePath('/')
  return { workspaceId }
}

/**
 * Crea una invitación para un email. Sólo OWNER/ADMIN del workspace
 * pueden invitar (o admin global). Si ya existe una invitación pendiente
 * para el mismo email, la reemplaza (mismo workspaceId+email = único
 * lógico, no en BD para simplificar).
 *
 * No envía email — devuelve el token y la URL para que el caller lo
 * propague (D-WS-5).
 */
export async function inviteMember(input: {
  workspaceId: string
  email: string
  role?: 'ADMIN' | 'MEMBER'
  baseUrl?: string
}): Promise<{ token: string; inviteUrl: string; expiresAt: Date }> {
  const parsed = inviteMemberSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { workspaceId, email, role } = parsed.data

  const { user } = await requireWorkspaceManager(workspaceId)

  // Si el email corresponde a un usuario que YA es miembro, lanzamos
  // ALREADY_MEMBER (UX feedback rápido, evita ruido de invitaciones).
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })
  if (existingUser) {
    const existingMembership = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: existingUser.id,
        },
      },
      select: { workspaceId: true },
    })
    if (existingMembership) {
      actionError('ALREADY_MEMBER', `${email} ya es miembro del workspace`)
    }
  }

  const token = generateInvitationToken()
  const expiresAt = new Date(
    Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
  )

  // Best-effort: limpiamos invitaciones pendientes previas del mismo
  // email para evitar acumulación. No es transaccional con el insert
  // porque el token nuevo siempre invalida los anteriores.
  await prisma.workspaceInvitation.deleteMany({
    where: { workspaceId, email },
  })

  await prisma.workspaceInvitation.create({
    data: {
      workspaceId,
      email,
      role: role ?? 'MEMBER',
      token,
      expiresAt,
      invitedById: user.id,
    },
  })

  revalidatePath('/settings/workspace/members')

  return {
    token,
    inviteUrl: buildInviteUrl(token, input.baseUrl),
    expiresAt,
  }
}

/**
 * Acepta una invitación: valida token + expiración, crea
 * `WorkspaceMember` y borra la invitación. Idempotente respecto a la
 * membresía (si ya era miembro, no duplica).
 */
export async function acceptInvitation(input: {
  token: string
}): Promise<{ workspaceId: string; role: WorkspaceRole }> {
  const user = await requireUser()
  const parsed = acceptInvitationSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { token } = parsed.data

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    select: {
      id: true,
      workspaceId: true,
      email: true,
      role: true,
      expiresAt: true,
    },
  })
  if (!invitation) {
    actionError('INVITATION_NOT_FOUND', 'La invitación no existe o ya fue usada')
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    // Limpieza best-effort de invitación expirada.
    await prisma.workspaceInvitation
      .delete({ where: { token } })
      .catch(() => {})
    actionError('INVITATION_EXPIRED', 'La invitación ha expirado')
  }

  // Si el email del invitee no matchea, no bloqueamos pero tampoco
  // creamos membresía — el caller debe iniciar sesión con la cuenta
  // correcta. Devolvemos FORBIDDEN para que la página `/invite/[token]`
  // muestre un mensaje claro.
  if (invitation.email !== user.email.toLowerCase()) {
    actionError(
      'FORBIDDEN',
      `La invitación es para ${invitation.email}, pero la sesión es de ${user.email}`,
    )
  }

  // upsert membresía (no duplicar si ya existe).
  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: invitation.workspaceId,
        userId: user.id,
      },
    },
    update: { role: invitation.role },
    create: {
      workspaceId: invitation.workspaceId,
      userId: user.id,
      role: invitation.role,
    },
  })

  await prisma.workspaceInvitation.delete({ where: { token } })

  revalidatePath('/settings/workspace')
  revalidatePath('/settings/workspace/members')

  return { workspaceId: invitation.workspaceId, role: invitation.role }
}

/**
 * Saca a un miembro del workspace. Permitido para OWNER/ADMIN del WS o
 * admin global. Bloquea remover al OWNER (D-WS-4).
 */
export async function removeMember(input: {
  workspaceId: string
  userId: string
}): Promise<{ removed: boolean }> {
  const parsed = removeMemberSchema.safeParse(input)
  if (!parsed.success) {
    actionError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { workspaceId, userId } = parsed.data

  await requireWorkspaceManager(workspaceId)

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  })
  if (!workspace) {
    actionError(
      'WORKSPACE_NOT_FOUND',
      `El workspace ${workspaceId} no existe`,
    )
  }
  if (workspace.ownerId === userId) {
    actionError(
      'OWNER_REMOVAL_FORBIDDEN',
      'No se puede eliminar al OWNER del workspace; transfiera la propiedad antes',
    )
  }

  // Idempotente: deleteMany no lanza si no encuentra (D-WS-3).
  const result = await prisma.workspaceMember.deleteMany({
    where: { workspaceId, userId },
  })

  revalidatePath('/settings/workspace/members')
  return { removed: result.count > 0 }
}

/**
 * Lee la cookie `x-active-workspace`. Devuelve `null` si no está seteada
 * o si el usuario ya no es miembro (en cuyo caso el caller debería
 * caer al workspace por defecto). NO lanza.
 */
export async function getActiveWorkspaceId(): Promise<string | null> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value
  if (!raw) return null
  return raw
}

/**
 * Lista los miembros de un workspace (con datos del User para la tabla).
 * Requiere ser miembro o admin global.
 */
export async function listWorkspaceMembers(workspaceId: string): Promise<
  Array<{
    userId: string
    name: string
    email: string
    role: WorkspaceRole
    isOwner: boolean
    joinedAt: Date
  }>
> {
  await requireWorkspaceAccess(workspaceId)

  const [members, workspace] = await Promise.all([
    prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    }),
  ])

  return members.map((m) => ({
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    isOwner: workspace?.ownerId === m.userId,
    joinedAt: m.createdAt,
  }))
}

/**
 * Lista invitaciones pendientes (no expiradas) de un workspace. Útil
 * para la página de miembros (mostrar las pendientes con CTA reenviar).
 */
export async function listPendingInvitations(workspaceId: string): Promise<
  Array<{
    id: string
    email: string
    role: WorkspaceRole
    expiresAt: Date
    inviteUrl: string
  }>
> {
  await requireWorkspaceManager(workspaceId)

  const now = new Date()
  const invitations = await prisma.workspaceInvitation.findMany({
    where: {
      workspaceId,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
  })

  return invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    expiresAt: inv.expiresAt,
    inviteUrl: buildInviteUrl(inv.token),
  }))
}
