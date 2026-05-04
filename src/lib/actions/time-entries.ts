'use server'

/**
 * Ola P1 · Equipo 4 — Time Tracking + Timesheets.
 *
 * Server actions para registrar tiempo trabajado en tareas. Cubre dos
 * flujos:
 *   1. Timer en vivo: `startTimer` crea un entry con `endedAt = null`,
 *      `stopTimer` lo cierra, calcula `durationMinutes` y `cost` con la
 *      tarifa vigente del usuario (snapshot).
 *   2. Entry manual: `createManualEntry` recibe rango cerrado
 *      (`startedAt`, `endedAt`) y duplica el cálculo.
 *
 * Tras cerrar/crear/editar/borrar, el agregado de costos del task se
 * recalcula con `updateTaskActualCost`, sumando todos los entries con
 * `cost != null`. Esto reemplaza el `actualCost` estimado por el real
 * para EVM (HU-2.1+).
 *
 * Convenciones:
 *   - Errores tipados: `[CODE] detalle legible` — el cliente parsea el
 *     prefijo y muestra el detalle en toast.
 *   - Sin sesión real: el caller pasa `userId` explícito (mismo patrón
 *     que `collaborators.ts`).
 *   - `revalidatePath` para invalidar la lista del task y la vista de
 *     timesheets.
 */

import { z } from 'zod'
import { revalidatePath, revalidateTag, unstable_cache } from 'next/cache'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/prisma'

// ───────────────────────── Errores tipados ─────────────────────────

export type TimeEntryErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'TIMER_ALREADY_RUNNING'
  | 'NO_ACTIVE_TIMER'
  | 'INVALID_RANGE'
  | 'FORBIDDEN'

