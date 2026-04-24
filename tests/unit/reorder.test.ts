import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock del prisma client ANTES de importar el módulo bajo test
vi.mock('@/lib/prisma', () => ({
  default: {
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import prisma from '@/lib/prisma'
import {
  reorderTask,
  moveTaskToColumn,
  moveTaskToParent,
  bulkMoveTasksToColumn,
  archiveTask,
  duplicateTask,
} from '@/lib/actions/reorder'

const mockedTask = prisma.task as unknown as {
  findUnique: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  updateMany: ReturnType<typeof vi.fn>
  deleteMany: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}

describe('reorder · fractional indexing (ADR-001)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calcula position = promedio cuando hay before y after', async () => {
    mockedTask.findUnique.mockImplementation(async ({ where: { id } }) => {
      if (id === 'b') return { position: 10 }
      if (id === 'a') return { position: 20 }
      return null
    })
    mockedTask.update.mockResolvedValue({})

    const r = await reorderTask('t1', 'b', 'a')

    expect(mockedTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: { position: 15 },
      }),
    )
    expect(r.position).toBe(15)
  })

  it('posición = after - 1 si no hay before', async () => {
    mockedTask.findUnique.mockImplementation(async ({ where: { id } }) =>
      id === 'a' ? { position: 5 } : null,
    )
    const r = await reorderTask('t1', null, 'a')
    expect(r.position).toBe(4)
  })

  it('posición = before + 1 si no hay after', async () => {
    mockedTask.findUnique.mockImplementation(async ({ where: { id } }) =>
      id === 'b' ? { position: 7 } : null,
    )
    const r = await reorderTask('t1', 'b', null)
    expect(r.position).toBe(8)
  })
})

describe('moveTaskToColumn', () => {
  beforeEach(() => vi.clearAllMocks())

  it('actualiza columnId y persiste una posición calculada', async () => {
    mockedTask.findUnique.mockResolvedValue(null)
    mockedTask.update.mockResolvedValue({})
    await moveTaskToColumn('t1', 'col-new')
    expect(mockedTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ columnId: 'col-new' }) }),
    )
  })
})

describe('moveTaskToParent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rechaza convertir la tarea en su propio padre', async () => {
    await expect(moveTaskToParent('t1', 't1')).rejects.toThrow(/propio padre/i)
    expect(mockedTask.update).not.toHaveBeenCalled()
  })

  it('acepta parent null (desanidar)', async () => {
    mockedTask.update.mockResolvedValue({})
    await moveTaskToParent('t1', null)
    expect(mockedTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { parentId: null } }),
    )
  })
})

describe('bulk operations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('bulkMoveTasksToColumn con lista vacía no toca la DB', async () => {
    const r = await bulkMoveTasksToColumn([], 'c1')
    expect(r.updated).toBe(0)
    expect(mockedTask.updateMany).not.toHaveBeenCalled()
  })

  it('archiveTask pone archivedAt', async () => {
    mockedTask.update.mockResolvedValue({})
    await archiveTask('t1')
    expect(mockedTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      }),
    )
  })
})

describe('duplicateTask', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clona la tarea con sufijo "(copia)"', async () => {
    mockedTask.findUnique.mockResolvedValue({
      id: 's', title: 'Original', description: null, type: 'AGILE_STORY',
      status: 'TODO', priority: 'MEDIUM', parentId: null, projectId: 'p1',
      phaseId: null, sprintId: null, columnId: null, assigneeId: null,
      startDate: null, endDate: null, isMilestone: false, tags: ['a'], position: 1,
    })
    mockedTask.create.mockResolvedValue({ id: 'new-id' })

    const { id } = await duplicateTask('s')
    expect(id).toBe('new-id')
    expect(mockedTask.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Original (copia)',
          projectId: 'p1',
          position: 1.0001,
        }),
      }),
    )
  })

  it('lanza si la tarea origen no existe', async () => {
    mockedTask.findUnique.mockResolvedValue(null)
    await expect(duplicateTask('x')).rejects.toThrow(/no encontrada/i)
  })
})
