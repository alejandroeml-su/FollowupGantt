'use server'

/**
 * Wave P17-C · Self-Service Admin — Server Actions del panel `/admin/**`.
 *
 * Cubre los 5 sub-módulos del panel:
 *   1. Workspaces  · createAdminWorkspace / updateAdminWorkspace / archiveAdminWorkspace
 *   2. Gerencias   · createAdminGerencia / updateAdminGerencia / deleteAdminGerencia
 *   3. Áreas       · createAdminArea / updateAdminArea / deleteAdminArea
 *   4. Roles       · updateUserRole (asignar/cambiar rol del usuario)
 *   5. Plantillas  · createGlobalTemplate / updateGlobalTemplate /
 *                    deleteGlobalTemplate / applyGlobalTemplateToWorkspace
 *
 * Convenciones aplicadas:
 *   - Todas las acciones llaman `requireSuperAdminOrThrow()` ANTES de
 *     leer/escribir.
 *   - Errores tipados `[CODE] detalle` (códigos: INVALID_INPUT, NOT_FOUND,
 *     SLUG_DUPLICATE, FORBIDDEN, HAS_PROJECTS, INVALID_PAYLOAD,
 *     CANNOT_DEMOTE_SELF).
 *   - Audit log con `recordAuditEventSafe` después de cada mutación.
 *   - revalidatePath para `/admin/**` y vistas afectadas.
 *
 * Decisiones autónomas:
 *   D-P17C-A1: Las gerencias con proyectos activos (status != COMPLETED|
 *              CANCELLED) NO se pueden eliminar — bloqueamos con
 *              [HAS_PROJECTS] en lugar de soft-delete para minimizar el
 *              radius de cambio.
 *   D-P17C-A2: `archiveAdminWorkspace` setea `archivedAt = now()` (soft
 *              delete). NO borramos miembros ni proyectos — la auditoría
 *              y los datos asociados deben sobrevivir al archivado.
 *   D-P17C-A3: `updateUserRole` no acepta degradar al SUPER_ADMIN actual a
 *              sí mismo (CANNOT_DEMOTE_SELF) para evitar lockout. Si el
 *              caller quiere transferir el SUPER_ADMIN, primero promueve a
 *              otro y luego se degrada.
 *   D-P17C-A4: La validación del payload de plantillas usa zod con shapes
 *              específicos por kind (ver `templatePayloadSchema`). Aunque
 *              la columna es JSONB libre, fallamos rápido para evitar
 *              datos inválidos en el catálogo.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { Prisma, type GlobalTemplateKind } from '@prisma/client'

import prisma from '@/lib/prisma'
import { requireSuperAdminOrThrow } from '@/lib/auth/check-super-admin'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { ROLE_NAMES, type RoleName } from '@/lib/auth/permissions'
import { ensureDefaultPolicies } from '@/lib/retention/defaults'

// ───────────────────────── Errores tipados ─────────────────────────

export type AdminErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'SLUG_DUPLICATE'
  | 'FORBIDDEN'
  | 'HAS_PROJECTS'
  | 'INVALID_PAYLOAD'
  | 'CANNOT_DEMOTE_SELF'

function adminError(code: AdminErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Helpers de validación ─────────────────────────

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
      'Slug inválido (3-40 caracteres lowercase, dígitos, guiones, sin doble guion ni guion en bordes)',
  })

// ───────────────────────── Schemas ─────────────────────────

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema,
  description: z.string().trim().max(500).optional().nullable(),
})

const updateWorkspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).optional().nullable(),
})

const archiveWorkspaceSchema = z.object({
  id: z.string().min(1),
})

const gerenciaInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
})

const updateGerenciaSchema = gerenciaInputSchema.extend({
  id: z.string().min(1),
})

const idOnlySchema = z.object({ id: z.string().min(1) })

const areaInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  gerenciaId: z.string().min(1),
})

const updateAreaSchema = areaInputSchema.extend({
  id: z.string().min(1),
})

const ROLE_VALUES = [
  ROLE_NAMES.USER,
  ROLE_NAMES.GERENTE_AREA,
  ROLE_NAMES.GERENCIA_GENERAL,
  ROLE_NAMES.ADMIN,
  ROLE_NAMES.SUPER_ADMIN,
] as const satisfies readonly RoleName[]

const updateUserRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLE_VALUES),
})

const TEMPLATE_KINDS = [
  'PROJECT',
  'WBS',
  'DOR_DOD',
  'COMM_PLAN',
] as const satisfies readonly GlobalTemplateKind[]

/**
 * Valida la forma de `payload` por kind. JSON libre por columna, pero
 * forzamos shape mínimo para que las plantillas no se carguen rotas.
 */
