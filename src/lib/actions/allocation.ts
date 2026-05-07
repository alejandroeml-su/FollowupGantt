'use server'

/**
 * Wave P10 (HU-10.7 · BETA-2.4) — Server actions de allocation cross-project.
 *
 * `getAllocationForRange`: lee tasks activas + availability del rango y
 * devuelve los snapshots semanales por usuario. Read-only: NO persiste.
 *
 * `refreshAllocationSnapshots`: persiste los snapshots semanales en
 * `ResourceAllocationSnapshot` para acceso rápido futuro (cron-fed).
 */

import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import {
  computeUserWeeklyAllocations,
  weekStartMonday,
  type AllocationTaskInput,
  type WeeklyAllocationSnapshot,
} from '@/lib/allocation/compute'
import { recordAuditEventSafe } from '@/lib/audit/events'

const DEFAULT_CALENDAR = { workdays: 0b0011111, holidays: [] }

/**
 * Devuelve allocation por usuario para los próximos N días (default 28).
 * Sólo cubre usuarios con al menos una task activa en el rango.
 */
export async function getAllocationForRange(input: {
  from?: Date | string
  to?: Date | string
  daysAhead?: number
} = {}): Promise<WeeklyAllocationSnapshot[]> {
  const start = input.from
    ? new Date(input.from)
    : weekStartMonday(new Date())
  const daysAhead = input.daysAhead ?? 28
  const end = input.to
    ? new Date(input.to)
    : new Date(start.getTime() + daysAhead * 86_400_000)
  start.setUTCHours(0, 0, 0, 0)
  end.setUTCHours(0, 0, 0, 0)

  // Cargamos tasks activas con assignee + dailyEffortHours + rango
  // que solapa con [start,end]. Incluye proyecto + calendar del proyecto.
  const tasks = await prisma.task.findMany({
    where: {
      archivedAt: null,
      status: { not: 'DONE' },
      assigneeId: { not: null },
      startDate: { lte: end },
      endDate: { gte: start },
      dailyEffortHours: { not: null },
    },
    select: {
      id: true,
      title: true,
      assigneeId: true,
      assignee: { select: { id: true, name: true } },
      startDate: true,
      endDate: true,
      dailyEffortHours: true,
      project: {
        select: {
          id: true,
          name: true,
          calendar: {
            select: {
              workdays: true,
              holidays: { select: { date: true, recurring: true } },
            },
          },
        },
      },
    },
  })

  // Agrupamos por usuario.
  type CalendarShape = {
    workdays: number
    holidays: Array<{ date: Date; recurring: boolean }>
  }
  type Bucket = {
    userId: string
    userName: string
    tasks: AllocationTaskInput[]
    calendar: CalendarShape
  }
  const buckets = new Map<string, Bucket>()

  for (const t of tasks) {
    if (!t.assignee || !t.startDate || !t.endDate) continue
    const cal = t.project.calendar
    const calendar: CalendarShape = cal
      ? {
          workdays: cal.workdays,
          holidays: cal.holidays.map((h) => ({
            date: h.date,
            recurring: h.recurring,
          })),
        }
      : { workdays: DEFAULT_CALENDAR.workdays, holidays: [] }

    let userBucket = buckets.get(t.assignee.id)
    if (!userBucket) {
      userBucket = {
        userId: t.assignee.id,
        userName: t.assignee.name,
        tasks: [],
        calendar,
      }
      buckets.set(t.assignee.id, userBucket)
    }

    userBucket.tasks.push({
      taskId: t.id,
      projectId: t.project.id,
      projectName: t.project.name,
      startDate: t.startDate,
      endDate: t.endDate,
      dailyEffortHours: t.dailyEffortHours ?? 0,
    })
  }

  // Cargamos availability de los usuarios involucrados.
  const userIds = Array.from(buckets.keys())
  const availabilities = await prisma.userAvailability.findMany({
    where: {
      userId: { in: userIds },
      endDate: { gte: start },
      startDate: { lte: end },
    },
  })
  const availByUser = new Map<string, typeof availabilities>()
  for (const a of availabilities) {
    const list = availByUser.get(a.userId) ?? []
    list.push(a)
    availByUser.set(a.userId, list)
  }

  const snapshots: WeeklyAllocationSnapshot[] = []
  for (const bucket of buckets.values()) {
    const userSnapshots = computeUserWeeklyAllocations(
      {
        userId: bucket.userId,
        userName: bucket.userName,
        calendar: bucket.calendar,
        availabilities: availByUser.get(bucket.userId) ?? [],
        tasks: bucket.tasks,
      },
      start,
      end,
    )
    snapshots.push(...userSnapshots)
  }

  return snapshots.sort((a, b) => {
    const t = a.weekStart.getTime() - b.weekStart.getTime()
    if (t !== 0) return t
    return a.userName.localeCompare(b.userName, 'es-MX')
  })
}

/**
 * Persiste los snapshots semanales en `ResourceAllocationSnapshot`.
 * Idempotente sobre `(userId, weekStart)` → upsert.
 *
 * Pensado para invocarse desde:
 *  - Cron Vercel `0 2 * * *` (refresh nightly)
 *  - Botón manual "Recalcular" en /portfolio/allocation
 */
export async function refreshAllocationSnapshots(input: {
  daysAhead?: number
} = {}): Promise<{ refreshed: number; users: number }> {
  const snapshots = await getAllocationForRange({
    daysAhead: input.daysAhead ?? 28,
  })

  let refreshed = 0
  for (const snap of snapshots) {
    const allocationsJson = snap.allocations.map((a) => ({
      projectId: a.projectId,
      projectName: a.projectName,
      hours: a.hours,
      percent: a.percent,
    }))

    await prisma.resourceAllocationSnapshot.upsert({
      where: {
        userId_weekStart: {
          userId: snap.userId,
          weekStart: snap.weekStart,
        },
      },
      create: {
        userId: snap.userId,
        weekStart: snap.weekStart,
        totalHours: snap.totalHours,
        allocations: allocationsJson,
      },
      update: {
        totalHours: snap.totalHours,
        allocations: allocationsJson,
        computedAt: new Date(),
      },
    })
    refreshed++
  }

  await recordAuditEventSafe({
    action: 'allocation.snapshot_refreshed',
    entityType: 'allocation',
    after: {
      refreshed,
      users: new Set(snapshots.map((s) => s.userId)).size,
      daysAhead: input.daysAhead ?? 28,
    },
  })

  revalidatePath('/portfolio/allocation')
  return {
    refreshed,
    users: new Set(snapshots.map((s) => s.userId)).size,
  }
}
