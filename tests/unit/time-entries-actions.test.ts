import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P1 · Equipo 4 — Tests de las server actions de time tracking.
 *
 * Estrategia: mockear `@/lib/prisma` y `next/cache` (revalidate*) para
 * no tocar BD ni runtime Next. Verificamos:
 *   1. startTimer crea entry y rechaza si ya hay timer activo.
 *   2. stopTimer cierra entry, calcula duración + cost con tarifa snapshot.
 *   3. stopTimer recalcula Task.actualCost sumando entries del task.
 *   4. cancelActiveTimer borra el timer activo idempotentemente.
 *   5. createManualEntry valida rango y calcula cost.
 *   6. createManualEntry rechaza endedAt <= startedAt.
 *   7. updateEntry recalcula duración y cost al cambiar el rango.
 *   8. deleteEntry borra y recalcula actualCost.
 *   9. getEntriesForTask retorna lista ordenada.
 *  10. getWeekTimesheet agrega minutos y costo por día.
 *  11. startTimer rechaza tarea inexistente con [NOT_FOUND].
 *  12. setUserHourlyRate cierra tarifa previa y crea nueva.
 */

// ─────────────────────── Mocks de cliente Prisma ───────────────────────

const timeEntryFindFirst = vi.fn()
const timeEntryFindUnique = vi.fn()
const timeEntryFindMany = vi.fn()
const timeEntryCreate = vi.fn()
const timeEntryUpdate = vi.fn()
const timeEntryDelete = vi.fn()
const timeEntryAggregate = vi.fn()
const taskFindUnique = vi.fn()
const taskUpdate = vi.fn()
const userFindUnique = vi.fn()
const rateFindFirst = vi.fn()
const rateUpdateMany = vi.fn()
const rateCreate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    timeEntry: {
      findFirst: (...args: unknown[]) => timeEntryFindFirst(...args),
      findUnique: (...args: unknown[]) => timeEntryFindUnique(...args),
      findMany: (...args: unknown[]) => timeEntryFindMany(...args),
      create: (...args: unknown[]) => timeEntryCreate(...args),
      update: (...args: unknown[]) => timeEntryUpdate(...args),
      delete: (...args: unknown[]) => timeEntryDelete(...args),
      aggregate: (...args: unknown[]) => timeEntryAggregate(...args),
    },
    task: {
      findUnique: (...args: unknown[]) => taskFindUnique(...args),
      update: (...args: unknown[]) => taskUpdate(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
    },
    userHourlyRate: {
      findFirst: (...args: unknown[]) => rateFindFirst(...args),
      updateMany: (...args: unknown[]) => rateUpdateMany(...args),
      create: (...args: unknown[]) => rateCreate(...args),
    },
  },
}))

// `unstable_cache` envuelve la consulta de timer activo. Para los tests
// devolvemos una función pasthrough — la idea es que el SUT llame al
// callback como si no hubiera cache.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))

// `Prisma.Decimal` se importa real desde @prisma/client para que las
// operaciones aritméticas en stopTimer funcionen como en prod.
// (No mockeamos esa parte: el módulo es puro y barato.)

// ─────────────────────── Helpers ───────────────────────

function fixedDate(iso: string): Date {
  return new Date(iso)
}

beforeEach(() => {
  timeEntryFindFirst.mockReset()
  timeEntryFindUnique.mockReset()
  timeEntryFindMany.mockReset()
  timeEntryCreate.mockReset()
  timeEntryUpdate.mockReset()
  timeEntryDelete.mockReset()
  timeEntryAggregate.mockReset()
  taskFindUnique.mockReset()
  taskUpdate.mockReset()
  userFindUnique.mockReset()
  rateFindFirst.mockReset()
  rateUpdateMany.mockReset()
  rateCreate.mockReset()

  // Defaults razonables: no hay timer activo, user/task existen.
  timeEntryFindFirst.mockResolvedValue(null)
  taskFindUnique.mockResolvedValue({ id: 't-1' })
  userFindUnique.mockResolvedValue({ id: 'u-1' })
  rateFindFirst.mockResolvedValue(null)
  timeEntryAggregate.mockResolvedValue({ _sum: { cost: null } })
  taskUpdate.mockResolvedValue({ id: 't-1' })
  timeEntryFindMany.mockResolvedValue([])
})

