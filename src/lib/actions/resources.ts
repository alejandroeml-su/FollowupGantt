'use server'

/**
 * Server actions para Resource Management (Ola P8 · Equipo P8-1).
 *
 * Expone:
 *   - CRUD de `Skill` (catálogo global de habilidades).
 *   - Mutaciones de `UserSkill` (matriz Users × Skills × nivel).
 *   - Queries para WorkloadChart / SkillMatrix / AvailableUsersFilter.
 *
 * Convenciones del repo:
 *   - Errores tipados `[CODE] detalle` (alineado con `calendars.ts` y
 *     `leveling.ts`).
 *   - Validación con zod.
 *   - Las queries de proyecto usan `requireProjectAccess`. Las queries
 *     "globales" (skills y users disponibles) usan `requireUser` — los
 *     skills no son sensibles per-proyecto pero sí requieren sesión.
 *   - Tras mutar, `revalidatePath('/resources')`.
 *
 * Se usa el patrón `prisma as unknown as { ... }` para los modelos que
 * el cliente Prisma todavía no conoce hasta que se aplique la migración
 * (ver `calendars.ts` y `sprints.ts`). Con `npx prisma generate` post
 * migración, los castings desaparecen sin cambios de API.
 */

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { requireUser } from '@/lib/auth/get-current-user'
import { requireProjectAccess } from '@/lib/auth/check-project-access'
import {
  computeWorkload,
  toIsoDay,
  type WorkloadResult,
  type WorkloadTaskInput,
} from '@/lib/resources/workload-calc'
import {
  computeCapacity,
  parseCapacityOverrides,
  type CapacityOverrideMap,
  type CapacityResult,
} from '@/lib/resources/capacity-calc'
import {
  suggestRebalance,
  type RebalanceResult,
  type RebalanceTask,
  type UserSkillEntry,
} from '@/lib/resources/rebalance'
import {
  DEFAULT_WORKDAYS_BITMASK,
  type WorkCalendarLike,
} from '@/lib/scheduling/work-calendar'

// ───────────────────────── Errores tipados ─────────────────────────

export type ResourceErrorCode =
  | 'INVALID_INPUT'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_DUPLICATE'
  | 'USER_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'FORBIDDEN'

function actionError(code: ResourceErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// P17-A · catálogo de skills cacheado a nivel global. Cualquier mutación
// (create/update/delete/upsertUserSkill) invalida vía revalidateTag.
const TAG_CATALOG_SKILLS = 'catalog:skills'
const SKILLS_REVALIDATE_SECONDS = 60

async function invalidateSkillsCatalog(): Promise<void> {
  revalidateTag(TAG_CATALOG_SKILLS, 'max')
}

function revalidateRoutes() {
  revalidatePath('/resources')
  revalidatePath('/list')
  revalidatePath('/gantt')
}

// ───────────────────────── Schemas ─────────────────────────

const createSkillSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.string().max(40).optional(),
})

const renameSkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  category: z.string().max(40).nullable().optional(),
})

const upsertUserSkillSchema = z.object({
  userId: z.string().min(1),
  skillId: z.string().min(1),
  level: z.number().int().min(1).max(5),
})

const removeUserSkillSchema = z.object({
  userId: z.string().min(1),
  skillId: z.string().min(1),
})

const workloadQuerySchema = z.object({
  projectId: z.string().min(1),
  rangeStart: z.string().datetime(),
  rangeEnd: z.string().datetime(),
})

const availableUsersSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Esperado YYYY-MM-DD'),
  skillId: z.string().min(1).optional(),
  minLevel: z.number().int().min(1).max(5).optional(),
  /**
   * Si se pasa, el usuario sólo se considera disponible si su slack
   * (capacity - load) >= a este valor en la fecha solicitada.
   */
  requiredHours: z.number().min(0).max(24).optional(),
  /** Filtra por usuarios asignables al proyecto (project assignments). */
  projectId: z.string().min(1).optional(),
})

// ───────────────────────── Tipos públicos ─────────────────────────

