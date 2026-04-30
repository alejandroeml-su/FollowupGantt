import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  default: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    taskDependency: {
      findMany: vi.fn(),
    },
  },
}))

// HU-1.5 · `updateTaskDates` ahora invoca `validateScheduledChange` que
// lee el grafo del proyecto. Mockeamos a no-op para aislar la lógica
// específica de schedule (validación de rangos + dep FS clásica). El
// validador tiene su propia suite (`validate.test.ts`).
vi.mock('@/lib/scheduling/validate', () => ({
  validateScheduledChange: vi.fn().mockResolvedValue(undefined),
}))

import prisma from '@/lib/prisma'
import { updateTaskDates, shiftTaskDates } from '@/lib/actions/schedule'

const mock = prisma as unknown as {
  task: {
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  taskDependency: { findMany: ReturnType<typeof vi.fn> }
}

describe('schedule · updateTaskDates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rechaza startDate > endDate', async () => {
    await expect(
      updateTaskDates('t1', new Date('2026-05-10'), new Date('2026-05-01')),
    ).rejects.toThrow(/INVALID_RANGE/)
    expect(mock.task.update).not.toHaveBeenCalled()
  })

  it('rechaza si predecesor FS termina después del nuevo start', async () => {
    mock.taskDependency.findMany.mockResolvedValue([
      {
        predecessor: {
          endDate: new Date('2026-05-10'),
          title: 'Setup infra',
        },
      },
    ])
    await expect(
      updateTaskDates('t1', new Date('2026-05-05'), new Date('2026-05-15')),
    ).rejects.toThrow(/DEPENDENCY_VIOLATION/)
    expect(mock.task.update).not.toHaveBeenCalled()
  })

  it('acepta cuando no hay predecesores', async () => {
    mock.taskDependency.findMany.mockResolvedValue([])
    mock.task.findUnique.mockResolvedValue({
      projectId: 'proj-1',
      isMilestone: false,
    })
    mock.task.update.mockResolvedValue({})
    const r = await updateTaskDates(
      't1',
      new Date('2026-05-01'),
      new Date('2026-05-05'),
    )
    expect(r.ok).toBe(true)
    expect(mock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' } }),
    )
  })

  it('ignora check de dependencias si startDate es null', async () => {
    mock.task.findUnique.mockResolvedValue({
      projectId: 'proj-1',
      isMilestone: false,
    })
    mock.task.update.mockResolvedValue({})
    await updateTaskDates('t1', null, new Date('2026-05-05'))
    expect(mock.taskDependency.findMany).not.toHaveBeenCalled()
  })
})

describe('schedule · shiftTaskDates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('no toca DB si deltaDays = 0', async () => {
    await shiftTaskDates('t1', 0)
    expect(mock.task.findUnique).not.toHaveBeenCalled()
  })

  it('desplaza ambas fechas y valida', async () => {
    mock.task.findUnique.mockResolvedValue({
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-05T00:00:00Z'),
    })
    mock.taskDependency.findMany.mockResolvedValue([])
    mock.task.update.mockResolvedValue({})

    await shiftTaskDates('t1', 3)

    const call = mock.task.update.mock.calls[0][0]
    expect(call.data.startDate.toISOString().slice(0, 10)).toBe('2026-05-04')
    expect(call.data.endDate.toISOString().slice(0, 10)).toBe('2026-05-08')
  })

  it('lanza si la tarea no existe', async () => {
    mock.task.findUnique.mockResolvedValue(null)
    await expect(shiftTaskDates('x', 1)).rejects.toThrow(/NOT_FOUND/)
  })
})