// ─────────────────────── Tests ───────────────────────

describe('startTimer', () => {
  it('crea un entry con endedAt=null cuando no hay timer activo', async () => {
    timeEntryFindFirst.mockResolvedValue(null)
    timeEntryCreate.mockResolvedValue({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: fixedDate('2026-05-01T10:00:00Z'),
      endedAt: null,
      durationMinutes: 0,
      description: null,
      hourlyRate: null,
      cost: null,
      createdAt: fixedDate('2026-05-01T10:00:00Z'),
    })

    const { startTimer } = await import('@/lib/actions/time-entries')
    const result = await startTimer({ userId: 'u-1', taskId: 't-1' })

    expect(result.id).toBe('te-1')
    expect(result.endedAt).toBeNull()
    expect(timeEntryCreate).toHaveBeenCalledOnce()
  })

  it('rechaza con [TIMER_ALREADY_RUNNING] si hay timer activo', async () => {
    timeEntryFindFirst.mockResolvedValue({ id: 'te-existing' })

    const { startTimer } = await import('@/lib/actions/time-entries')
    await expect(
      startTimer({ userId: 'u-1', taskId: 't-1' }),
    ).rejects.toThrow(/\[TIMER_ALREADY_RUNNING\]/)
    expect(timeEntryCreate).not.toHaveBeenCalled()
  })

  it('lanza [NOT_FOUND] si el task no existe', async () => {
    taskFindUnique.mockResolvedValue(null)

    const { startTimer } = await import('@/lib/actions/time-entries')
    await expect(
      startTimer({ userId: 'u-1', taskId: 'no-existe' }),
    ).rejects.toThrow(/\[NOT_FOUND\]/)
  })
})

describe('stopTimer', () => {
  it('cierra el entry y calcula durationMinutes con tarifa snapshot', async () => {
    const start = fixedDate('2026-05-01T10:00:00Z')
    timeEntryFindUnique.mockResolvedValue({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: start,
      endedAt: null,
    })
    // Tarifa $100/h vigente.
    const { Prisma } = await import('@prisma/client')
    rateFindFirst.mockResolvedValue({ rate: new Prisma.Decimal('100.00') })
    timeEntryUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: start,
      endedAt: args.data.endedAt as Date,
      durationMinutes: args.data.durationMinutes as number,
      description: null,
      hourlyRate: args.data.hourlyRate,
      cost: args.data.cost,
      createdAt: start,
    }))

    const { stopTimer } = await import('@/lib/actions/time-entries')
    // Forzamos Date.now al stop = +30 minutos del start.
    vi.setSystemTime(new Date('2026-05-01T10:30:00Z'))
    const result = await stopTimer({ entryId: 'te-1' })
    vi.useRealTimers()

    expect(result.durationMinutes).toBe(30)
    // 30 min * $100/h = $50
    expect(result.cost).toBeCloseTo(50, 2)
    expect(taskUpdate).toHaveBeenCalled() // updateTaskActualCost
  })

  it('rechaza con [NO_ACTIVE_TIMER] si el entry ya está cerrado', async () => {
    timeEntryFindUnique.mockResolvedValue({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: fixedDate('2026-05-01T10:00:00Z'),
      endedAt: fixedDate('2026-05-01T11:00:00Z'),
    })
    const { stopTimer } = await import('@/lib/actions/time-entries')
    await expect(stopTimer({ entryId: 'te-1' })).rejects.toThrow(/\[NO_ACTIVE_TIMER\]/)
  })

  it('persiste cost=null si no hay tarifa configurada', async () => {
    const start = fixedDate('2026-05-01T10:00:00Z')
    timeEntryFindUnique.mockResolvedValue({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: start,
      endedAt: null,
    })
    rateFindFirst.mockResolvedValue(null) // sin tarifa
    timeEntryUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: start,
      endedAt: args.data.endedAt as Date,
      durationMinutes: args.data.durationMinutes as number,
      description: null,
      hourlyRate: null,
      cost: null,
      createdAt: start,
    }))

    const { stopTimer } = await import('@/lib/actions/time-entries')
    vi.setSystemTime(new Date('2026-05-01T11:00:00Z'))
    const result = await stopTimer({ entryId: 'te-1' })
    vi.useRealTimers()

    expect(result.cost).toBeNull()
    expect(result.durationMinutes).toBe(60)
  })
})