function validateTemplatePayload(
  kind: GlobalTemplateKind,
  payload: unknown,
): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    adminError('INVALID_PAYLOAD', 'El payload debe ser un objeto JSON')
  }
  const obj = payload as Record<string, unknown>
  switch (kind) {
    case 'PROJECT': {
      // { name?: string, description?: string, methodology?: SCRUM|PMI|HYBRID }
      const schema = z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        methodology: z.enum(['SCRUM', 'PMI', 'HYBRID']).optional(),
      })
      const parsed = schema.safeParse(obj)
      if (!parsed.success) {
        adminError(
          'INVALID_PAYLOAD',
          'Plantilla PROJECT inválida: ' +
            parsed.error.issues.map((i) => i.message).join('; '),
        )
      }
      return parsed.data as Record<string, unknown>
    }
    case 'WBS': {
      // { tasks: [{ title, children?: [...] }] }
      const taskSchema: z.ZodType<{ title: string; children?: unknown[] }> = z
        .object({
          title: z.string().min(1),
          children: z.array(z.lazy(() => taskSchema)).optional(),
        })
      const schema = z.object({ tasks: z.array(taskSchema).min(1) })
      const parsed = schema.safeParse(obj)
      if (!parsed.success) {
        adminError(
          'INVALID_PAYLOAD',
          'Plantilla WBS inválida: ' +
            parsed.error.issues.map((i) => i.message).join('; '),
        )
      }
      return parsed.data as Record<string, unknown>
    }
    case 'DOR_DOD': {
      // { dor: string[], dod: string[] }
      const schema = z.object({
        dor: z.array(z.string().min(1)).default([]),
        dod: z.array(z.string().min(1)).default([]),
      })
      const parsed = schema.safeParse(obj)
      if (!parsed.success) {
        adminError(
          'INVALID_PAYLOAD',
          'Plantilla DOR/DOD inválida: ' +
            parsed.error.issues.map((i) => i.message).join('; '),
        )
      }
      return parsed.data as Record<string, unknown>
    }
    case 'COMM_PLAN': {
      // { stakeholders: [{ name, channel, frequency }] }
      const schema = z.object({
        stakeholders: z.array(
          z.object({
            name: z.string().min(1),
            channel: z.string().min(1),
            frequency: z.string().min(1),
          }),
        ),
      })
      const parsed = schema.safeParse(obj)
      if (!parsed.success) {
        adminError(
          'INVALID_PAYLOAD',
          'Plantilla COMM_PLAN inválida: ' +
            parsed.error.issues.map((i) => i.message).join('; '),
        )
      }
      return parsed.data as Record<string, unknown>
    }
    default:
      // Defensa: typing exhaustivo.
      return obj
  }
}

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(TEMPLATE_KINDS),
  payload: z.record(z.string(), z.unknown()),
  workspaceId: z.string().min(1).optional().nullable(),
})

const updateTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
})

const applyTemplateSchema = z.object({
  templateId: z.string().min(1),
  workspaceId: z.string().min(1),
})

// ─────────────────────────────────────────────────────────────
// 1. WORKSPACES
// ─────────────────────────────────────────────────────────────

