'use server'

/**
 * Wave P10 (HU-10.2 · BETA-1.2) — Server actions para `UserAvailability`.
 *
 * Cubre alta/edición/baja de bloques de no-disponibilidad por usuario y un
 * helper de bulk import de holidays sobre el `WorkCalendar` existente
 * (Ola P1.5). Se mantiene la convención de errores tipados `[CODE] detalle`
 * usada por `calendars.ts`/`dor-dod.ts`.
 */

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { recordAuditEventSafe } from '@/lib/audit/events'

export type AvailabilityErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_RANGE'
  | 'OVERLAP'

function actionError(code: AvailabilityErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

function revalidateAvailabilityViews() {
  revalidatePath('/workload')
  revalidatePath('/portfolio/allocation')
  revalidatePath('/projects')
}

function toUtcMidnight(input: Date | string): Date {
  const d = input instanceof Date ? new Date(input) : new Date(input)
  if (Number.isNaN(d.getTime())) {
    actionError('INVALID_INPUT', 'fecha inválida')
  }
  d.setUTCHours(0, 0, 0, 0)
  return d
}

const reasonEnum = z.enum([
  'VACATION',
  'SICK',
  'TRAINING',
  'REDUCED_HOURS',
  'OTHER',
])

const availabilityCreateSchema = z.object({
  userId: z.string().min(1),
  startDate: z.union([z.string(), z.date()]),
  endDate: z.union([z.string(), z.date()]),
  reason: reasonEnum,
  reducedHoursPercent: z.number().int().min(0).max(100).nullable().optional(),
  notes: z.string().max(500).optional(),
})

const availabilityPatchSchema = availabilityCreateSchema.partial().extend({
  id: z.string().min(1),
})

export interface CreateAvailabilityInput {
  userId: string
  startDate: Date | string
  endDate: Date | string
  reason: 'VACATION' | 'SICK' | 'TRAINING' | 'REDUCED_HOURS' | 'OTHER'
  reducedHoursPercent?: number | null
  notes?: string
}

/** HU-10.2 · alta de bloque de no-disponibilidad. */
export async function createAvailability(input: CreateAvailabilityInput) {
  const parsed = availabilityCreateSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)

  const start = toUtcMidnight(input.startDate)
  const end = toUtcMidnight(input.endDate)
  if (start.getTime() > end.getTime()) {
    actionError('INVALID_RANGE', 'startDate debe ser ≤ endDate')
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true },
  })
  if (!user) actionError('NOT_FOUND', 'usuario no existe')

  const created = await prisma.userAvailability.create({
    data: {
      userId: input.userId,
      startDate: start,
      endDate: end,
      reason: input.reason,
      reducedHoursPercent: input.reducedHoursPercent ?? null,
      notes: input.notes ?? null,
    },
  })

  await recordAuditEventSafe({
    action: 'user.availability_added',
    entityType: 'user',
    entityId: input.userId,
    after: {
      id: created.id,
      reason: created.reason,
      startDate: created.startDate.toISOString(),
      endDate: created.endDate.toISOString(),
      reducedHoursPercent: created.reducedHoursPercent,
    },
  })

  revalidateAvailabilityViews()
  return created
}

export interface UpdateAvailabilityInput {
  id: string
  startDate?: Date | string
  endDate?: Date | string
  reason?: 'VACATION' | 'SICK' | 'TRAINING' | 'REDUCED_HOURS' | 'OTHER'
  reducedHoursPercent?: number | null
  notes?: string
}

/** HU-10.2 · edición de bloque existente. */
export async function updateAvailability(input: UpdateAvailabilityInput) {
  const parsed = availabilityPatchSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)

  const before = await prisma.userAvailability.findUnique({
    where: { id: input.id },
  })
  if (!before) actionError('NOT_FOUND', 'bloque no existe')

  const start = input.startDate ? toUtcMidnight(input.startDate) : before.startDate
  const end = input.endDate ? toUtcMidnight(input.endDate) : before.endDate
  if (start.getTime() > end.getTime()) {
    actionError('INVALID_RANGE', 'startDate debe ser ≤ endDate')
  }

  const updated = await prisma.userAvailability.update({
    where: { id: input.id },
    data: {
      startDate: start,
      endDate: end,
      reason: input.reason ?? before.reason,
      reducedHoursPercent:
        input.reducedHoursPercent === undefined
          ? before.reducedHoursPercent
          : input.reducedHoursPercent,
      notes: input.notes === undefined ? before.notes : input.notes,
    },
  })

  await recordAuditEventSafe({
    action: 'user.availability_updated',
    entityType: 'user',
    entityId: before.userId,
    before: {
      reason: before.reason,
      startDate: before.startDate.toISOString(),
      endDate: before.endDate.toISOString(),
      reducedHoursPercent: before.reducedHoursPercent,
    },
    after: {
      reason: updated.reason,
      startDate: updated.startDate.toISOString(),
      endDate: updated.endDate.toISOString(),
      reducedHoursPercent: updated.reducedHoursPercent,
    },
  })

  revalidateAvailabilityViews()
  return updated
}

/** HU-10.2 · baja de bloque (hard delete; histórico vive en auditoría). */
export async function deleteAvailability(id: string) {
  if (!id) actionError('INVALID_INPUT', 'id requerido')

  const before = await prisma.userAvailability.findUnique({ where: { id } })
  if (!before) actionError('NOT_FOUND', 'bloque no existe')

  await prisma.userAvailability.delete({ where: { id } })

  await recordAuditEventSafe({
    action: 'user.availability_removed',
    entityType: 'user',
    entityId: before.userId,
    before: {
      id: before.id,
      reason: before.reason,
      startDate: before.startDate.toISOString(),
      endDate: before.endDate.toISOString(),
    },
  })

  revalidateAvailabilityViews()
  return { ok: true as const }
}