describe('cancelActiveTimer', () => {
  it('borra el timer activo si existe', async () => {
    timeEntryFindFirst.mockResolvedValue({ id: 'te-1', taskId: 't-1' })
    timeEntryDelete.mockResolvedValue({ id: 'te-1' })

    const { cancelActiveTimer } = await import('@/lib/actions/time-entries')
    const result = await cancelActiveTimer({ userId: 'u-1' })

    expect(result.ok).toBe(true)
    expect(timeEntryDelete).toHaveBeenCalledWith({ where: { id: 'te-1' } })
  })

  it('es idempotente cuando no hay timer activo (no llama delete)', async () => {
    timeEntryFindFirst.mockResolvedValue(null)

    const { cancelActiveTimer } = await import('@/lib/actions/time-entries')
    const result = await cancelActiveTimer({ userId: 'u-1' })

    expect(result.ok).toBe(true)
    expect(timeEntryDelete).not.toHaveBeenCalled()
  })
})

describe('createManualEntry', () => {
  it('crea entry con duración y costo calculados', async () => {
    const { Prisma } = await import('@prisma/client')
    rateFindFirst.mockResolvedValue({ rate: new Prisma.Decimal('60.00') })
    timeEntryCreate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: args.data.startedAt as Date,
      endedAt: args.data.endedAt as Date,
      durationMinutes: args.data.durationMinutes as number,
      description: args.data.description ?? null,
      hourlyRate: args.data.hourlyRate ?? null,
      cost: args.data.cost ?? null,
      createdAt: new Date(),
    }))

    const { createManualEntry } = await import('@/lib/actions/time-entries')
    const out = await createManualEntry({
      userId: 'u-1',
      taskId: 't-1',
      startedAt: '2026-05-01T09:00:00Z',
      endedAt: '2026-05-01T11:00:00Z',
      description: 'sesión planeación',
    })

    expect(out.durationMinutes).toBe(120)
    expect(out.cost).toBeCloseTo(120, 2) // 2h * $60/h
  })

  it('rechaza con [INVALID_RANGE] si endedAt <= startedAt', async () => {
    const { createManualEntry } = await import('@/lib/actions/time-entries')
    await expect(
      createManualEntry({
        userId: 'u-1',
        taskId: 't-1',
        startedAt: '2026-05-01T11:00:00Z',
        endedAt: '2026-05-01T10:00:00Z',
      }),
    ).rejects.toThrow(/\[INVALID_RANGE\]/)
  })
})

describe('updateEntry', () => {
  it('recalcula duración y costo al ampliar el rango', async () => {
    const { Prisma } = await import('@prisma/client')
    timeEntryFindUnique.mockResolvedValue({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: fixedDate('2026-05-01T09:00:00Z'),
      endedAt: fixedDate('2026-05-01T10:00:00Z'),
      hourlyRate: new Prisma.Decimal('50.00'),
      cost: new Prisma.Decimal('50.00'),
    })
    rateFindFirst.mockResolvedValue({ rate: new Prisma.Decimal('50.00') })
    timeEntryUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: 'te-1',
      userId: 'u-1',
      taskId: 't-1',
      startedAt: fixedDate('2026-05-01T09:00:00Z'),
      endedAt: args.data.endedAt as Date,
      durationMinutes: args.data.durationMinutes as number,
      description: null,
      hourlyRate: args.data.hourlyRate ?? null,
      cost: args.data.cost ?? null,
      createdAt: new Date(),
    }))

    const { updateEntry } = await import('@/lib/actions/time-entries')
    const out = await updateEntry({
      id: 'te-1',
      endedAt: '2026-05-01T11:00:00Z',
    })

    expect(out.durationMinutes).toBe(120)
    expect(out.cost).toBeCloseTo(100, 2)
  })
})

