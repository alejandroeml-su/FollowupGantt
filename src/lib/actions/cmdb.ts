'use server'

/**
 * Wave R5 · US-9.3 — CMDB simplificado · Server actions.
 *
 * Convenciones del repo:
 *   - `'use server'` purity: solo exports async.
 *   - Errores tipados `[CODE] mensaje`.
 *   - Validación zod por entrada.
 *   - `revalidatePath` de las vistas afectadas.
 *   - Auditoría best-effort vía `recordAuditEventSafe`.
 *
 * Scope:
 *   - Configuration Items (CIs) son workspace-scoped, NO project-scoped.
 *     La infraestructura suele compartirse entre proyectos.
 *   - `searchCIs` y todas las queries filtran por `workspaceId` de la
 *     sesión activa. Sólo SUPER_ADMIN/ADMIN pueden saltar el filtro
 *     (implícito: ven todos los workspaces).
 *   - `attributes` es Record<string, string|number|boolean> — sin
 *     anidamiento para mantener la búsqueda simple.
 *   - Código `CI-XXX` se auto-genera al crear, único por workspace.
 *   - Soft-delete via `retiredAt`. `deleteCI` solo si no hay relaciones
 *     ni tickets vinculados.
 *   - CIRelation no permite ciclos directos (A→B y B→A con mismo `kind`).
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import {
  Prisma,
  type CIType,
  type CIStatus,
  type CICriticality,
  type CIRelationKind,
  type CILinkRole,
  type CIChangeStatus,
} from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { withMetrics } from '@/lib/observability/metrics'
import { hasAdminRole } from '@/lib/auth/permissions'

// ───────────────────────── Errores tipados ─────────────────────────

export type CmdbErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'WORKSPACE_REQUIRED'
  | 'CYCLE_DETECTED'
  | 'HAS_DEPENDENCIES'

function actionError(code: CmdbErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Enums y schemas ─────────────────────────

const CI_TYPES = [
  'SERVICE',
  'APPLICATION',
  'SERVER',
  'DATABASE',
  'NETWORK_DEVICE',
  'ENDPOINT',
  'DOCUMENT',
  'BUSINESS_PROCESS',
  'CONTRACT',
  'OTHER',
] as const satisfies readonly CIType[]

const CI_STATUSES = [
  'PLANNED',
  'ACTIVE',
  'MAINTENANCE',
  'RETIRED',
  'INCIDENT',
] as const satisfies readonly CIStatus[]

const CI_CRITICALITIES = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'CRITICAL',
] as const satisfies readonly CICriticality[]

const CI_RELATION_KINDS = [
  'DEPENDS_ON',
  'RUNS_ON',
  'USES',
  'CONTAINS',
  'RELATED_TO',
] as const satisfies readonly CIRelationKind[]

const CI_LINK_ROLES = [
  'AFFECTED',
  'CAUSE',
  'AFFECTED_DOWNSTREAM',
  'INFORMATIONAL',
] as const satisfies readonly CILinkRole[]

/**
 * Atributos custom: Record<string, string|number|boolean>. NO se permite
 * anidamiento. Se valida en runtime con zod para tolerar payloads JSON
 * arbitrarios del cliente.
 */
const attributesSchema = z
  .record(z.string().min(1).max(64), z.union([z.string().max(500), z.number(), z.boolean()]))
  .nullable()
  .optional()

const createCISchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(CI_TYPES).optional(),
  status: z.enum(CI_STATUSES).optional(),
  criticality: z.enum(CI_CRITICALITIES).optional(),
  ownerId: z.string().min(1).optional().nullable(),
  environment: z.string().trim().max(50).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  attributes: attributesSchema,
})

export type CreateCIInput = z.input<typeof createCISchema>

const updateCISchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
  type: z.enum(CI_TYPES).optional(),
  status: z.enum(CI_STATUSES).optional(),
  criticality: z.enum(CI_CRITICALITIES).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  environment: z.string().trim().max(50).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  attributes: attributesSchema,
})

export type UpdateCIInput = z.input<typeof updateCISchema>

const searchCIsSchema = z.object({
  query: z.string().trim().max(200).optional(),
  type: z.enum(CI_TYPES).optional(),
  status: z.enum(CI_STATUSES).optional(),
  criticality: z.enum(CI_CRITICALITIES).optional(),
  environment: z.string().trim().max(50).optional(),
  includeRetired: z.boolean().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
})

export type SearchCIsInput = z.input<typeof searchCIsSchema>

const addRelationSchema = z.object({
  fromCIId: z.string().min(1),
  toCIId: z.string().min(1),
  kind: z.enum(CI_RELATION_KINDS),
  notes: z.string().trim().max(500).optional().nullable(),
})

export type AddCIRelationInput = z.input<typeof addRelationSchema>

const linkTaskSchema = z.object({
  taskId: z.string().min(1),
  ciId: z.string().min(1),
  role: z.enum(CI_LINK_ROLES).optional(),
})

export type LinkTaskToCIInput = z.input<typeof linkTaskSchema>

// ───────────────────────── Helpers ─────────────────────────

/**
 * Resuelve el workspaceId del request: usa el de la sesión. Lanza
 * `[WORKSPACE_REQUIRED]` si el usuario no tiene workspace activo
 * (caso edge: SUPER_ADMIN sin WS seleccionado en /admin).
 *
 * Para CRUD el workspace siempre debe estar set. Para search devolvemos
 * el id si lo hay, o null para los SUPER_ADMIN sin WS (ven todo).
 */
async function requireUserWorkspace(): Promise<{
  userId: string
  workspaceId: string
}> {
  const user = await requireUser()
  const wsId = (user as { workspaceId?: string | null }).workspaceId ?? null
  if (!wsId) {
    actionError('WORKSPACE_REQUIRED', 'Workspace activo requerido para CMDB')
  }
  return { userId: user.id, workspaceId: wsId }
}

/**
 * Calcula el siguiente código `CI-XXX` para un workspace. Lock-light:
 * dos creaciones concurrentes pueden chocar contra el UNIQUE — el caller
 * reintenta una vez al detectar `P2002` (manejado en `createCI`).
 */
