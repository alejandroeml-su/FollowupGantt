import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P2 · Equipo P2-4 — Tests de los server actions de Goals/OKRs.
 *
 * Mockeamos `next/cache` y `@/lib/prisma`. Cada test importa `goals` con
 * `await import` para resetear el módulo en el namespace de mocks.
 */

// ─────────────────────────── Mocks ───────────────────────────

const userFindUnique = vi.fn()
const goalFindUnique = vi.fn()
const goalFindMany = vi.fn()
const goalCreate = vi.fn()
const goalUpdate = vi.fn()
const goalDelete = vi.fn()
const krFindUnique = vi.fn()
const krFindFirst = vi.fn()
const krFindMany = vi.fn()
const krCreate = vi.fn()
const krUpdate = vi.fn()
const krDelete = vi.fn()
const taskFindUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
    },
    goal: {
      findUnique: (...args: unknown[]) => goalFindUnique(...args),
      findMany: (...args: unknown[]) => goalFindMany(...args),
      create: (...args: unknown[]) => goalCreate(...args),
      update: (...args: unknown[]) => goalUpdate(...args),
      delete: (...args: unknown[]) => goalDelete(...args),
    },
    keyResult: {
      findUnique: (...args: unknown[]) => krFindUnique(...args),
      findFirst: (...args: unknown[]) => krFindFirst(...args),
      findMany: (...args: unknown[]) => krFindMany(...args),
      create: (...args: unknown[]) => krCreate(...args),
      update: (...args: unknown[]) => krUpdate(...args),
      delete: (...args: unknown[]) => krDelete(...args),
    },
    task: {
      findUnique: (...args: unknown[]) => taskFindUnique(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  userFindUnique.mockReset()
  userFindUnique.mockResolvedValue({ id: 'u1' })

  goalFindUnique.mockReset()
  goalFindUnique.mockResolvedValue({
    id: 'g1',
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2026-03-31T00:00:00Z'),
    status: 'ON_TRACK',
    keyResults: [],
  })

  goalFindMany.mockReset()
  goalFindMany.mockResolvedValue([])

  goalCreate.mockReset()
  goalCreate.mockResolvedValue({ id: 'g-new' })

  goalUpdate.mockReset()
  goalUpdate.mockResolvedValue({ id: 'g1' })

  goalDelete.mockReset()
  goalDelete.mockResolvedValue({ id: 'g1' })

  krFindUnique.mockReset()
  krFindUnique.mockResolvedValue({
    id: 'kr1',
    metric: 'PERCENT',
    targetValue: 100,
    currentValue: 0,
    goalId: 'g1',
    linkedTasks: [],
  })

  krFindFirst.mockReset()
  krFindFirst.mockResolvedValue(null)

  krFindMany.mockReset()
  krFindMany.mockResolvedValue([])

  krCreate.mockReset()
  krCreate.mockResolvedValue({ id: 'kr-new' })

  krUpdate.mockReset()
  krUpdate.mockResolvedValue({ id: 'kr1' })

  krDelete.mockReset()
  krDelete.mockResolvedValue({ id: 'kr1' })

  taskFindUnique.mockReset()
  taskFindUnique.mockResolvedValue({ id: 't1' })
})

// ─────────────────────────── Tests ───────────────────────────