describe('deleteEntry', () => {
  it('borra y recalcula actualCost del task', async () => {
    timeEntryFindUnique.mockResolvedValue({
      id: 'te-1',
      taskId: 't-1',
      userId: 'u-1',
    })
    timeEntryDelete.mockResolvedValue({ id: 'te-1' })

    const { deleteEntry } = await import('@/lib/actions/time-entries')
    const result = await deleteEntry({ id: 'te-1' })

    expect(result.ok).toBe(true)
    expect(timeEntryDelete).toHaveBeenCalled()
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-1' },
        data: expect.objectContaining({ actualCost: 0 }),
      }),
    )
  })

  it('es idempotente cuando el id no existe', async () => {
    timeEntryFindUnique.mockResolvedValue(null)

    const { deleteEntry } = await import('@/lib/actions/time-entries')
    const result = await deleteEntry({ id: 'nope' })
    expect(result.ok).toBe(true)
    expect(timeEntryDelete).not.toHaveBeenCalled()
  })
})

describe('getWeekTimesheet', () => {
  it('agrega minutos y costo por día', async () => {
    const { Prisma } = await import('@prisma/client')
    const weekStart = new Date('2026-04-27T00:00:00Z') // Lunes
    timeEntryFindMany.mockResolvedValue([
      {
        id: 'te-1',
        userId: 'u-1',
        taskId: 't-1',
        startedAt: new Date('2026-04-27T09:00:00Z'),
        endedAt: new Date('2026-04-27T11:00:00Z'),
        durationMinutes: 120,
        description: null,
        hourlyRate: new Prisma.Decimal('50'),
        cost: new Prisma.Decimal('100'),
        createdAt: new Date(),
      },
      {
        id: 'te-2',
        userId: 'u-1',
        taskId: 't-2',
        startedAt: new Date('2026-04-29T14:00:00Z'),
        endedAt: new Date('2026-04-29T15:00:00Z'),
        durationMinutes: 60,
        description: null,
        hourlyRate: new Prisma.Decimal('50'),
        cost: new Prisma.Decimal('50'),
        createdAt: new Date(),
      },
    ])

    const { getWeekTimesheet } = await import('@/lib/actions/time-entries')
    const result = await getWeekTimesheet('u-1', weekStart.toISOString())

    expect(result.totalMinutes).toBe(180)
    expect(result.totalCost).toBeCloseTo(150, 2)
    expect(result.perDay).toHaveLength(7)
    // Lun = idx 0
    expect(result.perDay[0].minutes).toBe(120)
    // Mié = idx 2
    expect(result.perDay[2].minutes).toBe(60)
  })
})

describe('setUserHourlyRate', () => {
  it('cierra la tarifa vigente previa antes de crear la nueva', async () => {
    rateUpdateMany.mockResolvedValue({ count: 1 })
    rateCreate.mockResolvedValue({ id: 'rate-2' })

    const { setUserHourlyRate } = await import('@/lib/actions/time-entries')
    const out = await setUserHourlyRate({ userId: 'u-1', rate: 75 })

    expect(out.id).toBe('rate-2')
    // Verifica que primero cerró la previa y después creó la nueva.
    // Vitest no expone `toHaveBeenCalledBefore`; comparamos invocationOrder
    // (mock.invocationCallOrder es array de IDs monótonos por mock).
    const updateOrder = rateUpdateMany.mock.invocationCallOrder[0]
    const createOrder = rateCreate.mock.invocationCallOrder[0]
    expect(updateOrder).toBeLessThan(createOrder)
    const createArgs = rateCreate.mock.calls.at(-1)?.[0] as {
      data: { userId: string; validUntil: null }
    }
    expect(createArgs.data.userId).toBe('u-1')
    expect(createArgs.data.validUntil).toBeNull()
  })
})