async function nextCICode(workspaceId: string): Promise<string> {
  const last = await prisma.configurationItem.findFirst({
    where: { workspaceId, code: { startsWith: 'CI-' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  })
  let n = 1
  if (last?.code) {
    const parsed = parseInt(last.code.replace('CI-', ''), 10)
    if (Number.isFinite(parsed)) n = parsed + 1
  }
  return `CI-${String(n).padStart(3, '0')}`
}

function revalidateCmdbRoutes(ciId?: string): void {
  revalidatePath('/cmdb')
  if (ciId) revalidatePath(`/cmdb/${ciId}`)
}

function jsonOrNull(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value as unknown as Prisma.InputJsonValue
}

// ───────────────────────── CRUD CI ─────────────────────────

export async function createCI(
  input: CreateCIInput,
): Promise<{ id: string; code: string }> {
  return withMetrics('action.cmdb.createCI', async () => {
    const parsed = createCISchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const data = parsed.data
    const { userId, workspaceId } = await requireUserWorkspace()

    // Reintento simple ante colisión del UNIQUE (workspaceId, code) cuando
    // dos creaciones concurrentes calculan el mismo CI-XXX. Una sola
    // recomputación es suficiente; si vuelve a chocar dejamos que la
    // excepción suba.
    let attempt = 0
    while (true) {
      const code = await nextCICode(workspaceId)
      try {
        const created = await prisma.configurationItem.create({
          data: {
            workspaceId,
            code,
            name: data.name,
            type: data.type ?? 'OTHER',
            status: data.status ?? 'ACTIVE',
            criticality: data.criticality ?? 'MEDIUM',
            ownerId: data.ownerId ?? null,
            environment: data.environment ?? null,
            description: data.description ?? null,
            attributes: jsonOrNull(
              data.attributes
                ? (data.attributes as Record<string, unknown>)
                : data.attributes,
            ),
            createdById: userId,
          },
          select: { id: true, code: true },
        })

        await recordAuditEventSafe({
          action: 'ci.created',
          entityType: 'configuration_item',
          entityId: created.id,
          actorId: userId,
          after: {
            workspaceId,
            code: created.code,
            name: data.name,
            type: data.type ?? 'OTHER',
            criticality: data.criticality ?? 'MEDIUM',
          },
          metadata: { workspaceId },
        })

        revalidateCmdbRoutes()
        return created
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          attempt < 1
        ) {
          attempt += 1
          continue
        }
        throw err
      }
    }
  })
}

export async function updateCI(input: UpdateCIInput): Promise<void> {
  return withMetrics('action.cmdb.updateCI', async () => {
    const parsed = updateCISchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const p = parsed.data
    const user = await requireUser()

    const current = await prisma.configurationItem.findUnique({
      where: { id: p.id },
      select: {
        id: true,
        workspaceId: true,
        name: true,
        status: true,
        criticality: true,
        type: true,
      },
    })
    if (!current) actionError('NOT_FOUND', `CI ${p.id} no existe`)

    const data: Prisma.ConfigurationItemUpdateInput = {}
    if (p.name !== undefined) data.name = p.name
    if (p.type !== undefined) data.type = p.type
    if (p.status !== undefined) data.status = p.status
    if (p.criticality !== undefined) data.criticality = p.criticality
    if (p.environment !== undefined) data.environment = p.environment
    if (p.description !== undefined) data.description = p.description
    if (p.ownerId !== undefined) {
      data.owner = p.ownerId
        ? { connect: { id: p.ownerId } }
        : { disconnect: true }
    }
    if (p.attributes !== undefined) {
      data.attributes = jsonOrNull(
        p.attributes ? (p.attributes as Record<string, unknown>) : p.attributes,
      )
    }

    await prisma.configurationItem.update({ where: { id: p.id }, data })

    await recordAuditEventSafe({
      action: 'ci.updated',
      entityType: 'configuration_item',
      entityId: p.id,
      actorId: user.id,
      before: {
        name: current.name,
        status: current.status,
        criticality: current.criticality,
        type: current.type,
      },
      after: {
        name: p.name ?? current.name,
        status: p.status ?? current.status,
        criticality: p.criticality ?? current.criticality,
        type: p.type ?? current.type,
      },
      metadata: { workspaceId: current.workspaceId },
    })

    revalidateCmdbRoutes(p.id)
  })
}

/**
 * Soft-delete: marca como retirado (status=RETIRED, retiredAt=now). NO
 * remueve relaciones ni links — preservamos histórico para investigación
 * forense.
 */
export async function retireCI(input: { id: string }): Promise<void> {
  return withMetrics('action.cmdb.retireCI', async () => {
    const user = await requireUser()
    const ci = await prisma.configurationItem.findUnique({
      where: { id: input.id },
      select: { id: true, workspaceId: true, status: true, retiredAt: true },
    })
    if (!ci) actionError('NOT_FOUND', `CI ${input.id} no existe`)
    if (ci.retiredAt) {
      // Idempotente: ya está retirado.
      return
    }

    await prisma.configurationItem.update({
      where: { id: ci.id },
      data: { status: 'RETIRED', retiredAt: new Date() },
    })

    await recordAuditEventSafe({
      action: 'ci.retired',
      entityType: 'configuration_item',
      entityId: ci.id,
      actorId: user.id,
      before: { status: ci.status },
      after: { status: 'RETIRED' },
      metadata: { workspaceId: ci.workspaceId },
    })

    revalidateCmdbRoutes(ci.id)
  })
}

/**
 * Hard-delete: solo permitido si el CI NO tiene relaciones (in/out) ni
 * tickets vinculados. La UI debe ofrecer "Retirar" como primera opción y
 * dejar Delete para limpieza administrativa.
 */
export async function deleteCI(input: { id: string }): Promise<void> {
  return withMetrics('action.cmdb.deleteCI', async () => {
    const user = await requireUser()
    const ci = await prisma.configurationItem.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        workspaceId: true,
        code: true,
        name: true,
        _count: {
          select: { relationsFrom: true, relationsTo: true, taskLinks: true },
        },
      },
    })
    if (!ci) actionError('NOT_FOUND', `CI ${input.id} no existe`)

    const blocking = ci._count.relationsFrom + ci._count.relationsTo + ci._count.taskLinks
    if (blocking > 0) {
      actionError(
        'HAS_DEPENDENCIES',
        `CI tiene ${blocking} vínculo(s) (relaciones o tickets). Usa "Retirar" en lugar de eliminar.`,
      )
    }

    await prisma.configurationItem.delete({ where: { id: ci.id } })

    await recordAuditEventSafe({
      action: 'ci.deleted',
      entityType: 'configuration_item',
      entityId: ci.id,
      actorId: user.id,
      before: { code: ci.code, name: ci.name },
      metadata: { workspaceId: ci.workspaceId },
    })

    revalidateCmdbRoutes()
  })
}

// ───────────────────────── CIRelation CRUD ─────────────────────────

