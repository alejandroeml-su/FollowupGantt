import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P2 · Equipo P2-3 — Tests de server actions de RecurrenceRule.
 *
 * Verifica:
 *   - createRule valida shape vía validateRule (lanza [INVALID_RRULE]).
 *   - updateRule lanza [RULE_NOT_FOUND] si no existe.
 *   - pauseRule toggle active.
 *   - generateOverdueOccurrences materializa ocurrencias pendientes.
 *   - generateOverdueOccurrences es idempotente para occurrenceDate ya
 *     materializada (llamada repetida no duplica).
 */

const tplFindUnique = vi.fn()
const ruleFindUnique = vi.fn()
const ruleFindMany = vi.fn()
const ruleCreate = vi.fn()
const ruleUpdate = vi.fn()
const ruleDelete = vi.fn()
const taskFindFirst = vi.fn()
const taskCreate = vi.fn()
const userFindFirst = vi.fn()
const projectFindUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    project: { findUnique: (...a: unknown[]) => projectFindUnique(...a) },
    user: { findFirst: (...a: unknown[]) => userFindFirst(...a) },
    taskTemplate: { findUnique: (...a: unknown[]) => tplFindUnique(...a) },
    recurrenceRule: {
      findUnique: (...a: unknown[]) => ruleFindUnique(...a),
      findMany: (...a: unknown[]) => ruleFindMany(...a),
      create: (...a: unknown[]) => ruleCreate(...a),
      update: (...a: unknown[]) => ruleUpdate(...a),
      delete: (...a: unknown[]) => ruleDelete(...a),
    },
    task: {
      findFirst: (...a: unknown[]) => taskFindFirst(...a),
      create: (...a: unknown[]) => taskCreate(...a),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (loader: () => unknown) => loader,
}))

beforeEach(() => {
  tplFindUnique.mockReset().mockResolvedValue({ id: 'tpl-1', projectId: 'p1' })
  ruleFindUnique.mockReset().mockResolvedValue(null)
  ruleFindMany.mockReset().mockResolvedValue([])
  ruleCreate
    .mockReset()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'rule-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      lastGeneratedAt: null,
      ...data,
    }))
  ruleUpdate
    .mockReset()
    .mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: where.id,
      templateId: 'tpl-1',
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
      count: null,
      active: true,
      lastGeneratedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    }))
  ruleDelete.mockReset().mockResolvedValue({ id: 'rule-1' })
  taskFindFirst.mockReset().mockResolvedValue(null)
  taskCreate.mockReset().mockResolvedValue({ id: 'task-1' })
  userFindFirst.mockReset().mockResolvedValue({ id: 'edwin' })
  projectFindUnique.mockReset().mockResolvedValue({ id: 'p1' })
})

describe('createRule', () => {
  it('crea regla DAILY válida', async () => {
    const { createRule } = await import('@/lib/actions/recurrence')
    const r = await createRule({
      templateId: 'tpl-1',
      frequency: 'DAILY',
      interval: 1,
      startDate: '2026-05-01',
    })
    expect(r.id).toBe('rule-1')
    expect(ruleCreate).toHaveBeenCalled()
  })

  it('lanza [INVALID_RRULE] cuando byweekday está con frequency=DAILY', async () => {
    const { createRule } = await import('@/lib/actions/recurrence')
    await expect(
      createRule({
        templateId: 'tpl-1',
        frequency: 'DAILY',
        startDate: '2026-05-01',
        byweekday: [0, 1],
      }),
    ).rejects.toThrow(/INVALID_RRULE/)
  })

  it('lanza [TEMPLATE_NOT_FOUND] si el template no existe', async () => {
    tplFindUnique.mockResolvedValueOnce(null)
    const { createRule } = await import('@/lib/actions/recurrence')
    await expect(
      createRule({ templateId: 'tpl-x', frequency: 'DAILY', startDate: '2026-05-01' }),
    ).rejects.toThrow(/TEMPLATE_NOT_FOUND/)
  })
})

describe('updateRule / pauseRule / deleteRule', () => {
  it('updateRule lanza [RULE_NOT_FOUND] si la regla no existe', async () => {
    ruleFindUnique.mockResolvedValueOnce(null)
    const { updateRule } = await import('@/lib/actions/recurrence')
    await expect(updateRule('rule-x', { interval: 2 })).rejects.toThrow(/RULE_NOT_FOUND/)
  })

  it('pauseRule alterna active=false', async () => {
    ruleFindUnique.mockResolvedValueOnce({
      id: 'rule-1',
      active: true,
    })
    const { pauseRule } = await import('@/lib/actions/recurrence')
    await pauseRule('rule-1', true)
    expect(ruleUpdate).toHaveBeenCalledWith({
      where: { id: 'rule-1' },
      data: { active: false },
    })
  })

  it('deleteRule lanza [RULE_NOT_FOUND] si no existe', async () => {
    ruleFindUnique.mockResolvedValueOnce(null)
    const { deleteRule } = await import('@/lib/actions/recurrence')
    await expect(deleteRule('rule-x')).rejects.toThrow(/RULE_NOT_FOUND/)
  })
})

describe('generateOverdueOccurrences', () => {
  it('materializa ocurrencias pendientes desde startDate', async () => {
    ruleFindUnique.mockResolvedValueOnce({
      id: 'rule-1',
      templateId: 'tpl-1',
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
      count: 3,
      active: true,
      lastGeneratedAt: null,
      template: { id: 'tpl-1', projectId: 'p1' },
    })
    tplFindUnique.mockResolvedValue({
      id: 'tpl-1',
      taskShape: { title: 'X', type: 'AGILE_STORY', priority: 'MEDIUM' },
    })
    const { generateOverdueOccurrences } = await import('@/lib/actions/recurrence')
    const res = await generateOverdueOccurrences(
      'rule-1',
      new Date('2026-05-10T00:00:00.000Z'),
    )
    expect(res.generated).toBe(3)
    expect(taskCreate).toHaveBeenCalledTimes(3)
    expect(ruleUpdate).toHaveBeenCalled()
  })

  it('idempotente: si la task existe se cuenta como skipped', async () => {
    ruleFindUnique.mockResolvedValueOnce({
      id: 'rule-1',
      templateId: 'tpl-1',
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
      count: 2,
      active: true,
      lastGeneratedAt: null,
      template: { id: 'tpl-1', projectId: 'p1' },
    })
    tplFindUnique.mockResolvedValue({
      id: 'tpl-1',
      taskShape: { title: 'X', type: 'AGILE_STORY', priority: 'MEDIUM' },
    })
    taskFindFirst.mockResolvedValue({ id: 'pre-existing' })
    const { generateOverdueOccurrences } = await import('@/lib/actions/recurrence')
    const res = await generateOverdueOccurrences(
      'rule-1',
      new Date('2026-05-10T00:00:00.000Z'),
    )
    expect(res.generated).toBe(0)
    expect(res.skipped).toBe(2)
  })

  it('regla pausada no genera nada', async () => {
    ruleFindUnique.mockResolvedValueOnce({
      id: 'rule-1',
      active: false,
      template: { id: 'tpl-1', projectId: 'p1' },
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      lastGeneratedAt: null,
      frequency: 'DAILY',
      interval: 1,
      byweekday: [],
      bymonthday: [],
      endDate: null,
      count: null,
    })
    const { generateOverdueOccurrences } = await import('@/lib/actions/recurrence')
    const res = await generateOverdueOccurrences('rule-1', new Date())
    expect(res).toEqual({ generated: 0, skipped: 0 })
    expect(taskCreate).not.toHaveBeenCalled()
  })
})
