'use server'

/**
 * Server actions para `WorkCalendar` y sus `Holiday[]` (Ola P1.5).
 *
 * Convenciones:
 *  - Errores tipados `[CODE] detalle` (alineado con `reorder.ts`/`schedule.ts`).
 *  - Validación con zod + normalización de fechas a UTC midnight.
 *  - Borrado de calendar bloqueado si tiene proyectos asignados ⇒ `[CALENDAR_IN_USE]`.
 *  - Tras mutar, `revalidatePath` de las rutas afectadas (settings + Gantt + workload).
 */

import { z } from 'zod'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'

export type CalendarErrorCode =
  | 'CALENDAR_NOT_FOUND'
  | 'INVALID_HOLIDAY'
  | 'CALENDAR_IN_USE'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'

function actionError(code: CalendarErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

function revalidateCalendarRoutes() {
  revalidatePath('/settings/calendars')
  revalidatePath('/gantt')
  revalidatePath('/workload')
}

/** Normaliza `Date | string` a UTC midnight. */
function toUtcMidnight(input: Date | string): Date {
  const d = input instanceof Date ? new Date(input) : new Date(input)
  if (Number.isNaN(d.getTime())) {
    actionError('INVALID_HOLIDAY', 'fecha inválida')
  }
  d.setUTCHours(0, 0, 0, 0)
  return d
}

// ────────────── Schemas zod ──────────────

const calendarCreateSchema = z.object({
  name: z.string().min(1).max(80),
  isDefault: z.boolean().optional(),
  workdays: z
    .number()
    .int()
    .min(0)
    .max(127) // bitmask 7 bits
    .optional(),
  workdayHours: z.number().positive().max(24).optional(),
})

const calendarPatchSchema = calendarCreateSchema.partial()

const holidayCreateSchema = z.object({
  date: z.union([z.string(), z.date()]),
  name: z.string().min(1).max(80),
  recurring: z.boolean().optional(),
})

// ────────────── CRUD WorkCalendar ──────────────

export interface CreateCalendarInput {
  name: string
  isDefault?: boolean
  workdays?: number
  workdayHours?: number
}

export async function createCalendar(input: CreateCalendarInput) {
  const parsed = calendarCreateSchema.safeParse(input)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }

  // Si marcamos isDefault=true, desmarcar el resto en una transacción
  // para mantener el invariante "máximo 1 default por organización".
  const data = parsed.data
  const created = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await (tx as unknown as {
        workCalendar: { updateMany: (a: unknown) => Promise<unknown> }
      }).workCalendar.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      })
    }
    return await (tx as unknown as {
      workCalendar: { create: (a: unknown) => Promise<{ id: string }> }
    }).workCalendar.create({
      data: {
        name: data.name,
        isDefault: data.isDefault ?? false,
        workdays: data.workdays ?? 31,
        workdayHours: data.workdayHours ?? 8.0,
      },
    })
  })

  revalidateCalendarRoutes()
  return created
}

export async function updateCalendar(
  id: string,
  patch: Partial<CreateCalendarInput>,
) {
  if (!id) actionError('CALENDAR_NOT_FOUND', 'id requerido')
  const parsed = calendarPatchSchema.safeParse(patch)
  if (!parsed.success) {
    actionError('INVALID_INPUT', parsed.error.message)
  }

  const data = parsed.data
  await prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await (tx as unknown as {
        workCalendar: { updateMany: (a: unknown) => Promise<unknown> }
      }).workCalendar.updateMany({
        where: { isDefault: true, NOT: { id } },
        data: { isDefault: false },
      })
    }
    await (tx as unknown as {
      workCalendar: {
        update: (a: unknown) => Promise<unknown>
      }
    }).workCalendar.update({
      where: { id },
      data,
    })
  })

  revalidateCalendarRoutes()
  return { ok: true as const }
}