export async function createAdminWorkspace(input: {
  name: string
  slug: string
  description?: string | null
}): Promise<{ id: string; slug: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = createWorkspaceSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { name, slug, description } = parsed.data

  try {
    const ws = await prisma.workspace.create({
      data: {
        name,
        slug,
        description: description ?? null,
        plan: 'FREE',
        ownerId: actor.id,
        members: { create: { userId: actor.id, role: 'OWNER' } },
      },
      select: { id: true, slug: true },
    })
    // R3.0-F · Siembra retention defaults (idempotente, defensivo).
    await ensureDefaultPolicies(ws.id).catch((err) => {
      console.error('[Retention] ensureDefaultPolicies failed', err)
    })
    await recordAuditEventSafe({
      action: 'workspace.created',
      entityType: 'workspace',
      entityId: ws.id,
      actorId: actor.id,
      after: { name, slug, description },
      metadata: { source: 'admin_panel' },
    })
    revalidatePath('/admin/workspaces')
    revalidatePath('/settings/workspace')
    return ws
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      adminError('SLUG_DUPLICATE', `Ya existe un workspace con slug "${slug}"`)
    }
    throw e
  }
}

export async function updateAdminWorkspace(input: {
  id: string
  name?: string
  description?: string | null
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = updateWorkspaceSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { id, name, description } = parsed.data

  const before = await prisma.workspace.findUnique({
    where: { id },
    select: { id: true, name: true, description: true },
  })
  if (!before) adminError('NOT_FOUND', `Workspace ${id} no existe`)

  const updated = await prisma.workspace.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
    },
    select: { id: true, name: true, description: true },
  })
  await recordAuditEventSafe({
    action: 'workspace.updated',
    entityType: 'workspace',
    entityId: id,
    actorId: actor.id,
    before,
    after: updated,
    metadata: { source: 'admin_panel' },
  })
  revalidatePath('/admin/workspaces')
  revalidatePath('/settings/workspace')
  return { id }
}

export async function archiveAdminWorkspace(input: {
  id: string
}): Promise<{ id: string; archivedAt: Date }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = archiveWorkspaceSchema.safeParse(input)
  if (!parsed.success) {
    adminError('INVALID_INPUT', 'workspace.id requerido')
  }
  const { id } = parsed.data

  const ws = await prisma.workspace.findUnique({
    where: { id },
    select: { id: true, name: true, archivedAt: true },
  })
  if (!ws) adminError('NOT_FOUND', `Workspace ${id} no existe`)

  const archivedAt = new Date()
  await prisma.workspace.update({
    where: { id },
    data: { archivedAt },
  })
  await recordAuditEventSafe({
    action: 'workspace.archived',
    entityType: 'workspace',
    entityId: id,
    actorId: actor.id,
    before: { archivedAt: ws.archivedAt ?? null },
    after: { archivedAt: archivedAt.toISOString() },
    metadata: { source: 'admin_panel', name: ws.name },
  })
  revalidatePath('/admin/workspaces')
  revalidatePath('/settings/workspace')
  return { id, archivedAt }
}

// ─────────────────────────────────────────────────────────────
// 2. GERENCIAS
// ─────────────────────────────────────────────────────────────

export async function createAdminGerencia(input: {
  name: string
  description?: string | null
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = gerenciaInputSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { name, description } = parsed.data

  try {
    const g = await prisma.gerencia.create({
      data: { name: name.toUpperCase(), description: description ?? null },
      select: { id: true },
    })
    await recordAuditEventSafe({
      action: 'gerencia.created',
      entityType: 'gerencia',
      entityId: g.id,
      actorId: actor.id,
      after: { name: name.toUpperCase(), description },
      metadata: { source: 'admin_panel' },
    })
    revalidatePath('/admin/gerencias')
    revalidatePath('/gerencias')
    return g
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      adminError('SLUG_DUPLICATE', `Ya existe una gerencia con nombre "${name}"`)
    }
    throw e
  }
}