function actionError(code: TimeEntryErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Tipos serializados ──────────────────────
//
// Decimal de Prisma no se serializa cleanly al cliente; convertimos a
// number con precisión de centavo (el modelo usa Decimal(12,2) → 2
// decimales son seguros en double).

export interface SerializedTimeEntry {
  id: string
  userId: string
  taskId: string
  startedAt: string
  endedAt: string | null
  durationMinutes: number
  description: string | null
  hourlyRate: number | null
  cost: number | null
  createdAt: string
}

type RawEntry = {
  id: string
  userId: string
  taskId: string
  startedAt: Date
  endedAt: Date | null
  durationMinutes: number
  description: string | null
  hourlyRate: Prisma.Decimal | null
  cost: Prisma.Decimal | null
  createdAt: Date
}

function toNumberOrNull(d: Prisma.Decimal | null): number | null {
  if (d == null) return null
  // Prisma.Decimal tiene `toNumber()`. Si recibimos un objeto plain
  // (algunos adapters lo serializan como string), usamos Number().
  if (typeof (d as unknown as { toNumber?: () => number }).toNumber === 'function') {
    return (d as unknown as { toNumber: () => number }).toNumber()
  }
  return Number(d)
}

function serializeEntry(e: RawEntry): SerializedTimeEntry {
  return {
    id: e.id,
    userId: e.userId,
    taskId: e.taskId,
    startedAt: e.startedAt.toISOString(),
    endedAt: e.endedAt ? e.endedAt.toISOString() : null,
    durationMinutes: e.durationMinutes,
    description: e.description,
    hourlyRate: toNumberOrNull(e.hourlyRate),
    cost: toNumberOrNull(e.cost),
    createdAt: e.createdAt.toISOString(),
  }
}

// ───────────────────────── Helpers de cálculo ──────────────────────

/**
 * Devuelve los minutos completos entre dos fechas (redondeo down).
 * Internamente usamos `Math.max(0, …)` para evitar negativos por
 * pequeños desbordes de zona horaria; el invariante de rango se
 * valida antes con `[INVALID_RANGE]`.
 */
function diffMinutes(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime()
  return Math.max(0, Math.floor(ms / 60_000))
}

/**
 * Busca la tarifa horaria vigente del usuario al momento `at`.
 * Una tarifa es vigente si `validFrom <= at` y (`validUntil = null`
 * o `validUntil > at`). Retorna `null` si no hay tarifa configurada
 * — el entry se persiste sin `cost` (no rompe el flujo).
 */
async function getEffectiveHourlyRate(
  userId: string,
  at: Date,
): Promise<Prisma.Decimal | null> {
  const row = await prisma.userHourlyRate.findFirst({
    where: {
      userId,
      validFrom: { lte: at },
      OR: [{ validUntil: null }, { validUntil: { gt: at } }],
    },
    orderBy: { validFrom: 'desc' },
    select: { rate: true },
  })
  return row?.rate ?? null
}

/**
 * Recalcula `Task.actualCost` sumando los `cost` de todos los entries
 * cerrados (con cost != null) del task. Se invoca tras cada mutación
 * que altera el agregado: stopTimer, createManualEntry, updateEntry,
 * deleteEntry. Ignora entries activos (`endedAt = null`) porque su
 * costo aún no es definitivo.
 */
async function updateTaskActualCost(taskId: string): Promise<void> {
  const agg = await prisma.timeEntry.aggregate({
    where: { taskId, endedAt: { not: null }, cost: { not: null } },
    _sum: { cost: true },
  })
  const total = agg._sum.cost ? toNumberOrNull(agg._sum.cost) : 0
  await prisma.task.update({
    where: { id: taskId },
    data: { actualCost: total ?? 0 },
  })
}

// ───────────────────────── Cache: timer activo ─────────────────────
//
// El widget flotante consulta el timer activo en cada montaje de
// drawer. Cacheamos por usuario (tag `active-timer:<userId>`) e
// invalidamos en start/stop/cancel. El TTL implícito es la vida del
// proceso — la invalidación explícita garantiza coherencia.

function getActiveTimerCached(userId: string) {
  return unstable_cache(
    async (id: string) => {
      const row = await prisma.timeEntry.findFirst({
        where: { userId: id, endedAt: null },
        orderBy: { startedAt: 'desc' },
      })
      return row ? serializeEntry(row as RawEntry) : null
    },
    ['active-timer-by-user', userId],
    { tags: [`active-timer:${userId}`] },
  )(userId)
}

async function invalidateActiveTimer(userId: string): Promise<void> {
  if (!userId) return
  revalidateTag(`active-timer:${userId}`, 'max')
}

// ───────────────────────── Schemas ─────────────────────────────────

const ID_SCHEMA = z.string().min(1)
const DESCRIPTION_SCHEMA = z.string().max(500).nullable().optional()

const startTimerSchema = z.object({
  userId: ID_SCHEMA,
  taskId: ID_SCHEMA,
})

const stopTimerSchema = z.object({
  entryId: ID_SCHEMA,
  description: DESCRIPTION_SCHEMA,
})

const cancelSchema = z.object({
  userId: ID_SCHEMA,
})

const manualEntrySchema = z.object({
  userId: ID_SCHEMA,
  taskId: ID_SCHEMA,
  startedAt: z.union([z.string(), z.date()]),
  endedAt: z.union([z.string(), z.date()]),
  description: DESCRIPTION_SCHEMA,
})

const updateEntrySchema = z.object({
  id: ID_SCHEMA,
  startedAt: z.union([z.string(), z.date()]).optional(),
  endedAt: z.union([z.string(), z.date()]).optional(),
  description: DESCRIPTION_SCHEMA,
})

const deleteSchema = z.object({ id: ID_SCHEMA })

export type StartTimerInput = z.input<typeof startTimerSchema>
export type StopTimerInput = z.input<typeof stopTimerSchema>
export type ManualEntryInput = z.input<typeof manualEntrySchema>
export type UpdateEntryInput = z.input<typeof updateEntrySchema>

// ───────────────────────── Server actions ──────────────────────────

/**
 * Inicia un timer. Rechaza si el usuario ya tiene uno activo
 * (`[TIMER_ALREADY_RUNNING]`) — debe detener o cancelar antes.
 * Retorna el entry serializado.
 */
export async function startTimer(
  input: StartTimerInput,
): Promise<SerializedTimeEntry> {
  const parsed = startTimerSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { userId, taskId } = parsed.data

  // Verificación de existencia (FK también rompe, pero el error sería
  // técnico — preferimos el código tipado para el toast).
  const [user, task] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.task.findUnique({ where: { id: taskId }, select: { id: true } }),
  ])
  if (!user) actionError('NOT_FOUND', 'usuario inexistente')
  if (!task) actionError('NOT_FOUND', 'tarea inexistente')

  const active = await prisma.timeEntry.findFirst({
    where: { userId, endedAt: null },
    select: { id: true },
  })
  if (active) {
    actionError('TIMER_ALREADY_RUNNING', 'Ya tienes un timer activo. Deténlo o cancélalo primero.')
  }

  const created = (await prisma.timeEntry.create({
    data: {
      userId,
      taskId,
      startedAt: new Date(),
      endedAt: null,
      durationMinutes: 0,
    },
  })) as RawEntry

  await invalidateActiveTimer(userId)
  revalidatePath(`/list`)
  revalidatePath(`/timesheets`)
  return serializeEntry(created)
}

