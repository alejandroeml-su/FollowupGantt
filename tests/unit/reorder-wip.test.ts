import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  default: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import prisma from '@/lib/prisma'
import {
  moveTaskToColumn,
  bulkMoveTasksWithStatus,
} from '@/lib/actions/reorder'

const mock = prisma as unknown as {
  task: {
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
  }
}

describe('moveTaskToColumn · WIP enforcement (Sprint 2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rechaza si la columna destino está al tope', async () => {
    mock.task.count.mockResolvedValue(3) // 3 tareas ya en destino
    await expect(
      moveTaskToColumn('t1', null, null, null, {
        wipLimit: 3,
        enforceStatus: 'IN_PROGRESS',
      }),
    ).rejects.toThrow(/WIP_LIMIT_EXCEEDED/)
    expect(mock.task.update).not.toHaveBeenCalled()
  })

  it('permite el movimiento si hay capacidad', async () => {
    mock.task.count.mockResolvedValue(1)
    mock.task.findUnique.mockResolvedValue(null)
    mock.task.update.mockResolvedValue({})
    const r = await moveTaskToColumn('t1', 'col-1', null, null, {
      wipLimit: 3,
      enforceStatus: 'IN_PROGRESS',
    })
    expect(r.ok).toBe(true)
    expect(mock.task.update).toHaveBeenCalled()
  })

  it('excluye la propia tarea del conteo (self-move)', async () => {
    // Simula: la tarea ya está en IN_PROGRESS y sólo cambia de posición
    mock.task.count.mockImplementation(async ({ where }: { where: { id: { not: string } } }) => {
      expect(where.id.not).toBe('t1')
      return 2
    })
    mock.task.findUnique.mockResolvedValue(null)
    mock.task.update.mockResolvedValue({})
    await moveTaskToColumn('t1', null, null, null, {
      wipLimit: 3,
      enforceStatus: 'IN_PROGRESS',
    })
  })

  it('sin wipLimit: pasa directo', async () => {
    mock.task.findUnique.mockResolvedValue(null)
    mock.task.update.mockResolvedValue({})
    await moveTaskToColumn('t1', 'col-1')
    expect(mock.task.count).not.toHaveBeenCalled()
  })
})

describe('bulkMoveTasksWithStatus · WIP en lote', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rechaza si el lote completo no cabe', async () => {
    mock.task.count.mockResolvedValue(2) // 2 ya en destino
    await expect(
      bulkMoveTasksWithStatus(['a', 'b', 'c'], 'IN_PROGRESS', null, 3),
    ).rejects.toThrow(/WIP_LIMIT_EXCEEDED/)
    expect(mock.task.updateMany).not.toHaveBeenCalled()
  })

  it('permite lote completo si cabe', async () => {
    mock.task.count.mockResolvedValue(1)
    mock.task.updateMany.mockResolvedValue({ count: 3 })
    const r = await bulkMoveTasksWithStatus(
      ['a', 'b', 'c'],
      'IN_PROGRESS',
      null,
      5,
    )
    expect(r.updated).toBe(3)
  })

  it('excluye las tareas movidas del conteo base', async () => {
    mock.task.count.mockImplementation(async ({ where }: { where: { id: { notIn: string[] } } }) => {
      expect(where.id.notIn).toEqual(['a', 'b'])
      return 1
    })
    mock.task.updateMany.mockResolvedValue({ count: 2 })
    await bulkMoveTasksWithStatus(['a', 'b'], 'REVIEW', null, 5)
  })

  it('lista vacía = no-op', async () => {
    const r = await bulkMoveTasksWithStatus([], 'TODO', null, 3)
    expect(r.updated).toBe(0)
    expect(mock.task.count).not.toHaveBeenCalled()
    expect(mock.task.updateMany).not.toHaveBeenCalled()
  })
})