export async function deleteCalendar(id: string) {
  if (!id) actionError('CALENDAR_NOT_FOUND', 'id requerido')

  // Bloquear el borrado si hay proyectos referenciando este calendar.
  const projectCount = await (prisma as unknown as {
    project: { count: (a: unknown) => Promise<number> }
  }).project.count({ where: { calendarId: id } })
  if (projectCount > 0) {
    actionError(
      'CALENDAR_IN_USE',
      `${projectCount} proyecto(s) usan este calendario`,
    )
  }

  await (prisma as unknown as {
    workCalendar: { delete: (a: unknown) => Promise<unknown> }
  }).workCalendar.delete({ where: { id } })

  revalidateCalendarRoutes()
  return { ok: true as const }
}

export async function getCalendarsForOrg() {
  const list = await (prisma as unknown as {
    workCalendar: {
      findMany: (a: unknown) => Promise<
        Array<{
          id: string
          name: string
          isDefault: boolean
          workdays: number
          workdayHours: unknown // Decimal serializable
          holidays: Array<{
            id: string
            date: Date
            name: string
            recurring: boolean
          }>
          _count?: { projects: number }
        }>
      >
    }
  }).workCalendar.findMany({
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    include: {
      holidays: { orderBy: { date: 'asc' } },
      _count: { select: { projects: true } },
    },
  })
  // Normalizar Decimal → number para serialización al cliente.
  return list.map((c) => ({
    ...c,
    workdayHours:
      typeof c.workdayHours === 'object' && c.workdayHours !== null
        ? Number(c.workdayHours.toString())
        : Number(c.workdayHours),
    projectCount: c._count?.projects ?? 0,
  }))
}

// ────────────── Holidays ──────────────

export async function addHoliday(
  calendarId: string,
  date: Date | string,
  name: string,
  recurring = false,
) {
  if (!calendarId) actionError('CALENDAR_NOT_FOUND', 'calendarId requerido')
  const parsed = holidayCreateSchema.safeParse({ date, name, recurring })
  if (!parsed.success) {
    actionError('INVALID_HOLIDAY', parsed.error.message)
  }
  const utcDate = toUtcMidnight(parsed.data.date)
  const created = await (prisma as unknown as {
    holiday: {
      create: (a: unknown) => Promise<{ id: string }>
    }
  }).holiday.create({
    data: {
      calendarId,
      date: utcDate,
      name: parsed.data.name,
      recurring: parsed.data.recurring ?? false,
    },
  })
  revalidateCalendarRoutes()
  return created
}

export async function removeHoliday(holidayId: string) {
  if (!holidayId) actionError('NOT_FOUND', 'holidayId requerido')
  await (prisma as unknown as {
    holiday: { delete: (a: unknown) => Promise<unknown> }
  }).holiday.delete({ where: { id: holidayId } })
  revalidateCalendarRoutes()
  return { ok: true as const }
}

// ────────────── Asignación a Project ──────────────

export async function assignCalendarToProject(
  projectId: string,
  calendarId: string | null,
) {
  if (!projectId) actionError('NOT_FOUND', 'projectId requerido')

  if (calendarId) {
    const exists = await (prisma as unknown as {
      workCalendar: { findUnique: (a: unknown) => Promise<unknown | null> }
    }).workCalendar.findUnique({ where: { id: calendarId } })
    if (!exists) {
      actionError('CALENDAR_NOT_FOUND', `calendarId=${calendarId} inexistente`)
    }
  }

  await (prisma as unknown as {
    project: { update: (a: unknown) => Promise<unknown> }
  }).project.update({
    where: { id: projectId },
    data: { calendarId: calendarId ?? null },
  })

  // Invalidar caches CPM dado que cambió la base temporal.
  try {
    const mod = await import('@/lib/scheduling/invalidate')
    if (typeof mod.invalidateCpmCache === 'function') {
      await mod.invalidateCpmCache(projectId)
    }
  } catch {
    /* invalidate opcional */
  }

  revalidateCalendarRoutes()
  return { ok: true as const }
}