describe('createGoal', () => {
  it('crea un goal válido devolviendo id', async () => {
    const { createGoal } = await import('@/lib/actions/goals')
    const out = await createGoal({
      title: 'Mejorar NPS',
      ownerId: 'u1',
      cycle: 'Q1-2026',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
    })
    expect(out.id).toBe('g-new')
    const args = goalCreate.mock.calls.at(-1)?.[0] as { data: { cycle: string } }
    expect(args.data.cycle).toBe('Q1-2026')
  })

  it('rechaza ciclo inválido como [INVALID_INPUT]', async () => {
    const { createGoal } = await import('@/lib/actions/goals')
    await expect(
      createGoal({
        title: 'X',
        ownerId: 'u1',
        cycle: 'Z9-9999',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza endDate <= startDate como [INVALID_INPUT]', async () => {
    const { createGoal } = await import('@/lib/actions/goals')
    await expect(
      createGoal({
        title: 'X',
        ownerId: 'u1',
        cycle: 'Q1-2026',
        startDate: '2026-03-31',
        endDate: '2026-01-01',
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza owner inexistente como [OWNER_NOT_FOUND]', async () => {
    userFindUnique.mockResolvedValueOnce(null)
    const { createGoal } = await import('@/lib/actions/goals')
    await expect(
      createGoal({
        title: 'X',
        ownerId: 'u-fantasma',
        cycle: 'Q1-2026',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
      }),
    ).rejects.toThrow(/\[OWNER_NOT_FOUND\]/)
  })
})

describe('createKeyResult', () => {
  it('rechaza target=0 en NUMERIC como [INVALID_METRIC]', async () => {
    const { createKeyResult } = await import('@/lib/actions/goals')
    await expect(
      createKeyResult('g1', {
        title: 'KR',
        metric: 'NUMERIC',
        targetValue: 0,
      }),
    ).rejects.toThrow(/\[INVALID_METRIC\]/)
  })

  it('asigna position incremental basado en max+1', async () => {
    krFindFirst.mockResolvedValueOnce({ position: 7 })
    const { createKeyResult } = await import('@/lib/actions/goals')
    await createKeyResult('g1', {
      title: 'KR',
      metric: 'PERCENT',
      targetValue: 100,
    })
    const args = krCreate.mock.calls.at(-1)?.[0] as { data: { position: number } }
    expect(args.data.position).toBe(8)
  })

  it('rechaza goalId inexistente como [GOAL_NOT_FOUND]', async () => {
    goalFindUnique.mockResolvedValueOnce(null)
    const { createKeyResult } = await import('@/lib/actions/goals')
    await expect(
      createKeyResult('g-fantasma', {
        title: 'KR',
        metric: 'PERCENT',
        targetValue: 100,
      }),
    ).rejects.toThrow(/\[GOAL_NOT_FOUND\]/)
  })
})

describe('updateKeyResult', () => {
  it('bloquea currentValue manual en TASKS_COMPLETED como [INVALID_METRIC]', async () => {
    krFindUnique.mockResolvedValueOnce({
      id: 'kr1',
      metric: 'TASKS_COMPLETED',
    })
    const { updateKeyResult } = await import('@/lib/actions/goals')
    await expect(
      updateKeyResult('kr1', { currentValue: 75 }),
    ).rejects.toThrow(/\[INVALID_METRIC\]/)
  })

  it('permite editar currentValue en PERCENT', async () => {
    krFindUnique.mockResolvedValueOnce({ id: 'kr1', metric: 'PERCENT' })
    const { updateKeyResult } = await import('@/lib/actions/goals')
    await updateKeyResult('kr1', { currentValue: 75 })
    const args = krUpdate.mock.calls.at(-1)?.[0] as { data: { currentValue: number } }
    expect(args.data.currentValue).toBe(75)
  })
})

describe('linkTaskToKeyResult', () => {
  it('rechaza vincular a KR no TASKS_COMPLETED como [INVALID_METRIC]', async () => {
    krFindUnique.mockResolvedValueOnce({ id: 'kr1', metric: 'PERCENT' })
    const { linkTaskToKeyResult } = await import('@/lib/actions/goals')
    await expect(linkTaskToKeyResult('kr1', 't1')).rejects.toThrow(
      /\[INVALID_METRIC\]/,
    )
  })

  it('rechaza taskId inexistente como [TASK_NOT_FOUND]', async () => {
    krFindUnique.mockResolvedValueOnce({ id: 'kr1', metric: 'TASKS_COMPLETED' })
    taskFindUnique.mockResolvedValueOnce(null)
    const { linkTaskToKeyResult } = await import('@/lib/actions/goals')
    await expect(linkTaskToKeyResult('kr1', 't-fantasma')).rejects.toThrow(
      /\[TASK_NOT_FOUND\]/,
    )
  })

  it('connecta y dispara recompute (currentValue queda en 0 si no había DONE)', async () => {
    krFindUnique
      // 1) llamada inicial al validar metric
      .mockResolvedValueOnce({ id: 'kr1', metric: 'TASKS_COMPLETED' })
      // 2) llamada dentro de recomputeKeyResultProgress
      .mockResolvedValueOnce({
        id: 'kr1',
        metric: 'TASKS_COMPLETED',
        targetValue: 100,
        currentValue: 0,
        goalId: 'g1',
        linkedTasks: [{ id: 't1', status: 'TODO' }],
      })
    const { linkTaskToKeyResult } = await import('@/lib/actions/goals')
    await linkTaskToKeyResult('kr1', 't1')
    // El primer update es el connect; el segundo (si hubiera) sería del recompute.
    expect(krUpdate).toHaveBeenCalled()
    const firstCall = krUpdate.mock.calls[0]?.[0] as { data: { linkedTasks: { connect: { id: string } } } }
    expect(firstCall.data.linkedTasks.connect.id).toBe('t1')
  })
})

describe('recomputeKeyResultProgress', () => {
  it('actualiza currentValue para TASKS_COMPLETED según linked tasks', async () => {
    krFindUnique.mockResolvedValueOnce({
      id: 'kr1',
      metric: 'TASKS_COMPLETED',
      targetValue: 100,
      currentValue: 0,
      goalId: 'g1',
      linkedTasks: [
        { id: 't1', status: 'DONE' },
        { id: 't2', status: 'DONE' },
        { id: 't3', status: 'TODO' },
        { id: 't4', status: 'IN_PROGRESS' },
      ],
    })
    const { recomputeKeyResultProgress } = await import('@/lib/actions/goals')
    const out = await recomputeKeyResultProgress('kr1')
    expect(out.currentValue).toBe(50)
    const updateArg = krUpdate.mock.calls.find((c) => {
      const arg = c[0] as { data: Record<string, unknown> }
      return 'currentValue' in arg.data
    })?.[0] as { data: { currentValue: number } }
    expect(updateArg.data.currentValue).toBe(50)
  })

  it('no toca currentValue para metric != TASKS_COMPLETED', async () => {
    krFindUnique.mockResolvedValueOnce({
      id: 'kr1',
      metric: 'PERCENT',
      targetValue: 100,
      currentValue: 42,
      goalId: 'g1',
      linkedTasks: [],
    })
    const { recomputeKeyResultProgress } = await import('@/lib/actions/goals')
    const out = await recomputeKeyResultProgress('kr1')
    expect(out.currentValue).toBe(42)
    expect(krUpdate).not.toHaveBeenCalled()
  })
})

describe('getGoalsForCycle', () => {
  it('rechaza cycle inválido como [INVALID_CYCLE]', async () => {
    const { getGoalsForCycle } = await import('@/lib/actions/goals')
    await expect(getGoalsForCycle('Z9-9999')).rejects.toThrow(/\[INVALID_CYCLE\]/)
  })

  it('mapea filas a SerializedGoal con progress calculado', async () => {
    goalFindMany.mockResolvedValueOnce([
      {
        id: 'g1',
        title: 'Goal',
        description: null,
        ownerId: 'u1',
        owner: { id: 'u1', name: 'Edwin' },
        projectId: null,
        project: null,
        status: 'ON_TRACK',
        cycle: 'Q1-2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-03-31'),
        parentId: null,
        keyResults: [
          {
            id: 'kr1',
            goalId: 'g1',
            title: 'KR',
            metric: 'PERCENT',
            targetValue: 100,
            currentValue: 60,
            unit: '%',
            position: 1,
            _count: { linkedTasks: 0 },
          },
        ],
      },
    ])
    const { getGoalsForCycle } = await import('@/lib/actions/goals')
    const out = await getGoalsForCycle('Q1-2026')
    expect(out).toHaveLength(1)
    expect(out[0].progress).toBe(60)
    expect(out[0].keyResults[0].progress).toBe(60)
    expect(out[0].ownerName).toBe('Edwin')
  })
})
