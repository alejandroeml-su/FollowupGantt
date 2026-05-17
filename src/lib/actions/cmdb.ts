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
} from '@prisma/client'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { withMetrics } from '@/lib/observability/metrics'

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