export async function updateAdminGerencia(input: {
  id: string
  name: string
  description?: string | null
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = updateGerenciaSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { id, name, description } = parsed.data

  const before = await prisma.gerencia.findUnique({
    where: { id },
    select: { id: true, name: true, description: true },
  })
  if (!before) adminError('NOT_FOUND', `Gerencia ${id} no existe`)

  const updated = await prisma.gerencia.update({
    where: { id },
    data: { name: name.toUpperCase(), description: description ?? null },
    select: { id: true, name: true, description: true },
  })
  await recordAuditEventSafe({
    action: 'gerencia.updated',
    entityType: 'gerencia',
    entityId: id,
    actorId: actor.id,
    before,
    after: updated,
    metadata: { source: 'admin_panel' },
  })
  revalidatePath('/admin/gerencias')
  revalidatePath('/admin/gerencias/' + id)
  revalidatePath('/gerencias')
  return { id }
}

export async function deleteAdminGerencia(input: {
  id: string
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = idOnlySchema.safeParse(input)
  if (!parsed.success) adminError('INVALID_INPUT', 'gerencia.id requerido')
  const { id } = parsed.data

  // Bloqueo D-P17C-A1: contar proyectos activos vía area.gerenciaId.
  // ProjectStatus = PLANNING | ACTIVE | ON_HOLD | COMPLETED (no hay
  // CANCELLED en el schema actual; "activo" = NOT COMPLETED).
  const gerencia = await prisma.gerencia.findUnique({
    where: { id },
    select: { id: true, name: true },
  })
  if (!gerencia) adminError('NOT_FOUND', `Gerencia ${id} no existe`)
  const activeProjects = await prisma.project.count({
    where: {
      area: { gerenciaId: id },
      status: { not: 'COMPLETED' },
    },
  })
  if (activeProjects > 0) {
    adminError(
      'HAS_PROJECTS',
      `No se puede eliminar la gerencia "${gerencia.name}": tiene ${activeProjects} proyecto(s) activo(s)`,
    )
  }

  await prisma.gerencia.delete({ where: { id } })
  await recordAuditEventSafe({
    action: 'gerencia.deleted',
    entityType: 'gerencia',
    entityId: id,
    actorId: actor.id,
    before: { name: gerencia.name },
    metadata: { source: 'admin_panel' },
  })
  revalidatePath('/admin/gerencias')
  revalidatePath('/gerencias')
  return { id }
}

// ─────────────────────────────────────────────────────────────
// 3. ÁREAS
// ─────────────────────────────────────────────────────────────

export async function createAdminArea(input: {
  name: string
  description?: string | null
  gerenciaId: string
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = areaInputSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { name, description, gerenciaId } = parsed.data

  // Validar que la gerencia exista (Prisma lanzaría P2003 pero queremos
  // mensaje claro).
  const ger = await prisma.gerencia.findUnique({
    where: { id: gerenciaId },
    select: { id: true },
  })
  if (!ger) adminError('NOT_FOUND', `Gerencia ${gerenciaId} no existe`)

  const a = await prisma.area.create({
    data: { name, description: description ?? null, gerenciaId },
    select: { id: true },
  })
  await recordAuditEventSafe({
    action: 'area.created',
    entityType: 'area',
    entityId: a.id,
    actorId: actor.id,
    after: { name, description, gerenciaId },
    metadata: { source: 'admin_panel' },
  })
  revalidatePath('/admin/gerencias/' + gerenciaId)
  revalidatePath('/admin/gerencias')
  revalidatePath('/gerencias')
  return a
}

export async function updateAdminArea(input: {
  id: string
  name: string
  description?: string | null
  gerenciaId: string
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = updateAreaSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { id, name, description, gerenciaId } = parsed.data

  const before = await prisma.area.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, gerenciaId: true },
  })
  if (!before) adminError('NOT_FOUND', `Área ${id} no existe`)

  const updated = await prisma.area.update({
    where: { id },
    data: { name, description: description ?? null, gerenciaId },
    select: { id: true, name: true, description: true, gerenciaId: true },
  })
  await recordAuditEventSafe({
    action: 'area.updated',
    entityType: 'area',
    entityId: id,
    actorId: actor.id,
    before,
    after: updated,
    metadata: { source: 'admin_panel' },
  })
  revalidatePath('/admin/gerencias/' + gerenciaId)
  revalidatePath('/admin/gerencias')
  revalidatePath('/gerencias')
  return { id }
}

export async function deleteAdminArea(input: {
  id: string
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = idOnlySchema.safeParse(input)
  if (!parsed.success) adminError('INVALID_INPUT', 'area.id requerido')
  const { id } = parsed.data

  const area = await prisma.area.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      gerenciaId: true,
    },
  })
  if (!area) adminError('NOT_FOUND', `Área ${id} no existe`)
  const activeProjects = await prisma.project.count({
    where: { areaId: id, status: { not: 'COMPLETED' } },
  })
  if (activeProjects > 0) {
    adminError(
      'HAS_PROJECTS',
      `No se puede eliminar el área "${area.name}": tiene ${activeProjects} proyecto(s) activo(s)`,
    )
  }

  await prisma.area.delete({ where: { id } })
  await recordAuditEventSafe({
    action: 'area.deleted',
    entityType: 'area',
    entityId: id,
    actorId: actor.id,
    before: { name: area.name, gerenciaId: area.gerenciaId },
    metadata: { source: 'admin_panel' },
  })
  revalidatePath('/admin/gerencias/' + area.gerenciaId)
  revalidatePath('/admin/gerencias')
  revalidatePath('/gerencias')
  return { id }
}