export interface SkillSummary {
  id: string
  name: string
  category: string | null
  userCount: number
}

export interface UserSkillSummary {
  userId: string
  skillId: string
  skillName: string
  level: number
}

export interface SkillMatrixCell {
  userId: string
  userName: string
  skillId: string
  skillName: string
  level: number | null
}

export interface SkillMatrix {
  users: Array<{ id: string; name: string }>
  skills: Array<{ id: string; name: string; category: string | null }>
  cells: SkillMatrixCell[]
}

export interface SerializableWorkloadEntry {
  userId: string
  userName: string
  dailyLoad: Array<{ date: string; hours: number }>
  dailyCapacity: Array<{ date: string; hours: number }>
  contributionsByDay: Array<{
    date: string
    items: Array<{ taskId: string; taskTitle: string; hours: number }>
  }>
  totalOverloadHours: number
  totalOverloadDays: number
  peakDailyHours: number
}

export interface SerializableWorkloadResponse {
  rangeStart: string
  rangeEnd: string
  days: string[]
  entries: SerializableWorkloadEntry[]
  rebalanceSuggestions: RebalanceResult['suggestions']
  rebalanceUnresolved: RebalanceResult['unresolved']
}

// ───────────────────────── CRUD Skills ─────────────────────────

interface PrismaSkillModel {
  findMany: (a: unknown) => Promise<
    Array<{
      id: string
      name: string
      category: string | null
      _count?: { userSkills: number }
    }>
  >
  findUnique: (a: unknown) => Promise<{ id: string; name: string } | null>
  create: (a: unknown) => Promise<{ id: string }>
  update: (a: unknown) => Promise<unknown>
  delete: (a: unknown) => Promise<unknown>
}

interface PrismaUserSkillModel {
  upsert: (a: unknown) => Promise<{ userId: string; skillId: string; level: number }>
  delete: (a: unknown) => Promise<unknown>
  findMany: (a: unknown) => Promise<
    Array<{
      userId: string
      skillId: string
      level: number
      skill?: { id: string; name: string }
    }>
  >
}

function getSkillModel(): PrismaSkillModel {
  return (prisma as unknown as { skill: PrismaSkillModel }).skill
}

function getUserSkillModel(): PrismaUserSkillModel {
  return (prisma as unknown as { userSkill: PrismaUserSkillModel }).userSkill
}

export async function listSkills(): Promise<SkillSummary[]> {
  await requireUser()
  // P17-A · catálogo de skills cacheado (TTL 60s). Las skills mutan
  // pocas veces al día y se consultan en /resources, formularios de
  // task assignment, filtros, etc. → high cache hit rate.
  return unstable_cache(
    async () => {
      try {
        const rows = await getSkillModel().findMany({
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
          include: { _count: { select: { userSkills: true } } },
        })
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          userCount: r._count?.userSkills ?? 0,
        }))
      } catch {
        // Si la migración aún no se aplicó, devolvemos lista vacía
        // para que la UI no falle con [P2021] (table does not exist).
        return []
      }
    },
    ['catalog-skills'],
    {
      tags: [TAG_CATALOG_SKILLS],
      revalidate: SKILLS_REVALIDATE_SECONDS,
    },
  )()
}

export async function createSkill(input: { name: string; category?: string }) {
  await requireUser()
  const parsed = createSkillSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }
  try {
    const created = await getSkillModel().create({
      data: {
        name: parsed.data.name.trim(),
        category: parsed.data.category?.trim() || null,
      },
    })
    await invalidateSkillsCatalog()
    revalidateRoutes()
    return { id: created.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('Unique') || message.includes('P2002')) {
      actionError('SKILL_DUPLICATE', `Ya existe una skill con nombre "${input.name}"`)
    }
    throw err
  }
}