/**
 * Detiene un timer activo: setea `endedAt = now`, calcula
 * `durationMinutes` y `cost` con la tarifa vigente. Si el entry no
 * existe o ya estaba cerrado, lanza `[NO_ACTIVE_TIMER]`.
 *
 * Tras cerrar, recalcula `Task.actualCost` para EVM.
 */
export async function stopTimer(
  input: StopTimerInput,
): Promise<SerializedTimeEntry> {
  const parsed = stopTimerSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { entryId, description } = parsed.data

  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      userId: true,
      taskId: true,
      startedAt: true,
      endedAt: true,
    },
  })
  if (!entry) actionError('NO_ACTIVE_TIMER', 'el entry no existe')
  if (entry.endedAt) {
    actionError('NO_ACTIVE_TIMER', 'el timer ya fue detenido')
  }

  const endedAt = new Date()
  if (endedAt.getTime() < entry.startedAt.getTime()) {
    // Defensa: si el reloj del servidor retrocede (NTP), forzamos
    // mínimo 1 minuto para no escribir duración negativa.
    actionError('INVALID_RANGE', 'la fecha de fin es anterior al inicio')
  }
  const durationMinutes = diffMinutes(entry.startedAt, endedAt)

  // Tarifa snapshot al momento del stop. Si no hay tarifa configurada,
  // persistimos `null` y el entry no contribuye a actualCost (Edwin
  // puede backfillear con `setUserHourlyRate` cuando defina tarifas).
  const rate = await getEffectiveHourlyRate(entry.userId, endedAt)
  const cost =
    rate != null
      ? rate.mul(new Prisma.Decimal(durationMinutes).div(60))
      : null

  const updated = (await prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      endedAt,
      durationMinutes,
      hourlyRate: rate,
      cost,
      ...(description !== undefined ? { description } : {}),
    },
  })) as RawEntry

  await updateTaskActualCost(entry.taskId)
  await invalidateActiveTimer(entry.userId)
  revalidatePath(`/list`)
  revalidatePath(`/timesheets`)
  return serializeEntry(updated)
}

/**
 * Cancela el timer activo del usuario (lo borra). Idempotente: si no
 * hay timer, retorna sin error.
 */
export async function cancelActiveTimer(input: {
  userId: string
}): Promise<{ ok: true }> {
  const parsed = cancelSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { userId } = parsed.data

  const active = await prisma.timeEntry.findFirst({
    where: { userId, endedAt: null },
    select: { id: true, taskId: true },
  })
  if (!active) {
    // Idempotente: nada que cancelar.
    return { ok: true as const }
  }

  await prisma.timeEntry.delete({ where: { id: active.id } })
  // No actualiza actualCost: el entry no había contribuido (cost == null
  // mientras corría). Pero invalida cache.
  await invalidateActiveTimer(userId)
  revalidatePath(`/list`)
  revalidatePath(`/timesheets`)
  return { ok: true as const }
}

/**
 * Devuelve el timer activo del usuario o `null`. Cacheado por usuario.
 */
export async function getActiveTimerForUser(
  userId: string,
): Promise<SerializedTimeEntry | null> {
  if (!userId) return null
  return getActiveTimerCached(userId)
}

/**
 * Crea una entrada manual con rango cerrado. Calcula duración y costo
 * con la tarifa vigente al `endedAt`. Recalcula `Task.actualCost`.
 *
 * Validaciones:
 *   - Inputs presentes y bien tipados → `[INVALID_INPUT]`.
 *   - `endedAt > startedAt` → `[INVALID_RANGE]`.
 *   - User/task existen → `[NOT_FOUND]`.
 */
