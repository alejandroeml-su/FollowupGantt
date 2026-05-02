import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  default: {
    sprint: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
  },
}))

import prisma from '@/lib/prisma'
import {
  startSprint,
  endSprint,
  assignTaskToSprint,
  removeTaskFromSprint,
  setTaskStoryPoints,
  getSprintMetrics,
  getVelocityHistory,
  getBurndownData,
  createSprintWithCapacity,
} from '@/lib/actions/sprints'

const prismaMock = prisma as unknown as {
  sprint: {
    findUnique: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
  }
  task: {
    findUnique: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
}

describe('actions/sprints · startSprint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('falla con [SPRINT_NOT_FOUND] si id vacío', async () => {
    await expect(startSprint('')).rejects.toThrow(/SPRINT_NOT_FOUND/)
  })

  it('falla con [SPRINT_NOT_FOUND] si no existe', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue(null)
    await expect(startSprint('s-1')).rejects.toThrow(/SPRINT_NOT_FOUND/)
  })

  it('falla con [SPRINT_ALREADY_ACTIVE] si ya está ACTIVE', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's-1',
      status: 'ACTIVE',
      startedAt: new Date(),
    })
    await expect(startSprint('s-1')).rejects.toThrow(/SPRINT_ALREADY_ACTIVE/)
    expect(prismaMock.sprint.update).not.toHaveBeenCalled()
  })

  it('actualiza status=ACTIVE + startedAt cuando está PLANNING', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's-1',
      status: 'PLANNING',
      startedAt: null,
    })
    prismaMock.sprint.update.mockResolvedValue({})
    const r = await startSprint('s-1')
    expect(r.ok).toBe(true)
    const callArg = prismaMock.sprint.update.mock.calls[0][0] as {
      where: { id: string }
      data: { status: string; startedAt: Date }
    }
    expect(callArg.where.id).toBe('s-1')
    expect(callArg.data.status).toBe('ACTIVE')
    expect(callArg.data.startedAt).toBeInstanceOf(Date)
  })
})

describe('actions/sprints · endSprint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('falla con [SPRINT_NOT_ACTIVE] si no está ACTIVE', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's-1',
      status: 'PLANNING',
      startedAt: null,
    })
    await expect(endSprint('s-1')).rejects.toThrow(/SPRINT_NOT_ACTIVE/)
  })

  it('calcula velocityActual sumando storyPoints de tasks DONE', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's-1',
      status: 'ACTIVE',
      startedAt: new Date(),
    })
    prismaMock.task.findMany.mockResolvedValue([
      { id: 't1', storyPoints: 5 },
      { id: 't2', storyPoints: 8 },
      { id: 't3', storyPoints: null },
    ])
    prismaMock.sprint.update.mockResolvedValue({})

    const r = await endSprint('s-1')
    expect(r.velocityActual).toBe(13)
    const callArg = prismaMock.sprint.update.mock.calls[0][0] as {
      data: { status: string; velocityActual: number; endedAt: Date }
    }
    expect(callArg.data.status).toBe('COMPLETED')
    expect(callArg.data.velocityActual).toBe(13)
    expect(callArg.data.endedAt).toBeInstanceOf(Date)
  })
})

describe('actions/sprints · assignTaskToSprint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rechaza si task y sprint son de proyectos distintos', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1' })
    prismaMock.sprint.findUnique.mockResolvedValue({ id: 's1', projectId: 'p2' })
    await expect(assignTaskToSprint('t1', 's1')).rejects.toThrow(/PROJECT_MISMATCH/)
    expect(prismaMock.task.update).not.toHaveBeenCalled()
  })

  it('asigna sprintId cuando los proyectos coinciden', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1', projectId: 'p1' })
    prismaMock.sprint.findUnique.mockResolvedValue({ id: 's1', projectId: 'p1' })
    prismaMock.task.update.mockResolvedValue({})
    const r = await assignTaskToSprint('t1', 's1')
    expect(r.ok).toBe(true)
    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { sprintId: 's1' },
    })
  })
})

describe('actions/sprints · removeTaskFromSprint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('setea sprintId=null', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1' })
    prismaMock.task.update.mockResolvedValue({})
    const r = await removeTaskFromSprint('t1')
    expect(r.ok).toBe(true)
    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { sprintId: null },
    })
  })
})