export async function addCIRelation(
  input: AddCIRelationInput,
): Promise<{ id: string }> {
  return withMetrics('action.cmdb.addCIRelation', async () => {
    const parsed = addRelationSchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const data = parsed.data
    const user = await requireUser()

    if (data.fromCIId === data.toCIId) {
      actionError('INVALID_INPUT', 'Un CI no puede relacionarse consigo mismo')
    }

    // Validamos que ambos CIs existen y son del mismo workspace.
    const [from, to] = await Promise.all([
      prisma.configurationItem.findUnique({
        where: { id: data.fromCIId },
        select: { id: true, workspaceId: true },
      }),
      prisma.configurationItem.findUnique({
        where: { id: data.toCIId },
        select: { id: true, workspaceId: true },
      }),
    ])
    if (!from || !to) actionError('NOT_FOUND', 'CI origen o destino no existe')
    if (from.workspaceId !== to.workspaceId) {
      actionError('INVALID_INPUT', 'Los dos CIs deben pertenecer al mismo workspace')
    }

    // Anti-ciclo directo: rechazamos B→A con el mismo `kind` si ya existe A→B.
    const inverse = await prisma.cIRelation.findFirst({
      where: {
        fromCIId: data.toCIId,
        toCIId: data.fromCIId,
        kind: data.kind,
      },
      select: { id: true },
    })
    if (inverse) {
      actionError(
        'CYCLE_DETECTED',
        `Ya existe una relación inversa ${data.kind} entre estos CIs (ciclo directo no permitido)`,
      )
    }

    let created
    try {
      created = await prisma.cIRelation.create({
        data: {
          fromCIId: data.fromCIId,
          toCIId: data.toCIId,
          kind: data.kind,
          notes: data.notes ?? null,
        },
        select: { id: true },
      })
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        actionError('CONFLICT', 'Ya existe esta relación entre los dos CIs')
      }
      throw err
    }

    await recordAuditEventSafe({
      action: 'ci.relation_added',
      entityType: 'ci_relation',
      entityId: created.id,
      actorId: user.id,
      after: {
        fromCIId: data.fromCIId,
        toCIId: data.toCIId,
        kind: data.kind,
      },
      metadata: { workspaceId: from.workspaceId },
    })

    revalidateCmdbRoutes(data.fromCIId)
    revalidateCmdbRoutes(data.toCIId)
    return created
  })
}

export async function removeCIRelation(input: { id: string }): Promise<void> {
  return withMetrics('action.cmdb.removeCIRelation', async () => {
    const user = await requireUser()
    const rel = await prisma.cIRelation.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        fromCIId: true,
        toCIId: true,
        kind: true,
        fromCI: { select: { workspaceId: true } },
      },
    })
    if (!rel) actionError('NOT_FOUND', `Relación ${input.id} no existe`)

    await prisma.cIRelation.delete({ where: { id: rel.id } })

    await recordAuditEventSafe({
      action: 'ci.relation_removed',
      entityType: 'ci_relation',
      entityId: rel.id,
      actorId: user.id,
      before: {
        fromCIId: rel.fromCIId,
        toCIId: rel.toCIId,
        kind: rel.kind,
      },
      metadata: { workspaceId: rel.fromCI.workspaceId },
    })

    revalidateCmdbRoutes(rel.fromCIId)
    revalidateCmdbRoutes(rel.toCIId)
  })
}

// ───────────────────────── Task ↔ CI link ─────────────────────────

export async function linkTaskToCI(
  input: LinkTaskToCIInput,
): Promise<{ id: string }> {
  return withMetrics('action.cmdb.linkTaskToCI', async () => {
    const parsed = linkTaskSchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const data = parsed.data
    const user = await requireUser()

    const [task, ci] = await Promise.all([
      prisma.task.findUnique({
        where: { id: data.taskId },
        select: { id: true, projectId: true },
      }),
      prisma.configurationItem.findUnique({
        where: { id: data.ciId },
        select: { id: true, workspaceId: true },
      }),
    ])
    if (!task) actionError('NOT_FOUND', `Task ${data.taskId} no existe`)
    if (!ci) actionError('NOT_FOUND', `CI ${data.ciId} no existe`)

    let created
    try {
      created = await prisma.taskCILink.create({
        data: {
          taskId: data.taskId,
          ciId: data.ciId,
          role: data.role ?? 'AFFECTED',
        },
        select: { id: true },
      })
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        actionError(
          'CONFLICT',
          `El ticket ya está linkeado al CI con role=${data.role ?? 'AFFECTED'}`,
        )
      }
      throw err
    }

    await recordAuditEventSafe({
      action: 'ci.task_linked',
      entityType: 'task_ci_link',
      entityId: created.id,
      actorId: user.id,
      after: {
        taskId: data.taskId,
        ciId: data.ciId,
        role: data.role ?? 'AFFECTED',
      },
      metadata: { workspaceId: ci.workspaceId },
    })

    revalidateCmdbRoutes(data.ciId)
    return created
  })
}

export async function unlinkTaskFromCI(input: { id: string }): Promise<void> {
  return withMetrics('action.cmdb.unlinkTaskFromCI', async () => {
    const user = await requireUser()
    const link = await prisma.taskCILink.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        taskId: true,
        ciId: true,
        role: true,
        ci: { select: { workspaceId: true } },
      },
    })
    if (!link) actionError('NOT_FOUND', `Link ${input.id} no existe`)

    await prisma.taskCILink.delete({ where: { id: link.id } })

    await recordAuditEventSafe({
      action: 'ci.task_unlinked',
      entityType: 'task_ci_link',
      entityId: link.id,
      actorId: user.id,
      before: {
        taskId: link.taskId,
        ciId: link.ciId,
        role: link.role,
      },
      metadata: { workspaceId: link.ci.workspaceId },
    })

    revalidateCmdbRoutes(link.ciId)
  })
}

// ───────────────────────── Queries ─────────────────────────

export type SearchCIsResult = {
  total: number
  page: number
  pageSize: number
  items: Array<{
    id: string
    code: string
    name: string
    type: CIType
    status: CIStatus
    criticality: CICriticality
    environment: string | null
    description: string | null
    retiredAt: Date | null
    owner: { id: string; name: string } | null
    updatedAt: Date
    _count: { relationsFrom: number; relationsTo: number; taskLinks: number }
  }>
}

/**
 * Search workspace-scoped con filtros combinables. Soporta paginación
 * estándar (page/pageSize). Por defecto excluye los CIs retirados —
 * `includeRetired: true` para incluirlos.
 *
 * Si el usuario es SUPER_ADMIN/ADMIN sin workspace activo, devuelve
 * resultados vacíos: el CMDB es una vista operativa que requiere WS
 * para tener sentido (no hay "CMDB cross-workspace").
 */
