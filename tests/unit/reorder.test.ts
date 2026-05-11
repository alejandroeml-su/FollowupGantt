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
      count: vi.fn(),
    },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// Stub explícito de withMetrics: ejecuta el callback sin tracing.
vi.mock('@/lib/observability/metrics', () => ({
  withMetrics: async (_label: string, fn: () => Promise<unknown>) => fn(),
}))

import prisma from '@/lib/prisma'
import {
  reorderTask,
  moveTaskToColumn,
  moveTaskToParent,
  bulkMoveTasksToColumn,
  bulkMoveTasksWithStatus,
  archiveTask,
  unarchiveTask,
  bulkArchive,
  bulkDelete,
  duplicateTask,
} from '@/lib/actions/reorder'

const mockedTask = prisma.task as unknown as {
  findUnique: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  updateMany: ReturnType<typeof vi.fn>
  deleteMany: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
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

// ─── R3.0-G · Coverage push: branches y cases faltantes ────────────────

describe('reorderTask · branches edge', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rechaza taskId vacío con mensaje requerido', async () => {
    await expect(reorderTask('', 'b', 'a')).rejects.toThrow(/requerido/i)
  })

  it('posición = 1 cuando before y after son null', async () => {
    mockedTask.update.mockResolvedValue({})
    const r = await reorderTask('t1', null, null)
    expect(r.position).toBe(1)
  })

  it('ignora before/after cuyo task no existe (devuelve null)', async () => {
    mockedTask.findUnique.mockResolvedValue(null)
    mockedTask.update.mockResolvedValue({})
    const r = await reorderTask('t1', 'ghost-before', 'ghost-after')
    // sin posiciones → cae al branch (null,null) → 1
    expect(r.position).toBe(1)
  })
})

describe('moveTaskToColumn · WIP enforcement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rechaza con [WIP_LIMIT_EXCEEDED] cuando se supera el tope', async () => {
    mockedTask.count.mockResolvedValue(3)
    await expect(
      moveTaskToColumn('t1', 'col-x', null, null, {
        wipLimit: 3,
        enforceStatus: 'IN_PROGRESS',
      }),
    ).rejects.toThrow(/\[WIP_LIMIT_EXCEEDED\]/)
    expect(mockedTask.update).not.toHaveBeenCalled()
  })

  it('permite el move cuando el count < wipLimit', async () => {
    mockedTask.count.mockResolvedValue(1)
    mockedTask.findUnique.mockResolvedValue(null)
    mockedTask.update.mockResolvedValue({})
    const r = await moveTaskToColumn('t1', 'col-x', null, null, {
      wipLimit: 3,
      enforceStatus: 'IN_PROGRESS',
    })
    expect(r.ok).toBe(true)
    expect(mockedTask.update).toHaveBeenCalled()
  })

  it('rechaza con [INVALID_TARGET] cuando taskId está vacío', async () => {
    await expect(moveTaskToColumn('', 'col-x')).rejects.toThrow(
      /\[INVALID_TARGET\]/,
    )
  })

  it('skip WIP check cuando wipLimit es null', async () => {
    mockedTask.findUnique.mockResolvedValue(null)
    mockedTask.update.mockResolvedValue({})
    await moveTaskToColumn('t1', 'col-x', null, null, {
      wipLimit: null,
      enforceStatus: 'TODO',
    })
    expect(mockedTask.count).not.toHaveBeenCalled()
  })
})

describe('bulkMoveTasksWithStatus · WIP', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lista vacía retorna 0 sin tocar DB', async () => {
    const r = await bulkMoveTasksWithStatus([], 'TODO', 'c1', 5)
    expect(r.updated).toBe(0)
    expect(mockedTask.updateMany).not.toHaveBeenCalled()
  })

  it('rechaza con [WIP_LIMIT_EXCEEDED] cuando count+lote > limit', async () => {
    mockedTask.count.mockResolvedValue(2)
    await expect(
      bulkMoveTasksWithStatus(['t1', 't2'], 'IN_PROGRESS', 'c1', 3),
    ).rejects.toThrow(/\[WIP_LIMIT_EXCEEDED\]/)
    expect(mockedTask.updateMany).not.toHaveBeenCalled()
  })

  it('permite el bulk-move cuando cabe', async () => {
    mockedTask.count.mockResolvedValue(0)
    mockedTask.updateMany.mockResolvedValue({ count: 2 })
    const r = await bulkMoveTasksWithStatus(
      ['t1', 't2'],
      'IN_PROGRESS',
      'c1',
      5,
    )
    expect(r.updated).toBe(2)
  })

  it('skip WIP check si wipLimit es null', async () => {
    mockedTask.updateMany.mockResolvedValue({ count: 3 })
    const r = await bulkMoveTasksWithStatus(
      ['a', 'b', 'c'],
      'TODO',
      null,
      null,
    )
    expect(r.updated).toBe(3)
    expect(mockedTask.count).not.toHaveBeenCalled()
  })
})

describe('moveTaskToParent · branches', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rechaza taskId vacío', async () => {
    await expect(moveTaskToParent('', 'p1')).rejects.toThrow(/requerido/i)
  })

  it('asigna un parentId no-null', async () => {
    mockedTask.update.mockResolvedValue({})
    await moveTaskToParent('t1', 'parent-1')
    expect(mockedTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { parentId: 'parent-1' } }),
    )
  })
})

describe('bulk operations · cases faltantes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('bulkMoveTasksToColumn ejecuta updateMany cuando hay ids', async () => {
    mockedTask.updateMany.mockResolvedValue({ count: 3 })
    const r = await bulkMoveTasksToColumn(['t1', 't2', 't3'], 'col-1')
    expect(r.updated).toBe(3)
    expect(mockedTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['t1', 't2', 't3'] } },
        data: { columnId: 'col-1' },
      }),
    )
  })

  it('bulkArchive lista vacía retorna 0', async () => {
    const r = await bulkArchive([])
    expect(r.updated).toBe(0)
    expect(mockedTask.updateMany).not.toHaveBeenCalled()
  })

  it('bulkArchive con ids llama updateMany con archivedAt', async () => {
    mockedTask.updateMany.mockResolvedValue({ count: 2 })
    const r = await bulkArchive(['a', 'b'])
    expect(r.updated).toBe(2)
    expect(mockedTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      }),
    )
  })

  it('bulkDelete lista vacía retorna 0', async () => {
    const r = await bulkDelete([])
    expect(r.deleted).toBe(0)
    expect(mockedTask.deleteMany).not.toHaveBeenCalled()
  })

  it('bulkDelete con ids llama deleteMany', async () => {
    mockedTask.deleteMany.mockResolvedValue({ count: 4 })
    const r = await bulkDelete(['a', 'b', 'c', 'd'])
    expect(r.deleted).toBe(4)
  })

  it('archiveTask rechaza id vacío', async () => {
    await expect(archiveTask('')).rejects.toThrow(/requerido/i)
  })

  it('unarchiveTask pone archivedAt a null', async () => {
    mockedTask.update.mockResolvedValue({})
    await unarchiveTask('t1')
    expect(mockedTask.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archivedAt: null } }),
    )
  })

  it('unarchiveTask rechaza id vacío', async () => {
    await expect(unarchiveTask('')).rejects.toThrow(/requerido/i)
  })
})