describe('actions/sprints · setTaskStoryPoints', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rechaza valores fuera de Fibonacci con [INVALID_STORY_POINTS]', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1' })
    await expect(
      setTaskStoryPoints({ taskId: 't1', storyPoints: 4 }),
    ).rejects.toThrow(/INVALID_STORY_POINTS/)
  })

  it('acepta valores Fibonacci', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1' })
    prismaMock.task.update.mockResolvedValue({})
    const r = await setTaskStoryPoints({ taskId: 't1', storyPoints: 8 })
    expect(r.storyPoints).toBe(8)
    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { storyPoints: 8 },
    })
  })

  it('permite null para "sin estimar"', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1' })
    prismaMock.task.update.mockResolvedValue({})
    const r = await setTaskStoryPoints({ taskId: 't1', storyPoints: null })
    expect(r.storyPoints).toBeNull()
  })
})

describe('actions/sprints · getSprintMetrics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('agrega puntos por status del sprint', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue({ id: 's1' })
    prismaMock.task.findMany.mockResolvedValue([
      { status: 'DONE', storyPoints: 5 },
      { status: 'TODO', storyPoints: 3 },
      { status: 'DONE', storyPoints: 2 },
    ])
    const m = await getSprintMetrics('s1')
    expect(m.totalPoints).toBe(10)
    expect(m.completedPoints).toBe(7)
    expect(m.remainingPoints).toBe(3)
  })
})

describe('actions/sprints · getVelocityHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('devuelve datos en orden cronológico ascendente', async () => {
    prismaMock.sprint.findMany.mockResolvedValue([
      // findMany devuelve en orden DESC; el helper los re-ordena ASC.
      {
        id: 's3',
        name: 'S3',
        capacity: 10,
        velocityActual: 9,
        endedAt: new Date('2026-04-15'),
        endDate: new Date('2026-04-15'),
        createdAt: new Date('2026-04-01'),
      },
      {
        id: 's1',
        name: 'S1',
        capacity: 8,
        velocityActual: 7,
        endedAt: new Date('2026-04-01'),
        endDate: new Date('2026-04-01'),
        createdAt: new Date('2026-03-15'),
      },
    ])
    const r = await getVelocityHistory('p1', 5)
    expect(r.map((x) => x.sprintId)).toEqual(['s1', 's3'])
  })

  it('rechaza lastN inválido con [INVALID_INPUT]', async () => {
    await expect(getVelocityHistory('p1', 0)).rejects.toThrow(/INVALID_INPUT/)
  })
})

describe('actions/sprints · getBurndownData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('combina sprint + tasks y delega al helper puro', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's1',
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-03T00:00:00Z'),
      capacity: 10,
    })
    prismaMock.task.findMany.mockResolvedValue([
      { status: 'TODO', storyPoints: 5, updatedAt: new Date('2026-05-01') },
      { status: 'DONE', storyPoints: 5, updatedAt: new Date('2026-05-02') },
    ])
    const r = await getBurndownData('s1', new Date('2026-05-03T00:00:00Z'))
    // 3 puntos: día 0 .. día 2 (start=2026-05-01, end=2026-05-03 = 2 días).
    expect(r).toHaveLength(3)
    // Día 2: el DONE ya está cerrado (closedDay=1 ≤ 2) ⇒ restantes = 5.
    expect(r[2]?.actualRemaining).toBe(5)
  })
})

describe('actions/sprints · createSprintWithCapacity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('crea sprint con capacity opcional', async () => {
    const sprintCreate = (prisma as unknown as {
      sprint: { create: ReturnType<typeof vi.fn> }
    }).sprint.create
    sprintCreate.mockResolvedValue({ id: 's-new' })

    const r = await createSprintWithCapacity({
      name: 'Sprint X',
      projectId: 'p-1',
      startDate: '2026-05-01',
      endDate: '2026-05-15',
      capacity: 30,
    })
    expect(r.id).toBe('s-new')
    expect(sprintCreate).toHaveBeenCalled()
  })

  it('rechaza fechas invertidas con [INVALID_INPUT]', async () => {
    await expect(
      createSprintWithCapacity({
        name: 'Sprint X',
        projectId: 'p-1',
        startDate: '2026-05-15',
        endDate: '2026-05-01',
      }),
    ).rejects.toThrow(/INVALID_INPUT/)
  })
})
