import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  default: {
    workCalendar: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    holiday: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    project: {
      count: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Pasamos el mismo mock como tx para que las llamadas dentro de la
      // transacción queden registradas en el mismo objeto.
      return await fn(prismaMock)
    }),
  },
}))

vi.mock('@/lib/scheduling/invalidate', () => ({
  invalidateCpmCache: vi.fn().mockResolvedValue(undefined),
}))

import prisma from '@/lib/prisma'
import {
  createCalendar,
  updateCalendar,
  deleteCalendar,
  addHoliday,
  removeHoliday,
  assignCalendarToProject,
} from '@/lib/actions/calendars'

const prismaMock = prisma as unknown as {
  workCalendar: {
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
  }
  holiday: {
    create: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
  project: {
    count: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  $transaction: ReturnType<typeof vi.fn>
}

describe('calendars actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.workCalendar.updateMany.mockResolvedValue({ count: 0 })
  })

  describe('createCalendar', () => {
    it('crea con defaults sensatos', async () => {
      prismaMock.workCalendar.create.mockResolvedValue({ id: 'cal-1' })
      const r = await createCalendar({ name: 'Estándar MX' })
      expect(r.id).toBe('cal-1')
      expect(prismaMock.workCalendar.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Estándar MX',
          isDefault: false,
          workdays: 31,
          workdayHours: 8,
        }),
      })
    })

    it('rechaza nombre vacío con [INVALID_INPUT]', async () => {
      await expect(createCalendar({ name: '' })).rejects.toThrow(/INVALID_INPUT/)
    })

    it('si isDefault=true, desmarca otros calendarios', async () => {
      prismaMock.workCalendar.create.mockResolvedValue({ id: 'cal-2' })
      await createCalendar({ name: 'México', isDefault: true })
      expect(prismaMock.workCalendar.updateMany).toHaveBeenCalledWith({
        where: { isDefault: true },
        data: { isDefault: false },
      })
    })
  })

  describe('updateCalendar', () => {
    it('falla si id vacío con [CALENDAR_NOT_FOUND]', async () => {
      await expect(updateCalendar('', { name: 'X' })).rejects.toThrow(
        /CALENDAR_NOT_FOUND/,
      )
    })
  })

  describe('deleteCalendar', () => {
    it('bloquea borrado con [CALENDAR_IN_USE] si hay proyectos', async () => {
      prismaMock.project.count.mockResolvedValue(2)
      await expect(deleteCalendar('cal-1')).rejects.toThrow(/CALENDAR_IN_USE/)
      expect(prismaMock.workCalendar.delete).not.toHaveBeenCalled()
    })

    it('borra cuando no hay proyectos asignados', async () => {
      prismaMock.project.count.mockResolvedValue(0)
      prismaMock.workCalendar.delete.mockResolvedValue({})
      const r = await deleteCalendar('cal-1')
      expect(r.ok).toBe(true)
      expect(prismaMock.workCalendar.delete).toHaveBeenCalledWith({
        where: { id: 'cal-1' },
      })
    })
  })

  describe('addHoliday', () => {
    it('rechaza fecha inválida con [INVALID_HOLIDAY]', async () => {
      await expect(
        addHoliday('cal-1', 'no-es-fecha', 'Test'),
      ).rejects.toThrow(/INVALID_HOLIDAY/)
    })

    it('crea holiday normalizado a UTC midnight', async () => {
      prismaMock.holiday.create.mockResolvedValue({ id: 'h-1' })
      const r = await addHoliday(
        'cal-1',
        '2026-12-25T15:30:00Z',
        'Navidad',
        true,
      )
      expect(r.id).toBe('h-1')
      const callArg = prismaMock.holiday.create.mock.calls[0][0] as {
        data: { date: Date; name: string; recurring: boolean }
      }
      expect(callArg.data.date.toISOString()).toBe('2026-12-25T00:00:00.000Z')
      expect(callArg.data.recurring).toBe(true)
    })
  })

  describe('removeHoliday', () => {
    it('elimina por id', async () => {
      prismaMock.holiday.delete.mockResolvedValue({})
      const r = await removeHoliday('h-1')
      expect(r.ok).toBe(true)
      expect(prismaMock.holiday.delete).toHaveBeenCalledWith({
        where: { id: 'h-1' },
      })
    })
  })

  describe('assignCalendarToProject', () => {
    it('rechaza calendarId inexistente con [CALENDAR_NOT_FOUND]', async () => {
      prismaMock.workCalendar.findUnique.mockResolvedValue(null)
      await expect(
        assignCalendarToProject('proj-1', 'cal-fake'),
      ).rejects.toThrow(/CALENDAR_NOT_FOUND/)
    })

    it('asigna calendar al proyecto', async () => {
      prismaMock.workCalendar.findUnique.mockResolvedValue({ id: 'cal-1' })
      prismaMock.project.update.mockResolvedValue({})
      const r = await assignCalendarToProject('proj-1', 'cal-1')
      expect(r.ok).toBe(true)
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: { calendarId: 'cal-1' },
      })
    })

    it('permite null para desasignar', async () => {
      prismaMock.project.update.mockResolvedValue({})
      const r = await assignCalendarToProject('proj-1', null)
      expect(r.ok).toBe(true)
      expect(prismaMock.project.update).toHaveBeenCalledWith({
        where: { id: 'proj-1' },
        data: { calendarId: null },
      })
    })
  })
})
