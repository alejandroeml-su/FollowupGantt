import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P5 · Equipo P5-4 — Smoke tests de los server actions de insights.
 *
 * Mockeamos `next/cache` y `@/lib/prisma` para validar el flujo end-to-end
 * sin BD: las heurísticas reales corren con stubs determinísticos.
 */

const projectFindUnique = vi.fn()
const projectFindMany = vi.fn()
const taskFindMany = vi.fn()
const userFindMany = vi.fn()
const insightFindMany = vi.fn()
const insightFindUnique = vi.fn()
const insightDeleteMany = vi.fn()
const insightCreate = vi.fn()
const insightUpdate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    project: {
      findUnique: (...args: unknown[]) => projectFindUnique(...args),
      findMany: (...args: unknown[]) => projectFindMany(...args),
    },
    task: {
      findMany: (...args: unknown[]) => taskFindMany(...args),
    },
    user: {
      findMany: (...args: unknown[]) => userFindMany(...args),
    },
    taskInsight: {
      findMany: (...args: unknown[]) => insightFindMany(...args),
      findUnique: (...args: unknown[]) => insightFindUnique(...args),
      deleteMany: (...args: unknown[]) => insightDeleteMany(...args),
      create: (...args: unknown[]) => insightCreate(...args),
      update: (...args: unknown[]) => insightUpdate(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

beforeEach(() => {
  projectFindUnique.mockReset()
  projectFindMany.mockReset()
  taskFindMany.mockReset()
  userFindMany.mockReset()
  insightFindMany.mockReset()
  insightFindUnique.mockReset()
  insightDeleteMany.mockReset()
  insightCreate.mockReset()
  insightUpdate.mockReset()

  insightFindMany.mockResolvedValue([])
  insightDeleteMany.mockResolvedValue({ count: 0 })
  insightCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'ins-' + Math.random().toString(36).slice(2, 8),
    ...data,
    dismissedAt: null,
    createdAt: new Date('2026-05-03T00:00:00Z'),
  }))
  taskFindMany.mockResolvedValue([])
  userFindMany.mockResolvedValue([])
})

describe('runProjectInsights', () => {
  it('falla con NOT_FOUND si no existe el proyecto', async () => {
    const { runProjectInsights } = await import('@/lib/actions/insights')
    projectFindUnique.mockResolvedValue(null)
    await expect(runProjectInsights('missing')).rejects.toThrow(/NOT_FOUND/)
  })

  it('genera insights de categorización + riesgo para cada task', async () => {
    const { runProjectInsights } = await import('@/lib/actions/insights')
    projectFindUnique.mockResolvedValue({
      id: 'p1',
      name: 'Proyecto Demo',
      tasks: [
        {
          id: 't1',
          title: 'Bug del deploy',
          description: null,
          type: 'AGILE_STORY',
          status: 'IN_PROGRESS',
          progress: 0,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-02-01'),
          assigneeId: null,
          plannedValue: null,
          updatedAt: new Date('2026-04-01'),
          predecessors: [],
        },
      ],
      sprints: [],
    })
    const result = await runProjectInsights('p1')
    expect(result.generated).toBeGreaterThan(0)
    // Categorización (BUG) + DELAY_RISK + (al menos un NEXT_ACTION por
    // overdue-stale ya que la task está vencida y sin actualizar > 7d).
    expect(insightCreate).toHaveBeenCalled()
    const kinds = insightCreate.mock.calls.map(
      (c) => (c[0] as { data: { kind: string } }).data.kind,
    )
    expect(kinds).toContain('CATEGORIZATION')
    expect(kinds).toContain('DELAY_RISK')
    expect(kinds).toContain('NEXT_ACTION')
  })

  it('respeta soft-deletes previos (no recrea insights dismissed)', async () => {
    const { runProjectInsights } = await import('@/lib/actions/insights')
    projectFindUnique.mockResolvedValue({
      id: 'p1',
      name: 'P1',
      tasks: [
        {
          id: 't1',
          title: 'Diseñar Figma',
          description: null,
          type: 'AGILE_STORY',
          status: 'TODO',
          progress: 0,
          startDate: null,
          endDate: null,
          assigneeId: null,
          plannedValue: null,
          updatedAt: new Date('2026-05-01'),
          predecessors: [],
        },
      ],
      sprints: [],
    })
    insightFindMany.mockResolvedValue([
      { taskId: 't1', kind: 'CATEGORIZATION' },
    ])
    await runProjectInsights('p1')
    const kinds = insightCreate.mock.calls.map(
      (c) => (c[0] as { data: { kind: string } }).data.kind,
    )
    // CATEGORIZATION debe estar omitida; DELAY_RISK aún se crea.
    expect(kinds).not.toContain('CATEGORIZATION')
    expect(kinds).toContain('DELAY_RISK')
  })
})

describe('dismissInsight', () => {
  it('lanza NOT_FOUND si no existe el insight', async () => {
    const { dismissInsight } = await import('@/lib/actions/insights')
    insightFindUnique.mockResolvedValue(null)
    await expect(dismissInsight('missing')).rejects.toThrow(/NOT_FOUND/)
  })

  it('marca dismissedAt cuando existe y no estaba dismissed', async () => {
    const { dismissInsight } = await import('@/lib/actions/insights')
    insightFindUnique.mockResolvedValue({ id: 'i1', dismissedAt: null })
    insightUpdate.mockResolvedValue({ id: 'i1', dismissedAt: new Date() })
    await dismissInsight('i1')
    expect(insightUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1' },
        data: expect.objectContaining({ dismissedAt: expect.any(Date) }),
      }),
    )
  })

  it('es idempotente: no toca BD si ya estaba dismissed', async () => {
    const { dismissInsight } = await import('@/lib/actions/insights')
    insightFindUnique.mockResolvedValue({
      id: 'i1',
      dismissedAt: new Date('2026-04-01'),
    })
    await dismissInsight('i1')
    expect(insightUpdate).not.toHaveBeenCalled()
  })
})

describe('getProjectRiskOverview', () => {
  it('devuelve top tasks ordenadas por score con factors', async () => {
    const { getProjectRiskOverview } = await import('@/lib/actions/insights')
    insightFindMany.mockResolvedValue([
      {
        score: 0.9,
        payload: { level: 'high', factors: ['Vencida'] },
        task: { id: 't1', title: 'A', project: { id: 'p1', name: 'Proy' } },
      },
      {
        score: 0.5,
        payload: { level: 'medium', factors: ['Tarea grande'] },
        task: { id: 't2', title: 'B', project: { id: 'p1', name: 'Proy' } },
      },
    ])
    const top = await getProjectRiskOverview(5)
    expect(top).toHaveLength(2)
    expect(top[0].level).toBe('high')
    expect(top[0].factors).toContain('Vencida')
    expect(top[1].level).toBe('medium')
  })
})

describe('getProjectInsightSummary', () => {
  it('cuenta insights por kind y high-risks', async () => {
    const { getProjectInsightSummary } = await import('@/lib/actions/insights')
    insightFindMany.mockResolvedValue([
      { kind: 'CATEGORIZATION', payload: {} },
      { kind: 'DELAY_RISK', payload: { level: 'high' } },
      { kind: 'DELAY_RISK', payload: { level: 'low' } },
      { kind: 'NEXT_ACTION', payload: {} },
      { kind: 'NEXT_ACTION', payload: {} },
    ])
    const s = await getProjectInsightSummary('p1')
    expect(s).toEqual({
      projectId: 'p1',
      categorization: 1,
      delayRisk: 2,
      nextAction: 2,
      highRisk: 1,
    })
  })
})