export async function renameSkill(input: {
  id: string
  name?: string
  category?: string | null
}) {
  await requireUser()
  const parsed = renameSkillSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }
  const data: Record<string, unknown> = {}
  if (parsed.data.name) data.name = parsed.data.name.trim()
  if (parsed.data.category !== undefined) {
    data.category =
      typeof parsed.data.category === 'string'
        ? parsed.data.category.trim() || null
        : null
  }
  if (Object.keys(data).length === 0) return { ok: true }
  try {
    await getSkillModel().update({ where: { id: parsed.data.id }, data })
    await invalidateSkillsCatalog()
    revalidateRoutes()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('P2025')) {
      actionError('SKILL_NOT_FOUND', `Skill ${input.id} no existe`)
    }
    throw err
  }
}

export async function deleteSkill(id: string) {
  await requireUser()
  if (!id || typeof id !== 'string') {
    actionError('INVALID_INPUT', 'id requerido')
  }
  try {
    await getSkillModel().delete({ where: { id } })
    await invalidateSkillsCatalog()
    revalidateRoutes()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('P2025')) {
      actionError('SKILL_NOT_FOUND', `Skill ${id} no existe`)
    }
    throw err
  }
}

// ───────────────────────── UserSkill mutations ─────────────────────────

export async function setUserSkillLevel(input: {
  userId: string
  skillId: string
  level: number
}) {
  await requireUser()
  const parsed = upsertUserSkillSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }
  try {
    await getUserSkillModel().upsert({
      where: {
        userId_skillId: {
          userId: parsed.data.userId,
          skillId: parsed.data.skillId,
        },
      },
      create: {
        userId: parsed.data.userId,
        skillId: parsed.data.skillId,
        level: parsed.data.level,
      },
      update: { level: parsed.data.level },
    })
    revalidateRoutes()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('foreign key') || message.includes('P2003')) {
      actionError('USER_NOT_FOUND', 'userId o skillId no existen')
    }
    throw err
  }
}

export async function removeUserSkill(input: {
  userId: string
  skillId: string
}) {
  await requireUser()
  const parsed = removeUserSkillSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }
  try {
    await getUserSkillModel().delete({
      where: {
        userId_skillId: {
          userId: parsed.data.userId,
          skillId: parsed.data.skillId,
        },
      },
    })
    revalidateRoutes()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('P2025')) {
      // Idempotente: borrar algo inexistente NO debe fallar la UI.
      return { ok: true }
    }
    throw err
  }
}

// ───────────────────────── Queries: SkillMatrix ─────────────────────────

export async function getSkillMatrix(): Promise<SkillMatrix> {
  await requireUser()
  let skillRows: Array<{ id: string; name: string; category: string | null }> = []
  let userSkillRows: Array<{
    userId: string
    skillId: string
    level: number
  }> = []
  try {
    skillRows = await getSkillModel().findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    userSkillRows = await getUserSkillModel().findMany({})
  } catch {
    // migración pendiente
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  const cellMap = new Map<string, number>()
  for (const us of userSkillRows) {
    cellMap.set(`${us.userId}::${us.skillId}`, us.level)
  }
  const cells: SkillMatrixCell[] = []
  for (const u of users) {
    for (const s of skillRows) {
      cells.push({
        userId: u.id,
        userName: u.name,
        skillId: s.id,
        skillName: s.name,
        level: cellMap.get(`${u.id}::${s.id}`) ?? null,
      })
    }
  }

  return {
    users,
    skills: skillRows,
    cells,
  }
}

// ───────────────────────── Queries: Workload ─────────────────────────

interface CalendarLoaded extends WorkCalendarLike {
  workdayHours: number
}

async function loadProjectCalendar(projectId: string): Promise<CalendarLoaded> {
  // Igual que /workload/page.tsx: fallback a lun-vie 8h si no hay calendar.
  type ProjectWithCalendar = {
    calendar: {
      workdays: number
      workdayHours: unknown
      holidays: Array<{ date: Date; recurring: boolean | null }>
    } | null
  }
  try {
    const project = (await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        calendar: {
          select: {
            workdays: true,
            workdayHours: true,
            holidays: { select: { date: true, recurring: true } },
          },
        },
      },
    })) as ProjectWithCalendar | null
    if (project?.calendar) {
      const wh =
        typeof project.calendar.workdayHours === 'object' &&
        project.calendar.workdayHours !== null
          ? Number(project.calendar.workdayHours.toString())
          : Number(project.calendar.workdayHours)
      return {
        workdays: project.calendar.workdays,
        holidays: project.calendar.holidays,
        workdayHours: Number.isFinite(wh) ? wh : 8,
      }
    }
  } catch {
    /* fallback */
  }
  return {
    workdays: DEFAULT_WORKDAYS_BITMASK,
    holidays: [],
    workdayHours: 8,
  }
}