export async function searchCIs(
  input: SearchCIsInput = {},
): Promise<SearchCIsResult> {
  return withMetrics('action.cmdb.searchCIs', async () => {
    const parsed = searchCIsSchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const p = parsed.data
    const user = await requireUser()
    const workspaceId =
      (user as { workspaceId?: string | null }).workspaceId ?? null

    const page = p.page ?? 1
    const pageSize = p.pageSize ?? 25
    const skip = (page - 1) * pageSize

    if (!workspaceId) {
      return { total: 0, page, pageSize, items: [] }
    }

    const where: Prisma.ConfigurationItemWhereInput = {
      workspaceId,
      ...(p.type ? { type: p.type } : {}),
      ...(p.status ? { status: p.status } : {}),
      ...(p.criticality ? { criticality: p.criticality } : {}),
      ...(p.environment ? { environment: p.environment } : {}),
      ...(p.includeRetired ? {} : { retiredAt: null }),
      ...(p.query
        ? {
            OR: [
              { name: { contains: p.query, mode: 'insensitive' } },
              { code: { contains: p.query, mode: 'insensitive' } },
              { description: { contains: p.query, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [total, items] = await Promise.all([
      prisma.configurationItem.count({ where }),
      prisma.configurationItem.findMany({
        where,
        orderBy: [{ criticality: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take: pageSize,
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          status: true,
          criticality: true,
          environment: true,
          description: true,
          retiredAt: true,
          updatedAt: true,
          owner: { select: { id: true, name: true } },
          _count: {
            select: {
              relationsFrom: true,
              relationsTo: true,
              taskLinks: true,
            },
          },
        },
      }),
    ])

    return { total, page, pageSize, items }
  })
}

/**
 * Carga un CI con sus relaciones (in/out) y los tickets vinculados.
 * Pensado para la página de detalle `/cmdb/[ciId]`.
 */
export async function getCIDetail(ciId: string) {
  return withMetrics('action.cmdb.getCIDetail', async () => {
    const user = await requireUser()
    const workspaceId =
      (user as { workspaceId?: string | null }).workspaceId ?? null

    const ci = await prisma.configurationItem.findUnique({
      where: { id: ciId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        relationsFrom: {
          include: {
            toCI: {
              select: {
                id: true,
                code: true,
                name: true,
                type: true,
                status: true,
                criticality: true,
              },
            },
          },
        },
        relationsTo: {
          include: {
            fromCI: {
              select: {
                id: true,
                code: true,
                name: true,
                type: true,
                status: true,
                criticality: true,
              },
            },
          },
        },
        taskLinks: {
          orderBy: { createdAt: 'desc' },
          include: {
            task: {
              select: {
                id: true,
                mnemonic: true,
                title: true,
                type: true,
                status: true,
                priority: true,
                project: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    })

    if (!ci) actionError('NOT_FOUND', `CI ${ciId} no existe`)

    // Workspace check ligero: si el usuario tiene WS y NO es el del CI,
    // bloqueamos. SUPER_ADMIN/ADMIN sin WS activo: les permitimos ver
    // (el CMDB en /admin es una vista global de operación).
    if (workspaceId && ci.workspaceId !== workspaceId) {
      actionError('FORBIDDEN', 'CI fuera del workspace activo')
    }

    return ci
  })
}

/**
 * Wave R5-Extended — Para el badge "CI caído" en TaskCard/Kanban.
 *
 * Devuelve, dado un set de Task IDs, los IDs que tienen al menos un CI
 * vinculado en estado "alerta" (INCIDENT o MAINTENANCE) y no retirado.
 *
 * Mapeo con el spec original de la historia (DOWN/DEGRADED no son
 * literales del enum del repo):
 *   - DOWN     → INCIDENT
 *   - DEGRADED → MAINTENANCE
 *
 * Se devuelve un array (en lugar de Set) para que sea serializable a
 * través del wire de los server actions.
 */
export async function getTasksWithImpactedCI(
  taskIds: string[],
): Promise<string[]> {
  return withMetrics('action.cmdb.getTasksWithImpactedCI', async () => {
    if (!taskIds || taskIds.length === 0) return []
    // Cota dura: la card kanban podría enviar 1000 IDs; truncamos para
    // evitar abuso del endpoint.
    const trimmed = taskIds.slice(0, 500)
    await requireUser()

    const links = await prisma.taskCILink.findMany({
      where: {
        taskId: { in: trimmed },
        ci: {
          retiredAt: null,
          status: { in: ['INCIDENT', 'MAINTENANCE'] },
        },
      },
      select: { taskId: true },
    })
    const out = new Set<string>()
    for (const l of links) out.add(l.taskId)
    return Array.from(out)
  })
}

/**
 * Stats agregadas del CMDB para el dashboard widget. Devuelve:
 *   - countByStatus: cuántos CIs hay por cada CIStatus
 *   - countByCriticality: idem por criticidad
 *   - topByIncidents: top 5 CIs con más tickets ITIL en los últimos 30d
 *
 * Pensado para conectar el widget "CMDB Health" en `/dashboards` a
 * datos reales (deja de ser mock).
 */
export async function getCmdbHealthStats(): Promise<{
  total: number
  countByStatus: Record<CIStatus, number>
  countByCriticality: Record<CICriticality, number>
  topByIncidents: Array<{
    id: string
    code: string
    name: string
    criticality: CICriticality
    incidentsLast30d: number
  }>
}> {
  return withMetrics('action.cmdb.getCmdbHealthStats', async () => {
    const user = await requireUser()
    const workspaceId =
      (user as { workspaceId?: string | null }).workspaceId ?? null

    const emptyStatus = {
      PLANNED: 0,
      ACTIVE: 0,
      MAINTENANCE: 0,
      RETIRED: 0,
      INCIDENT: 0,
    } as Record<CIStatus, number>
    const emptyCrit = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    } as Record<CICriticality, number>

    if (!workspaceId) {
      return {
        total: 0,
        countByStatus: emptyStatus,
        countByCriticality: emptyCrit,
        topByIncidents: [],
      }
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const [byStatus, byCrit, total, topRaw] = await Promise.all([
      prisma.configurationItem.groupBy({
        by: ['status'],
        where: { workspaceId },
        _count: { _all: true },
      }),
      prisma.configurationItem.groupBy({
        by: ['criticality'],
        where: { workspaceId },
        _count: { _all: true },
      }),
      prisma.configurationItem.count({ where: { workspaceId } }),
      // Top 5 CIs con más tickets ITIL recientes. Filtramos por:
      //   - links cuyo task.type = ITIL_TICKET
      //   - link.createdAt >= now-30d
      // El groupBy con count nos devuelve la frecuencia.
      prisma.taskCILink.groupBy({
        by: ['ciId'],
        where: {
          createdAt: { gte: since },
          task: { type: 'ITIL_TICKET' },
          ci: { workspaceId },
        },
        _count: { _all: true },
        orderBy: { _count: { ciId: 'desc' } },
        take: 5,
      }),
    ])

    const countByStatus = { ...emptyStatus }
    for (const row of byStatus) {
      countByStatus[row.status] = row._count._all
    }
    const countByCriticality = { ...emptyCrit }
    for (const row of byCrit) {
      countByCriticality[row.criticality] = row._count._all
    }

    let topByIncidents: Array<{
      id: string
      code: string
      name: string
      criticality: CICriticality
      incidentsLast30d: number
    }> = []
    if (topRaw.length > 0) {
      const ciIds = topRaw.map((r) => r.ciId)
      const cis = await prisma.configurationItem.findMany({
        where: { id: { in: ciIds } },
        select: { id: true, code: true, name: true, criticality: true },
      })
      const byId = new Map(cis.map((c) => [c.id, c] as const))
      topByIncidents = topRaw
        .map((r) => {
          const ci = byId.get(r.ciId)
          if (!ci) return null
          return {
            id: ci.id,
            code: ci.code,
            name: ci.name,
            criticality: ci.criticality,
            incidentsLast30d: r._count._all,
          }
        })
        .filter((v): v is NonNullable<typeof v> => v !== null)
    }

    return { total, countByStatus, countByCriticality, topByIncidents }
  })
}

// ────────────────────── Wave R5-Extended ──────────────────────
//
// 1) Lifecycle audit trail · `updateCiStatus` valida la transición
//    permitida y persiste un `CILifecycleEvent`.
// 2) Bulk Import desde CSV · `bulkImportCIs` corre todo bajo una
//    transacción y devuelve detalle fila-por-fila.
// 3) Change Request ligero · 4 server actions (`createCIChangeRequest`,
//    `approveCIChangeRequest`, `executeCIChangeRequest`,
//    `cancelCIChangeRequest`).
// ───────────────────────────────────────────────────────────────

// ── Lifecycle: matriz de transición ───────────────────────────

/**
 * Matriz de transiciones válidas para `CIStatus`. Reglas operativas:
 *   - `PLANNED → ACTIVE` (entra a producción).
 *   - `ACTIVE ↔ MAINTENANCE` (ventana programada).
 *   - `ACTIVE/MAINTENANCE/PLANNED → INCIDENT` (falla detectada).
 *   - `INCIDENT → ACTIVE` (resuelto y operativo).
 *   - `INCIDENT → MAINTENANCE` (mitigado, en mantenimiento).
 *   - `ACTIVE/MAINTENANCE/PLANNED → RETIRED` (decomisionado).
 *   - `RETIRED → PLANNED` (re-uso del CI; cualquier otra transición
 *     desde RETIRED queda bloqueada para preservar la semántica del
 *     soft-delete).
 *
 * Las transiciones a sí mismo se permiten (es un no-op auditado).
 */
const CI_STATUS_TRANSITIONS: Record<CIStatus, ReadonlySet<CIStatus>> = {
  PLANNED: new Set<CIStatus>(['PLANNED', 'ACTIVE', 'INCIDENT', 'RETIRED']),
  ACTIVE: new Set<CIStatus>(['ACTIVE', 'MAINTENANCE', 'INCIDENT', 'RETIRED']),
  MAINTENANCE: new Set<CIStatus>([
    'MAINTENANCE',
    'ACTIVE',
    'INCIDENT',
    'RETIRED',
  ]),
  INCIDENT: new Set<CIStatus>(['INCIDENT', 'ACTIVE', 'MAINTENANCE', 'RETIRED']),
  // Desde RETIRED sólo PLANNED (reincorporación). Todo lo demás bloqueado.
  RETIRED: new Set<CIStatus>(['RETIRED', 'PLANNED']),
}

function isValidCITransition(from: CIStatus, to: CIStatus): boolean {
  const allowed = CI_STATUS_TRANSITIONS[from]
  return !!allowed && allowed.has(to)
}

const updateCiStatusSchema = z.object({
  ciId: z.string().min(1),
  toStatus: z.enum([
    'PLANNED',
    'ACTIVE',
    'MAINTENANCE',
    'RETIRED',
    'INCIDENT',
  ] as const satisfies readonly CIStatus[]),
  note: z.string().trim().max(500).optional().nullable(),
})

export type UpdateCiStatusInput = z.input<typeof updateCiStatusSchema>

/**
 * Cambia el `CIStatus` de un CI validando la transición permitida y
 * persistiendo el evento en `CILifecycleEvent`. Idempotente cuando
 * `from === to` (igual emite evento — sirve como anclaje de auditoría).
 *
 * RETIRED → cualquier otro estado distinto de PLANNED queda bloqueado
 * para preservar la semántica del soft-delete. Si se mueve a RETIRED,
 * además se setea `retiredAt = now()` (alineado con `retireCI`).
 *
 * El `actorId` se infiere de la sesión; el evento queda con SetNull
 * si más adelante el usuario es eliminado.
 */
export async function updateCiStatus(input: UpdateCiStatusInput): Promise<{
  eventId: string
  fromStatus: CIStatus
  toStatus: CIStatus
}> {
  return withMetrics('action.cmdb.updateCiStatus', async () => {
    const parsed = updateCiStatusSchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const data = parsed.data
    const user = await requireUser()

    const ci = await prisma.configurationItem.findUnique({
      where: { id: data.ciId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        retiredAt: true,
        code: true,
      },
    })
    if (!ci) actionError('NOT_FOUND', `CI ${data.ciId} no existe`)

    if (!isValidCITransition(ci.status, data.toStatus)) {
      actionError(
        'CONFLICT',
        `Transición no permitida: ${ci.status} → ${data.toStatus}`,
      )
    }

    // Persistencia atómica: actualización del status + retiredAt + evento.
    const result = await prisma.$transaction(async (tx) => {
      await tx.configurationItem.update({
        where: { id: ci.id },
        data: {
          status: data.toStatus,
          // Si pasa a RETIRED, fijamos `retiredAt` (no sobrescribe si ya
          // tenía valor). Si sale de RETIRED → PLANNED, lo limpiamos.
          ...(data.toStatus === 'RETIRED' && !ci.retiredAt
            ? { retiredAt: new Date() }
            : {}),
          ...(ci.status === 'RETIRED' && data.toStatus === 'PLANNED'
            ? { retiredAt: null }
            : {}),
        },
      })
      const evt = await tx.cILifecycleEvent.create({
        data: {
          ciId: ci.id,
          fromStatus: ci.status,
          toStatus: data.toStatus,
          note: data.note ?? null,
          actorId: user.id,
        },
        select: { id: true },
      })
      return evt
    })

    await recordAuditEventSafe({
      action: 'ci.status_changed',
      entityType: 'configuration_item',
      entityId: ci.id,
      actorId: user.id,
      before: { status: ci.status },
      after: { status: data.toStatus },
      metadata: {
        workspaceId: ci.workspaceId,
        code: ci.code,
        eventId: result.id,
        note: data.note ?? null,
      },
    })

    revalidateCmdbRoutes(ci.id)
    return { eventId: result.id, fromStatus: ci.status, toStatus: data.toStatus }
  })
}

/**
 * Lista los eventos de lifecycle de un CI ordenados desc por fecha.
 * Workspace-check via el CI (FK Cascade preserva la integridad).
 */
export async function listCILifecycleEvents(ciId: string): Promise<
  Array<{
    id: string
    fromStatus: CIStatus | null
    toStatus: CIStatus
    note: string | null
    createdAt: Date
    actor: { id: string; name: string } | null
  }>
> {
  return withMetrics('action.cmdb.listCILifecycleEvents', async () => {
    const user = await requireUser()
    const workspaceId =
      (user as { workspaceId?: string | null }).workspaceId ?? null

    const ci = await prisma.configurationItem.findUnique({
      where: { id: ciId },
      select: { id: true, workspaceId: true },
    })
    if (!ci) actionError('NOT_FOUND', `CI ${ciId} no existe`)
    if (workspaceId && ci.workspaceId !== workspaceId) {
      actionError('FORBIDDEN', 'CI fuera del workspace activo')
    }

    const events = await prisma.cILifecycleEvent.findMany({
      where: { ciId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        createdAt: true,
        actor: { select: { id: true, name: true } },
      },
    })
    return events
  })
}

// ─────────────────────── Bulk Import CSV ─────────────────────

/**
 * Forma esperada de cada fila CSV. Las columnas `type`, `status` y
 * `criticality` se parsean en mayúsculas y se validan contra los enums;
 * `ownerEmail` se resuelve a `User.id` con búsqueda case-insensitive
 * dentro del mismo workspace (cualquier usuario activo del WS).
 */
const csvRowSchema = z.object({
  name: z.string().trim().min(1, 'name vacío').max(200),
  type: z.enum(CI_TYPES).optional(),
  status: z.enum(CI_STATUSES).optional(),
  criticality: z.enum(CI_CRITICALITIES).optional(),
  description: z.string().trim().max(4000).optional().nullable(),
  ownerEmail: z
    .string()
    .trim()
    .email('email inválido')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
})

export type CsvImportRowResult =
  | {
      rowIndex: number
      status: 'ok'
      ciId: string
      code: string
      name: string
    }
  | {
      rowIndex: number
      status: 'error'
      message: string
      rawName?: string
    }

export type BulkImportResult = {
  created: number
  failed: number
  rows: CsvImportRowResult[]
}

/**
 * Parser CSV minimalista. NO es RFC 4180 completo — soporta los casos
 * realistas que producirían Excel/LibreOffice al exportar inventarios:
 *   - delimitador `,`
 *   - comillas dobles para escapar comas embebidas
 *   - `""` dentro de comillas representa una comilla literal
 *   - filas vacías y trailing CRLF se ignoran
 *
 * Si necesitamos algo más serio en el futuro, se cambia por `papaparse`.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cur += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(cur)
      cur = ''
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    if (ch === '\n') {
      row.push(cur)
      rows.push(row)
      row = []
      cur = ''
      i++
      continue
    }
    cur += ch
    i++
  }
  // último campo / última fila si no termina en newline
  if (cur.length > 0 || row.length > 0) {
    row.push(cur)
    rows.push(row)
  }
  // limpia filas totalmente vacías ("," vacíos al final del archivo)
  return rows.filter((r) => r.some((c) => c.trim().length > 0))
}

const REQUIRED_HEADERS = [
  'name',
  'type',
  'status',
  'criticality',
  'description',
  'ownerEmail',
] as const

/**
 * Bulk import: parsea el CSV, valida fila por fila, y dentro de UNA SOLA
 * transacción crea todos los CIs válidos. Si alguna fila falla, NO se
 * persiste nada (rollback). El objetivo: la UI puede mostrar todos los
 * errores juntos y el operador corrige y reintenta una sola vez.
 *
 * Permiso: sólo ADMIN+. La validación de rol es server-side; la página
 * `/cmdb/import` también gate por ADMIN para no exponer el form a quien
 * no puede usarlo.
 *
 * Auditoría: `ci.bulk_imported` con `{ created, failed }` y los códigos
 * de los CIs creados en `metadata.ciCodes` para trazabilidad.
 */
export async function bulkImportCIs(
  csvText: string,
): Promise<BulkImportResult> {
  return withMetrics('action.cmdb.bulkImportCIs', async () => {
    const user = await requireUser()
    if (!hasAdminRole(user.roles)) {
      actionError('FORBIDDEN', 'Sólo ADMIN puede importar CIs en bulk')
    }
    const { workspaceId } = await requireUserWorkspace()

    if (typeof csvText !== 'string' || csvText.trim().length === 0) {
      actionError('INVALID_INPUT', 'CSV vacío')
    }

    const grid = parseCsv(csvText)
    if (grid.length === 0) {
      actionError('INVALID_INPUT', 'CSV no contiene filas')
    }

    const header = grid[0].map((h) => h.trim())
    const idx: Record<(typeof REQUIRED_HEADERS)[number], number> = {
      name: header.indexOf('name'),
      type: header.indexOf('type'),
      status: header.indexOf('status'),
      criticality: header.indexOf('criticality'),
      description: header.indexOf('description'),
      ownerEmail: header.indexOf('ownerEmail'),
    }
    // `name` es la única columna OBLIGATORIA del header; las demás
    // pueden faltar y se interpretan como undefined por fila.
    if (idx.name < 0) {
      actionError(
        'INVALID_INPUT',
        `Header CSV inválido. Esperado: ${REQUIRED_HEADERS.join(',')} (al menos "name")`,
      )
    }

    const dataRows = grid.slice(1)
    if (dataRows.length === 0) {
      actionError('INVALID_INPUT', 'CSV sin filas de datos (sólo header)')
    }

    // Resolución previa de owners por email (case-insensitive). Hacemos
    // un único query con todos los emails distintos para evitar N+1.
    const allEmails = new Set<string>()
    for (const row of dataRows) {
      const e = idx.ownerEmail >= 0 ? row[idx.ownerEmail]?.trim() : ''
      if (e) allEmails.add(e.toLowerCase())
    }
    const ownersByEmail = new Map<string, string>()
    if (allEmails.size > 0) {
      const users = await prisma.user.findMany({
        where: {
          email: { in: Array.from(allEmails), mode: 'insensitive' },
          archivedAt: null,
        },
        select: { id: true, email: true },
      })
      for (const u of users) {
        ownersByEmail.set(u.email.toLowerCase(), u.id)
      }
    }

    // Pre-validación fila por fila. Generamos:
    //   - `valid` con los datos listos para crear (en orden).
    //   - `errors` para las filas que no compilan.
    type ValidRow = {
      rowIndex: number
      name: string
      type: CIType
      status: CIStatus
      criticality: CICriticality
      description: string | null
      ownerId: string | null
    }
    const valid: ValidRow[] = []
    const errors: CsvImportRowResult[] = []

    for (let r = 0; r < dataRows.length; r++) {
      const rowIndex = r + 2 // +2: header es fila 1, datos arrancan en 2
      const row = dataRows[r]
      const cell = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')

      const rawName = cell(idx.name)
      const candidate = {
        name: rawName,
        type: cell(idx.type).toUpperCase() || undefined,
        status: cell(idx.status).toUpperCase() || undefined,
        criticality: cell(idx.criticality).toUpperCase() || undefined,
        description: cell(idx.description) || undefined,
        ownerEmail: cell(idx.ownerEmail) || undefined,
      }

      const parsed = csvRowSchema.safeParse(candidate)
      if (!parsed.success) {
        errors.push({
          rowIndex,
          status: 'error',
          message: parsed.error.issues.map((i) => i.message).join('; '),
          rawName: rawName || undefined,
        })
        continue
      }

      let ownerId: string | null = null
      if (parsed.data.ownerEmail) {
        const found = ownersByEmail.get(parsed.data.ownerEmail.toLowerCase())
        if (!found) {
          errors.push({
            rowIndex,
            status: 'error',
            message: `ownerEmail "${parsed.data.ownerEmail}" no resuelve a un usuario activo`,
            rawName: rawName || undefined,
          })
          continue
        }
        ownerId = found
      }

      valid.push({
        rowIndex,
        name: parsed.data.name,
        type: parsed.data.type ?? 'OTHER',
        status: parsed.data.status ?? 'ACTIVE',
        criticality: parsed.data.criticality ?? 'MEDIUM',
        description: parsed.data.description ?? null,
        ownerId,
      })
    }

    // Si CUALQUIER fila falló, NO creamos nada y devolvemos el detalle.
    if (errors.length > 0) {
      return {
        created: 0,
        failed: errors.length,
        rows: errors,
      }
    }

    // Transacción atómica para todos los inserts. Generamos los códigos
    // dentro de la transacción para evitar colisiones con creaciones
    // paralelas — locking light: si `P2002` revienta, propagamos el
    // error y dejamos al operador reintentar (raro en flujo bulk).
    const createdRows: CsvImportRowResult[] = await prisma.$transaction(
      async (tx) => {
        // Buscamos el último código existente para calcular la base.
        const last = await tx.configurationItem.findFirst({
          where: { workspaceId, code: { startsWith: 'CI-' } },
          orderBy: { code: 'desc' },
          select: { code: true },
        })
        let n = 1
        if (last?.code) {
          const parsedNum = parseInt(last.code.replace('CI-', ''), 10)
          if (Number.isFinite(parsedNum)) n = parsedNum + 1
        }

        const out: CsvImportRowResult[] = []
        for (const v of valid) {
          const code = `CI-${String(n).padStart(3, '0')}`
          n += 1
          const created = await tx.configurationItem.create({
            data: {
              workspaceId,
              code,
              name: v.name,
              type: v.type,
              status: v.status,
              criticality: v.criticality,
              description: v.description,
              ownerId: v.ownerId,
              createdById: user.id,
            },
            select: { id: true, code: true, name: true },
          })
          out.push({
            rowIndex: v.rowIndex,
            status: 'ok',
            ciId: created.id,
            code: created.code,
            name: created.name,
          })
        }
        return out
      },
    )

    await recordAuditEventSafe({
      action: 'ci.bulk_imported',
      entityType: 'configuration_item',
      actorId: user.id,
      after: {
        created: createdRows.length,
        failed: 0,
      },
      metadata: {
        workspaceId,
        ciCodes: createdRows
          .filter((r): r is Extract<CsvImportRowResult, { status: 'ok' }> =>
            r.status === 'ok',
          )
          .map((r) => r.code),
      },
    })

    revalidateCmdbRoutes()
    return {
      created: createdRows.length,
      failed: 0,
      rows: createdRows,
    }
  })
}

// ───────────────────── Change Request ligero ─────────────────────

const createChangeRequestSchema = z.object({
  ciId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  rationale: z.string().trim().max(4000).optional().nullable(),
  plannedAt: z.coerce.date().optional().nullable(),
})

export type CreateCIChangeRequestInput = z.input<typeof createChangeRequestSchema>

/**
 * Cualquier usuario con visibilidad del workspace puede SOLICITAR un
 * cambio. La aprobación/ejecución sí requieren ADMIN.
 */
export async function createCIChangeRequest(
  input: CreateCIChangeRequestInput,
): Promise<{ id: string }> {
  return withMetrics('action.cmdb.createCIChangeRequest', async () => {
    const parsed = createChangeRequestSchema.safeParse(input)
    if (!parsed.success) {
      actionError(
        'INVALID_INPUT',
        parsed.error.issues.map((i) => i.message).join('; '),
      )
    }
    const data = parsed.data
    const user = await requireUser()
    const workspaceId =
      (user as { workspaceId?: string | null }).workspaceId ?? null

    const ci = await prisma.configurationItem.findUnique({
      where: { id: data.ciId },
      select: { id: true, workspaceId: true, code: true },
    })
    if (!ci) actionError('NOT_FOUND', `CI ${data.ciId} no existe`)
    if (workspaceId && ci.workspaceId !== workspaceId) {
      actionError('FORBIDDEN', 'CI fuera del workspace activo')
    }

    const created = await prisma.cIChangeRequest.create({
      data: {
        ciId: data.ciId,
        title: data.title,
        rationale: data.rationale ?? null,
        plannedAt: data.plannedAt ?? null,
        status: 'PROPOSED',
        requestedById: user.id,
      },
      select: { id: true },
    })

    await recordAuditEventSafe({
      action: 'ci.change_requested',
      entityType: 'ci_change_request',
      entityId: created.id,
      actorId: user.id,
      after: {
        ciId: data.ciId,
        title: data.title,
        plannedAt: data.plannedAt?.toISOString() ?? null,
      },
      metadata: { workspaceId: ci.workspaceId, code: ci.code },
    })

    revalidateCmdbRoutes(data.ciId)
    return created
  })
}

async function loadChangeRequestForAdmin(
  id: string,
): Promise<{
  id: string
  ciId: string
  status: CIChangeStatus
  workspaceId: string
  code: string
}> {
  const cr = await prisma.cIChangeRequest.findUnique({
    where: { id },
    select: {
      id: true,
      ciId: true,
      status: true,
      ci: { select: { workspaceId: true, code: true } },
    },
  })
  if (!cr) actionError('NOT_FOUND', `Change Request ${id} no existe`)
  return {
    id: cr.id,
    ciId: cr.ciId,
    status: cr.status,
    workspaceId: cr.ci.workspaceId,
    code: cr.ci.code,
  }
}

function requireAdmin(roles: readonly string[]): void {
  if (!hasAdminRole(roles)) {
    actionError('FORBIDDEN', 'Sólo ADMIN puede gestionar el Change Request')
  }
}

/**
 * Aprueba un Change Request. Sólo ADMIN. Transición permitida:
 *   `PROPOSED → APPROVED`.
 * El `approvedById` queda en el actor; futuros ejecutores pueden ser
 * distintos (no se restringe a "el mismo ADMIN que aprobó ejecuta").
 */
export async function approveCIChangeRequest(input: {
  id: string
}): Promise<void> {
  return withMetrics('action.cmdb.approveCIChangeRequest', async () => {
    const user = await requireUser()
    requireAdmin(user.roles)
    const cr = await loadChangeRequestForAdmin(input.id)
    if (cr.status !== 'PROPOSED') {
      actionError(
        'CONFLICT',
        `Sólo se pueden aprobar requests en estado PROPOSED (actual: ${cr.status})`,
      )
    }

    await prisma.cIChangeRequest.update({
      where: { id: cr.id },
      data: { status: 'APPROVED', approvedById: user.id },
    })

    await recordAuditEventSafe({
      action: 'ci.change_approved',
      entityType: 'ci_change_request',
      entityId: cr.id,
      actorId: user.id,
      before: { status: 'PROPOSED' },
      after: { status: 'APPROVED' },
      metadata: { workspaceId: cr.workspaceId, ciId: cr.ciId, code: cr.code },
    })
    revalidateCmdbRoutes(cr.ciId)
  })
}

/**
 * Ejecuta un Change Request previamente APPROVED, fija `executedAt`.
 * Sólo ADMIN.
 */
export async function executeCIChangeRequest(input: {
  id: string
}): Promise<void> {
  return withMetrics('action.cmdb.executeCIChangeRequest', async () => {
    const user = await requireUser()
    requireAdmin(user.roles)
    const cr = await loadChangeRequestForAdmin(input.id)
    if (cr.status !== 'APPROVED') {
      actionError(
        'CONFLICT',
        `Sólo se pueden ejecutar requests APROBADOS (actual: ${cr.status})`,
      )
    }
    await prisma.cIChangeRequest.update({
      where: { id: cr.id },
      data: { status: 'EXECUTED', executedAt: new Date() },
    })
    await recordAuditEventSafe({
      action: 'ci.change_executed',
      entityType: 'ci_change_request',
      entityId: cr.id,
      actorId: user.id,
      before: { status: 'APPROVED' },
      after: { status: 'EXECUTED' },
      metadata: { workspaceId: cr.workspaceId, ciId: cr.ciId, code: cr.code },
    })
    revalidateCmdbRoutes(cr.ciId)
  })
}

/**
 * Cancela o rechaza un Change Request. Acepta cualquier estado distinto
 * de EXECUTED (no se "des-ejecuta" una ventana ya aplicada). Si el
 * actor es el requester original, el verbo conceptual es "cancelar";
 * si es un ADMIN distinto, es "rechazar"; ambos caen en CANCELLED por
 * simplicidad y disparan la misma audit action `ci.change_cancelled`.
 *
 * Política: el requester puede cancelar SU propio request (cualquier
 * estado != EXECUTED). Cualquier ADMIN también puede.
 */
export async function cancelCIChangeRequest(input: {
  id: string
  reason?: string | null
}): Promise<void> {
  return withMetrics('action.cmdb.cancelCIChangeRequest', async () => {
    const user = await requireUser()
    const cr = await prisma.cIChangeRequest.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        ciId: true,
        status: true,
        requestedById: true,
        ci: { select: { workspaceId: true, code: true } },
      },
    })
    if (!cr) actionError('NOT_FOUND', `Change Request ${input.id} no existe`)

    if (cr.status === 'EXECUTED') {
      actionError('CONFLICT', 'No se puede cancelar un cambio ya ejecutado')
    }
    if (cr.status === 'CANCELLED' || cr.status === 'REJECTED') {
      // Ya terminal — idempotente.
      return
    }

    // Permiso: el dueño del request o un ADMIN.
    const isOwner = cr.requestedById === user.id
    if (!isOwner && !hasAdminRole(user.roles)) {
      actionError(
        'FORBIDDEN',
        'Sólo el solicitante o un ADMIN pueden cancelar el cambio',
      )
    }

    const newStatus: CIChangeStatus =
      !isOwner && hasAdminRole(user.roles) ? 'REJECTED' : 'CANCELLED'

    await prisma.cIChangeRequest.update({
      where: { id: cr.id },
      data: { status: newStatus },
    })
    await recordAuditEventSafe({
      action: 'ci.change_cancelled',
      entityType: 'ci_change_request',
      entityId: cr.id,
      actorId: user.id,
      before: { status: cr.status },
      after: { status: newStatus },
      metadata: {
        workspaceId: cr.ci.workspaceId,
        ciId: cr.ciId,
        code: cr.ci.code,
        reason: input.reason ?? null,
      },
    })
    revalidateCmdbRoutes(cr.ciId)
  })
}

/**
 * Lista los Change Requests de un CI, ordenados por más reciente.
 * Workspace check vía CI.
 */
export async function listCIChangeRequests(ciId: string): Promise<
  Array<{
    id: string
    title: string
    rationale: string | null
    plannedAt: Date | null
    executedAt: Date | null
    status: CIChangeStatus
    createdAt: Date
    requestedBy: { id: string; name: string }
    approvedBy: { id: string; name: string } | null
  }>
> {
  return withMetrics('action.cmdb.listCIChangeRequests', async () => {
    const user = await requireUser()
    const workspaceId =
      (user as { workspaceId?: string | null }).workspaceId ?? null

    const ci = await prisma.configurationItem.findUnique({
      where: { id: ciId },
      select: { id: true, workspaceId: true },
    })
    if (!ci) actionError('NOT_FOUND', `CI ${ciId} no existe`)
    if (workspaceId && ci.workspaceId !== workspaceId) {
      actionError('FORBIDDEN', 'CI fuera del workspace activo')
    }

    const rows = await prisma.cIChangeRequest.findMany({
      where: { ciId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        rationale: true,
        plannedAt: true,
        executedAt: true,
        status: true,
        createdAt: true,
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    })
    return rows
  })
}