export async function createManualEntry(
  input: ManualEntryInput,
): Promise<SerializedTimeEntry> {
  const parsed = manualEntrySchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { userId, taskId, description } = parsed.data
  const startedAt = new Date(parsed.data.startedAt as string | Date)
  const endedAt = new Date(parsed.data.endedAt as string | Date)
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    actionError('INVALID_INPUT', 'fechas inválidas')
  }
  if (endedAt.getTime() <= startedAt.getTime()) {
    actionError('INVALID_RANGE', 'la fecha de fin debe ser posterior al inicio')
  }

  const [user, task] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    prisma.task.findUnique({ where: { id: taskId }, select: { id: true } }),
  ])
  if (!user) actionError('NOT_FOUND', 'usuario inexistente')
  if (!task) actionError('NOT_FOUND', 'tarea inexistente')

  const durationMinutes = diffMinutes(startedAt, endedAt)
  const rate = await getEffectiveHourlyRate(userId, endedAt)
  const cost =
    rate != null
      ? rate.mul(new Prisma.Decimal(durationMinutes).div(60))
      : null

  const created = (await prisma.timeEntry.create({
    data: {
      userId,
      taskId,
      startedAt,
      endedAt,
      durationMinutes,
      description: description ?? null,
      hourlyRate: rate,
      cost,
    },
  })) as RawEntry

  await updateTaskActualCost(taskId)
  revalidatePath(`/list`)
  revalidatePath(`/timesheets`)
  return serializeEntry(created)
}

/**
 * Actualiza un entry existente (cerrado o activo). Si se modifica el
 * rango, recalcula `durationMinutes` y `cost` (esto último si el entry
 * está cerrado; los activos quedan en cost = null hasta el stop).
 */
export async function updateEntry(
  input: UpdateEntryInput,
): Promise<SerializedTimeEntry> {
  const parsed = updateEntrySchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { id, description } = parsed.data
  const startedAtRaw = parsed.data.startedAt
  const endedAtRaw = parsed.data.endedAt

  const existing = await prisma.timeEntry.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      taskId: true,
      startedAt: true,
      endedAt: true,
      hourlyRate: true,
      cost: true,
    },
  })
  if (!existing) actionError('NOT_FOUND', 'entry inexistente')

  const newStart = startedAtRaw ? new Date(startedAtRaw as string | Date) : existing.startedAt
  const newEnd = endedAtRaw
    ? new Date(endedAtRaw as string | Date)
    : existing.endedAt
  if (newStart && Number.isNaN(newStart.getTime())) {
    actionError('INVALID_INPUT', 'startedAt inválido')
  }
  if (newEnd && Number.isNaN(newEnd.getTime())) {
    actionError('INVALID_INPUT', 'endedAt inválido')
  }
  if (newEnd && newEnd.getTime() <= newStart.getTime()) {
    actionError('INVALID_RANGE', 'la fecha de fin debe ser posterior al inicio')
  }

  const data: {
    startedAt?: Date
    endedAt?: Date | null
    description?: string | null
    durationMinutes?: number
    hourlyRate?: Prisma.Decimal | null
    cost?: Prisma.Decimal | null
  } = {}

  if (startedAtRaw) data.startedAt = newStart
  if (endedAtRaw) data.endedAt = newEnd
  if (description !== undefined) data.description = description ?? null

  // Recalcula duración/costo solo si el entry está cerrado tras el patch.
  if (newEnd) {
    const durationMinutes = diffMinutes(newStart, newEnd)
    data.durationMinutes = durationMinutes
    const rate = await getEffectiveHourlyRate(existing.userId, newEnd)
    data.hourlyRate = rate
    data.cost =
      rate != null
        ? rate.mul(new Prisma.Decimal(durationMinutes).div(60))
        : null
  }

  const updated = (await prisma.timeEntry.update({
    where: { id },
    data,
  })) as RawEntry

  await updateTaskActualCost(existing.taskId)
  await invalidateActiveTimer(existing.userId)
  revalidatePath(`/list`)
  revalidatePath(`/timesheets`)
  return serializeEntry(updated)
}