// ─────────────────────────────────────────────────────────────
// 4. ROLES — asignar/cambiar rol del usuario
// ─────────────────────────────────────────────────────────────

/**
 * Cambia el rol de un usuario reemplazando su única membresía Role.
 * Wave P13 establece la jerarquía formal — para simplificar el panel,
 * cada usuario tiene exactamente UN rol activo. Si tenía múltiples
 * (legacy), borramos los anteriores y dejamos sólo el nuevo.
 *
 * Bloqueo D-P17C-A3: el caller no puede degradarse a sí mismo desde
 * SUPER_ADMIN para evitar lockout del sistema.
 */
export async function updateUserRole(input: {
  userId: string
  role: RoleName
}): Promise<{ userId: string; role: RoleName }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = updateUserRoleSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { userId, role } = parsed.data

  // Self-demotion guard: si me cambio yo mismo a rol < SUPER_ADMIN.
  if (actor.id === userId && role !== ROLE_NAMES.SUPER_ADMIN) {
    adminError(
      'CANNOT_DEMOTE_SELF',
      'No puedes degradar tu propio rol SUPER_ADMIN. Promueve a otro SUPER_ADMIN antes',
    )
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      roles: { include: { role: { select: { id: true, name: true } } } },
    },
  })
  if (!targetUser) adminError('NOT_FOUND', `Usuario ${userId} no existe`)

  const previousRoleNames = targetUser.roles.map((r) => r.role.name)

  // Resolver el Role row (upsert por nombre para tolerar instalaciones donde
  // los roles aún no están sembrados).
  const newRoleRow = await prisma.role.upsert({
    where: { name: role },
    update: {},
    create: { name: role },
    select: { id: true, name: true },
  })

  await prisma.$transaction([
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.create({
      data: { userId, roleId: newRoleRow.id },
    }),
  ])

  await recordAuditEventSafe({
    action: 'user.role_changed',
    entityType: 'user',
    entityId: userId,
    actorId: actor.id,
    before: { roles: previousRoleNames },
    after: { roles: [role] },
    metadata: { source: 'admin_panel', email: targetUser.email },
  })

  revalidatePath('/admin/roles')
  revalidatePath('/settings/users')
  return { userId, role }
}

// ─────────────────────────────────────────────────────────────
// 5. PLANTILLAS GLOBALES
// ─────────────────────────────────────────────────────────────