/**
 * Carga el WorkloadResult + CapacityResult del proyecto en el rango pedido,
 * calcula sugerencias de rebalanceo y serializa todo a forma plana JSON
 * para client components.
 */
export async function getProjectWorkload(input: {
  projectId: string
  rangeStart: string
  rangeEnd: string
}): Promise<SerializableWorkloadResponse> {
  await requireProjectAccess(input.projectId)
  const parsed = workloadQuerySchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }
  const rangeStart = new Date(parsed.data.rangeStart)
  const rangeEnd = new Date(parsed.data.rangeEnd)
  if (rangeStart.getTime() > rangeEnd.getTime()) {
    actionError('INVALID_INPUT', 'rangeStart debe ser <= rangeEnd')
  }

  const calendar = await loadProjectCalendar(parsed.data.projectId)

  // Cargar tasks asignadas con startDate/endDate dentro del rango.
  const tasksDb = await prisma.task.findMany({
    where: {
      projectId: parsed.data.projectId,
      archivedAt: null,
      assigneeId: { not: null },
      startDate: { not: null, lte: rangeEnd },
      endDate: { not: null, gte: rangeStart },
    },
    select: {
      id: true,
      title: true,
      assigneeId: true,
      startDate: true,
      endDate: true,
      dailyEffortHours: true,
      priority: true,
      project: { select: { name: true } },
      assignee: { select: { id: true, name: true } },
    },
  })

  const userMap = new Map<string, { id: string; name: string }>()
  const tasksInput: WorkloadTaskInput[] = []
  for (const t of tasksDb) {
    if (!t.assignee || !t.startDate || !t.endDate) continue
    userMap.set(t.assignee.id, { id: t.assignee.id, name: t.assignee.name })
    tasksInput.push({
      id: t.id,
      title: t.title,
      assigneeId: t.assignee.id,
      startDate: t.startDate,
      endDate: t.endDate,
      dailyEffortHours: t.dailyEffortHours,
      projectName: t.project?.name,
    })
  }
  const userIds = Array.from(userMap.keys()).sort()

  // Sprint overrides: si hay sprint vigente que cae en el rango,
  // mergeamos `capacityPerUser`. Si no, vacío.
  let overrides: CapacityOverrideMap = {}
  try {
    type SprintRow = { capacityPerUser: unknown | null }
    const sprintRow = (await (prisma as unknown as {
      sprint: {
        findFirst: (a: unknown) => Promise<SprintRow | null>
      }
    }).sprint.findFirst({
      where: {
        projectId: parsed.data.projectId,
        startDate: { lte: rangeEnd },
        endDate: { gte: rangeStart },
      },
      select: { capacityPerUser: true },
      orderBy: { startDate: 'desc' },
    })) ?? null
    if (sprintRow?.capacityPerUser) {
      overrides = parseCapacityOverrides(sprintRow.capacityPerUser)
    }
  } catch {
    /* sprint table issue: proceed without overrides */
  }

  const workload: WorkloadResult = computeWorkload({
    userIds,
    tasks: tasksInput,
    rangeStart,
    rangeEnd,
    defaultDailyEffortHours: calendar.workdayHours,
    capacityByUser: undefined,
  })

  const capacity: CapacityResult = computeCapacity({
    userIds,
    rangeStart,
    rangeEnd,
    calendar,
    workdayHours: calendar.workdayHours,
    overrides,
  })

  // Cargar UserSkills para suggester. Si la migración no se aplicó,
  // se queda vacío y rebalance no encuentra candidatos por skill.
  const userSkillsRows: UserSkillEntry[] = []
  try {
    const us = await getUserSkillModel().findMany({
      include: { skill: { select: { id: true, name: true } } },
    })
    for (const u of us) {
      if (!u.skill?.name) continue
      userSkillsRows.push({
        userId: u.userId,
        skillName: u.skill.name,
        level: u.level,
      })
    }
  } catch {
    /* skills no instalados aún */
  }

  const rebalanceTasks: RebalanceTask[] = tasksDb
    .filter((t) => t.assignee && t.startDate && t.endDate)
    .map((t) => ({
      id: t.id,
      title: t.title,
      assigneeId: t.assignee?.id ?? '',
      startDate: t.startDate as Date,
      endDate: t.endDate as Date,
      dailyEffortHours: t.dailyEffortHours,
      priority: t.priority,
      // primarySkill no se infiere aún (sin custom field "skill" por task);
      // la integración completa quedará para extender el TaskForm en P8.5.
    }))

  const rebalance = suggestRebalance({
    workload,
    capacity,
    tasks: rebalanceTasks,
    userSkills: userSkillsRows,
    defaultDailyEffortHours: calendar.workdayHours,
  })

  const entries: SerializableWorkloadEntry[] = workload.byUser.map((w) => {
    const cap = capacity.byUser.find((c) => c.userId === w.userId)
    const userName = userMap.get(w.userId)?.name ?? w.userId
    return {
      userId: w.userId,
      userName,
      dailyLoad: Array.from(w.dailyLoad).map(([date, hours]) => ({ date, hours })),
      dailyCapacity: cap
        ? Array.from(cap.dailyCapacity).map(([date, hours]) => ({ date, hours }))
        : [],
      contributionsByDay: w.dailyDetail.map((d) => ({
        date: d.date,
        items: d.contributions.map((c) => ({
          taskId: c.taskId,
          taskTitle: c.taskTitle,
          hours: c.hours,
        })),
      })),
      totalOverloadHours: w.totalOverloadHours,
      totalOverloadDays: w.totalOverloadDays,
      peakDailyHours: w.peakDailyHours,
    }
  })

  return {
    rangeStart: toIsoDay(rangeStart),
    rangeEnd: toIsoDay(rangeEnd),
    days: workload.days,
    entries,
    rebalanceSuggestions: rebalance.suggestions,
    rebalanceUnresolved: rebalance.unresolved,
  }
}