/**
 * Borra un entry. Recalcula `actualCost` del task afectado.
 * Idempotente: si el id no existe, retorna sin error.
 */
export async function deleteEntry(input: { id: string }): Promise<{ ok: true }> {
  const parsed = deleteSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { id } = parsed.data

  const existing = await prisma.timeEntry.findUnique({
    where: { id },
    select: { id: true, taskId: true, userId: true },
  })
  if (!existing) return { ok: true as const }

  await prisma.timeEntry.delete({ where: { id } })
  await updateTaskActualCost(existing.taskId)
  await invalidateActiveTimer(existing.userId)
  revalidatePath(`/list`)
  revalidatePath(`/timesheets`)
  return { ok: true as const }
}

/**
 * Lista entries de una tarea, ordenados por inicio descendente.
 */
export async function getEntriesForTask(
  taskId: string,
): Promise<SerializedTimeEntry[]> {
  if (!taskId) return []
  const rows = await prisma.timeEntry.findMany({
    where: { taskId },
    orderBy: { startedAt: 'desc' },
  })
  return rows.map((r) => serializeEntry(r as RawEntry))
}

/**
 * Timesheet semanal de un usuario. `weekStart` es lunes 00:00 del
 * semana objetivo (en zona del servidor). Devuelve los entries dentro
 * del rango [weekStart, weekStart + 7d), totales agregados (minutos y
 * costo) y un breakdown por día (índice 0=Lun, 6=Dom).
 */
export async function getWeekTimesheet(
  userId: string,
  weekStart: Date | string,
): Promise<{
  entries: SerializedTimeEntry[]
  totalMinutes: number
  totalCost: number
  perDay: Array<{ date: string; minutes: number; cost: number }>
}> {
  if (!userId) {
    return { entries: [], totalMinutes: 0, totalCost: 0, perDay: [] }
  }
  const start = new Date(weekStart)
  if (Number.isNaN(start.getTime())) {
    actionError('INVALID_INPUT', 'weekStart inválido')
  }
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000)

  const rows = await prisma.timeEntry.findMany({
    where: {
      userId,
      startedAt: { gte: start, lt: end },
    },
    orderBy: { startedAt: 'asc' },
  })

  let totalMinutes = 0
  let totalCost = 0
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000)
    return { date: d.toISOString(), minutes: 0, cost: 0 }
  })

  const entries = rows.map((r) => {
    const e = serializeEntry(r as RawEntry)
    totalMinutes += e.durationMinutes
    totalCost += e.cost ?? 0
    const dayIdx = Math.floor(
      (r.startedAt.getTime() - start.getTime()) / (24 * 60 * 60 * 1000),
    )
    if (dayIdx >= 0 && dayIdx < 7) {
      perDay[dayIdx].minutes += e.durationMinutes
      perDay[dayIdx].cost += e.cost ?? 0
    }
    return e
  })

  return { entries, totalMinutes, totalCost, perDay }
}

// ───────────────────────── Tarifas (auxiliar) ──────────────────────
//
// Helper administrativo para definir/cerrar tarifas. No es UI-facing
// en esta entrega, pero las acciones existen para que tests y futuros
// agentes puedan poblar tarifas sin SQL directo.

const setRateSchema = z.object({
  userId: ID_SCHEMA,
  rate: z.number().positive(),
  validFrom: z.union([z.string(), z.date()]).optional(),
})

export async function setUserHourlyRate(input: {
  userId: string
  rate: number
  validFrom?: Date | string
}): Promise<{ id: string }> {
  const parsed = setRateSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.issues.map((i) => i.message).join('; '))
  }
  const { userId, rate } = parsed.data
  const validFrom = parsed.data.validFrom ? new Date(parsed.data.validFrom as string | Date) : new Date()

  // Cierra la tarifa vigente previa, si existe (validUntil = validFrom).
  await prisma.userHourlyRate.updateMany({
    where: { userId, validUntil: null },
    data: { validUntil: validFrom },
  })

  const created = await prisma.userHourlyRate.create({
    data: {
      userId,
      rate: new Prisma.Decimal(rate),
      validFrom,
      validUntil: null,
    },
    select: { id: true },
  })
  return created
}