export async function createGlobalTemplate(input: {
  name: string
  kind: GlobalTemplateKind
  payload: Record<string, unknown>
  workspaceId?: string | null
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = createTemplateSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { name, kind, payload, workspaceId } = parsed.data
  const validatedPayload = validateTemplatePayload(kind, payload)

  if (workspaceId) {
    const ws = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    })
    if (!ws) adminError('NOT_FOUND', `Workspace ${workspaceId} no existe`)
  }

  const t = await prisma.globalTemplate.create({
    data: {
      name,
      kind,
      payload: validatedPayload as unknown as Prisma.InputJsonValue,
      workspaceId: workspaceId ?? null,
      createdById: actor.id,
    },
    select: { id: true },
  })
  await recordAuditEventSafe({
    action: 'global_template.created',
    entityType: 'global_template',
    entityId: t.id,
    actorId: actor.id,
    after: { name, kind, workspaceId: workspaceId ?? null },
    metadata: { source: 'admin_panel' },
  })
  revalidatePath('/admin/templates')
  revalidatePath('/projects/new')
  return t
}

export async function updateGlobalTemplate(input: {
  id: string
  name?: string
  payload?: Record<string, unknown>
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = updateTemplateSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { id, name, payload } = parsed.data

  const before = await prisma.globalTemplate.findUnique({
    where: { id },
    select: { id: true, name: true, kind: true, payload: true },
  })
  if (!before) adminError('NOT_FOUND', `Template ${id} no existe`)

  let validated: Record<string, unknown> | undefined
  if (payload !== undefined) {
    validated = validateTemplatePayload(before.kind, payload)
  }

  await prisma.globalTemplate.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(validated !== undefined
        ? { payload: validated as unknown as Prisma.InputJsonValue }
        : {}),
    },
  })
  await recordAuditEventSafe({
    action: 'global_template.updated',
    entityType: 'global_template',
    entityId: id,
    actorId: actor.id,
    before: { name: before.name },
    after: { name: name ?? before.name },
    metadata: { source: 'admin_panel' },
  })
  revalidatePath('/admin/templates')
  return { id }
}

export async function deleteGlobalTemplate(input: {
  id: string
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = idOnlySchema.safeParse(input)
  if (!parsed.success) adminError('INVALID_INPUT', 'template.id requerido')
  const { id } = parsed.data

  const before = await prisma.globalTemplate.findUnique({
    where: { id },
    select: { id: true, name: true, kind: true, workspaceId: true },
  })
  if (!before) adminError('NOT_FOUND', `Template ${id} no existe`)

  await prisma.globalTemplate.delete({ where: { id } })
  await recordAuditEventSafe({
    action: 'global_template.deleted',
    entityType: 'global_template',
    entityId: id,
    actorId: actor.id,
    before,
    metadata: { source: 'admin_panel' },
  })
  revalidatePath('/admin/templates')
  return { id }
}

/**
 * Clona una plantilla global (workspaceId=NULL) hacia un workspace
 * concreto. La plantilla del catálogo central queda intacta.
 */
export async function applyGlobalTemplateToWorkspace(input: {
  templateId: string
  workspaceId: string
}): Promise<{ id: string }> {
  const actor = await requireSuperAdminOrThrow()
  const parsed = applyTemplateSchema.safeParse(input)
  if (!parsed.success) {
    adminError(
      'INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const { templateId, workspaceId } = parsed.data

  const [tpl, ws] = await Promise.all([
    prisma.globalTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, name: true, kind: true, payload: true },
    }),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    }),
  ])
  if (!tpl) adminError('NOT_FOUND', `Template ${templateId} no existe`)
  if (!ws) adminError('NOT_FOUND', `Workspace ${workspaceId} no existe`)

  const cloned = await prisma.globalTemplate.create({
    data: {
      name: tpl.name,
      kind: tpl.kind,
      payload: tpl.payload as Prisma.InputJsonValue,
      workspaceId,
      createdById: actor.id,
    },
    select: { id: true },
  })
  await recordAuditEventSafe({
    action: 'global_template.applied',
    entityType: 'global_template',
    entityId: cloned.id,
    actorId: actor.id,
    after: { name: tpl.name, kind: tpl.kind, workspaceId },
    metadata: { source: 'admin_panel', sourceTemplateId: templateId },
  })
  revalidatePath('/admin/templates')
  revalidatePath('/projects/new')
  return cloned
}