/** HU-10.2 · listar bloques de un usuario en un rango (incluye solapamientos). */
export async function listAvailabilityForUser(input: {
  userId: string
  from?: Date | string
  to?: Date | string
}) {
  if (!input.userId) actionError('INVALID_INPUT', 'userId requerido')

  const where: {
    userId: string
    AND?: Array<Record<string, unknown>>
  } = { userId: input.userId }

  if (input.from || input.to) {
    where.AND = []
    if (input.from) {
      where.AND.push({ endDate: { gte: toUtcMidnight(input.from) } })
    }
    if (input.to) {
      where.AND.push({ startDate: { lte: toUtcMidnight(input.to) } })
    }
  }

  return prisma.userAvailability.findMany({
    where,
    orderBy: { startDate: 'asc' },
  })
}

// ────────────── Bulk import holidays (HU-10.2 · BETA-1.5 — split helper) ──────────────

const holidayBulkRowSchema = z.object({
  date: z.union([z.string(), z.date()]),
  name: z.string().min(1).max(80),
  recurring: z.boolean().optional(),
})

const holidayBulkSchema = z.object({
  calendarId: z.string().min(1),
  rows: z.array(holidayBulkRowSchema).min(1).max(1000),
})

export interface BulkImportHolidaysInput {
  calendarId: string
  rows: Array<{
    date: Date | string
    name: string
    recurring?: boolean
  }>
}

/**
 * HU-10.2 · BETA-1.5 — Importa N holidays a un `WorkCalendar` existente.
 *
 * Idempotente sobre `(calendarId, date)`: filas con misma fecha se hacen
 * upsert (actualiza nombre/recurring). Devuelve `{created, updated}`.
 */
export async function bulkImportHolidays(input: BulkImportHolidaysInput) {
  const parsed = holidayBulkSchema.safeParse(input)
  if (!parsed.success) actionError('INVALID_INPUT', parsed.error.message)

  const cal = await prisma.workCalendar.findUnique({
    where: { id: input.calendarId },
    select: { id: true },
  })
  if (!cal) actionError('NOT_FOUND', 'calendario no existe')

  // P17-A · N+1 fix: la versión previa hacía 2 queries por fila
  // (findUnique + update/create). Ahora cargamos los existentes en
  // una sola query y aplicamos updates/creates en bulk vía
  // `updateMany` por id e `createMany` con skipDuplicates.
  const normalizedRows = input.rows.map((row) => ({
    ...row,
    date: toUtcMidnight(row.date),
  }))

  const existingHolidays = await prisma.holiday.findMany({
    where: {
      calendarId: input.calendarId,
      date: { in: normalizedRows.map((r) => r.date) },
    },
    select: { id: true, date: true },
  })
  const existingByDate = new Map<number, string>(
    existingHolidays.map((h) => [h.date.getTime(), h.id]),
  )

  const toCreate: Array<{
    calendarId: string
    date: Date
    name: string
    recurring: boolean
  }> = []
  const toUpdate: Array<{
    id: string
    name: string
    recurring: boolean
  }> = []

  for (const row of normalizedRows) {
    const existingId = existingByDate.get(row.date.getTime())
    if (existingId) {
      toUpdate.push({
        id: existingId,
        name: row.name,
        recurring: row.recurring ?? false,
      })
    } else {
      toCreate.push({
        calendarId: input.calendarId,
        date: row.date,
        name: row.name,
        recurring: row.recurring ?? false,
      })
    }
  }

  // Bulk create (1 round-trip) y bulk updates en transacción.
  await prisma.$transaction(async (tx) => {
    if (toCreate.length > 0) {
      await tx.holiday.createMany({ data: toCreate, skipDuplicates: true })
    }
    // updateMany no acepta diferentes data por row — agrupamos por
    // (name, recurring) para minimizar round-trips. En el peor caso
    // cae a M queries donde M = grupos únicos << N filas originales.
    const updateGroups = new Map<
      string,
      { ids: string[]; name: string; recurring: boolean }
    >()
    for (const u of toUpdate) {
      const key = `${u.name} ${u.recurring}`
      const g = updateGroups.get(key)
      if (g) g.ids.push(u.id)
      else
        updateGroups.set(key, {
          ids: [u.id],
          name: u.name,
          recurring: u.recurring,
        })
    }
    for (const g of updateGroups.values()) {
      await tx.holiday.updateMany({
        where: { id: { in: g.ids } },
        data: { name: g.name, recurring: g.recurring },
      })
    }
  })

  const created = toCreate.length
  const updated = toUpdate.length

  await recordAuditEventSafe({
    action: 'calendar.holidays_imported',
    entityType: 'calendar',
    entityId: input.calendarId,
    after: { created, updated, total: input.rows.length },
  })

  revalidateAvailabilityViews()
  revalidatePath('/settings/calendars')
  return { created, updated }
}

// Presets MX (`buildMxFixedHolidayRows`, `buildMxMovableHolidayRows`,
// `buildMxAllHolidayRows`) viven en `@/lib/calendar/mx-presets` para
// respetar la regla `'use server'` (sólo async functions exportables).