// ───────────────────────── Queries: AvailableUsers ─────────────────────────

export interface AvailableUserResult {
  userId: string
  userName: string
  level: number | null
  slack: number
}

/**
 * Devuelve la lista de usuarios disponibles en una fecha dada con la
 * skill y nivel mínimo solicitados, ordenados por mayor slack.
 *
 * "Disponible" = capacidad > 0 ese día Y (capacity - load) >= requiredHours.
 *
 * Si no se pasa `skillId` ⇒ no filtra por skill (sólo capacidad).
 * Si no se pasa `projectId` ⇒ no filtra por asignación.
 */
export async function listAvailableUsers(input: {
  date: string
  skillId?: string
  minLevel?: number
  requiredHours?: number
  projectId?: string
}): Promise<AvailableUserResult[]> {
  await requireUser()
  const parsed = availableUsersSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }
  const dayDate = new Date(`${parsed.data.date}T00:00:00.000Z`)
  if (Number.isNaN(dayDate.getTime())) {
    actionError('INVALID_INPUT', 'Fecha inválida')
  }
  const required = parsed.data.requiredHours ?? 0
  const minLevel = parsed.data.minLevel ?? 1

  // Filtrar usuarios candidatos.
  let users: Array<{ id: string; name: string }>
  if (parsed.data.projectId) {
    const assignments = await prisma.projectAssignment.findMany({
      where: { projectId: parsed.data.projectId },
      include: { user: { select: { id: true, name: true } } },
    })
    users = assignments
      .filter((a) => Boolean(a.user))
      .map((a) => ({ id: a.user.id, name: a.user.name }))
  } else {
    users = await prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  }

  // Filtrar por skill si aplica.
  let levelByUser = new Map<string, number>()
  if (parsed.data.skillId) {
    try {
      const us = await getUserSkillModel().findMany({
        where: { skillId: parsed.data.skillId },
      })
      levelByUser = new Map(us.map((u) => [u.userId, u.level]))
      users = users.filter((u) => {
        const lvl = levelByUser.get(u.id) ?? 0
        return lvl >= minLevel
      })
    } catch {
      // Sin tabla ⇒ ningún usuario tiene la skill.
      return []
    }
  }

  if (users.length === 0) return []

  // Cargar carga del día y capacidad.
  const userIds = users.map((u) => u.id)
  const calendar: CalendarLoaded = parsed.data.projectId
    ? await loadProjectCalendar(parsed.data.projectId)
    : {
        workdays: DEFAULT_WORKDAYS_BITMASK,
        holidays: [],
        workdayHours: 8,
      }

  const tasksDb = await prisma.task.findMany({
    where: {
      assigneeId: { in: userIds },
      archivedAt: null,
      startDate: { not: null, lte: dayDate },
      endDate: { not: null, gte: dayDate },
    },
    select: {
      id: true,
      title: true,
      assigneeId: true,
      startDate: true,
      endDate: true,
      dailyEffortHours: true,
    },
  })

  const tasksInput: WorkloadTaskInput[] = tasksDb
    .filter((t) => t.assigneeId && t.startDate && t.endDate)
    .map((t) => ({
      id: t.id,
      title: t.title,
      assigneeId: t.assigneeId as string,
      startDate: t.startDate as Date,
      endDate: t.endDate as Date,
      dailyEffortHours: t.dailyEffortHours,
    }))

  const workload = computeWorkload({
    userIds,
    tasks: tasksInput,
    rangeStart: dayDate,
    rangeEnd: dayDate,
    defaultDailyEffortHours: calendar.workdayHours,
  })
  const capacity = computeCapacity({
    userIds,
    rangeStart: dayDate,
    rangeEnd: dayDate,
    calendar,
    workdayHours: calendar.workdayHours,
  })

  const dayIso = parsed.data.date
  const out: AvailableUserResult[] = []
  for (const user of users) {
    const wRow = workload.byUser.find((w) => w.userId === user.id)
    const cRow = capacity.byUser.find((c) => c.userId === user.id)
    const load = wRow?.dailyLoad.get(dayIso) ?? 0
    const cap = cRow?.dailyCapacity.get(dayIso) ?? 0
    const slack = cap - load
    if (cap <= 0) continue
    if (slack < required) continue
    out.push({
      userId: user.id,
      userName: user.name,
      level: levelByUser.get(user.id) ?? null,
      slack,
    })
  }

  out.sort((a, b) => {
    if ((b.level ?? 0) !== (a.level ?? 0)) return (b.level ?? 0) - (a.level ?? 0)
    if (b.slack !== a.slack) return b.slack - a.slack
    return a.userName.localeCompare(b.userName)
  })

  return out
}

// ───────────────────────── Sprint capacity overrides ─────────────────────────

const sprintCapacitySchema = z.object({
  sprintId: z.string().min(1),
  /**
   * Map<userId, { dailyHours?, off? }>. `off` debe ser lista YYYY-MM-DD.
   */
  overrides: z.record(
    z.string().min(1),
    z.object({
      dailyHours: z.number().min(0).max(24).optional(),
      off: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
    }),
  ),
})

export async function setSprintCapacityOverrides(input: {
  sprintId: string
  overrides: CapacityOverrideMap
}) {
  await requireUser()
  const parsed = sprintCapacitySchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }
  try {
    await (prisma as unknown as {
      sprint: { update: (a: unknown) => Promise<unknown> }
    }).sprint.update({
      where: { id: parsed.data.sprintId },
      data: { capacityPerUser: parsed.data.overrides },
    })
    revalidateRoutes()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('P2025')) {
      actionError('INVALID_INPUT', `Sprint ${input.sprintId} no existe`)
    }
    throw err
  }
}
