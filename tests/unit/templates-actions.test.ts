import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P2 · Equipo P2-3 — Tests de server actions de TaskTemplate.
 *
 * Mockeamos `next/cache` y `@/lib/prisma` para validar:
 *   - createTemplate aplica zod + busca proyecto.
 *   - updateTemplate parchea selectivamente.
 *   - deleteTemplate falla con TEMPLATE_NOT_FOUND si no existe.
 *   - instantiateFromTemplate respeta idempotencia (recurrenceRuleId+occurrenceDate).
 */

const projectFindUnique = vi.fn()
const userFindFirst = vi.fn()
const tplFindMany = vi.fn()
const tplFindUnique = vi.fn()
const tplCreate = vi.fn()
const tplUpdate = vi.fn()
const tplDelete = vi.fn()
const taskFindFirst = vi.fn()
const taskCreate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    project: {
      findUnique: (...args: unknown[]) => projectFindUnique(...args),
    },
    user: {
      findFirst: (...args: unknown[]) => userFindFirst(...args),
    },
    taskTemplate: {
      findMany: (...args: unknown[]) => tplFindMany(...args),
      findUnique: (...args: unknown[]) => tplFindUnique(...args),
      create: (...args: unknown[]) => tplCreate(...args),
      update: (...args: unknown[]) => tplUpdate(...args),
      delete: (...args: unknown[]) => tplDelete(...args),
    },
    task: {
      findFirst: (...args: unknown[]) => taskFindFirst(...args),
      create: (...args: unknown[]) => taskCreate(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (loader: () => unknown) => loader,
}))

beforeEach(() => {
  projectFindUnique.mockReset().mockResolvedValue({ id: 'p1' })
  userFindFirst.mockReset().mockResolvedValue({ id: 'edwin' })
  tplFindMany.mockReset().mockResolvedValue([])
  tplFindUnique.mockReset().mockResolvedValue(null)
  tplCreate
    .mockReset()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'tpl-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    }))
  tplUpdate
    .mockReset()
    .mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: where.id,
      name: 'previous',
      description: null,
      projectId: null,
      taskShape: { title: 'X', type: 'AGILE_STORY', priority: 'MEDIUM' },
      isShared: false,
      createdById: 'edwin',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    }))
  tplDelete.mockReset().mockResolvedValue({ id: 'tpl-1' })
  taskFindFirst.mockReset().mockResolvedValue(null)
  taskCreate.mockReset().mockResolvedValue({ id: 'task-1' })
})

describe('createTemplate', () => {
  it('crea un template global con taskShape válido', async () => {
    const { createTemplate } = await import('@/lib/actions/templates')
    const t = await createTemplate({
      name: 'Daily standup',
      taskShape: {
        title: 'Daily standup',
        type: 'AGILE_STORY',
        priority: 'MEDIUM',
      },
    })
    expect(tplCreate).toHaveBeenCalled()
    expect(t.id).toBe('tpl-1')
    // user fallback resolved
    expect(userFindFirst).toHaveBeenCalled()
  })

  it('rechaza taskShape sin title con [INVALID_INPUT]', async () => {
    const { createTemplate } = await import('@/lib/actions/templates')
    await expect(
      createTemplate({
        name: 'Bad',
        // @ts-expect-error simulamos input inválido
        taskShape: { type: 'AGILE_STORY' },
      }),
    ).rejects.toThrow(/INVALID_INPUT/)
  })

  it('lanza [PROJECT_NOT_FOUND] si projectId apunta a un proyecto inexistente', async () => {
    projectFindUnique.mockResolvedValueOnce(null)
    const { createTemplate } = await import('@/lib/actions/templates')
    await expect(
      createTemplate({
        name: 'X',
        projectId: 'p-missing',
        taskShape: { title: 'X', type: 'AGILE_STORY', priority: 'MEDIUM' },
      }),
    ).rejects.toThrow(/PROJECT_NOT_FOUND/)
  })
})

describe('updateTemplate', () => {
  it('lanza [TEMPLATE_NOT_FOUND] si no existe', async () => {
    tplFindUnique.mockResolvedValueOnce(null)
    const { updateTemplate } = await import('@/lib/actions/templates')
    await expect(updateTemplate('tpl-x', { name: 'new' })).rejects.toThrow(
      /TEMPLATE_NOT_FOUND/,
    )
  })

  it('actualiza sólo los campos especificados', async () => {
    tplFindUnique.mockResolvedValueOnce({
      id: 'tpl-1',
      name: 'old',
      description: null,
      projectId: null,
      taskShape: { title: 'X', type: 'AGILE_STORY', priority: 'MEDIUM' },
      isShared: false,
    })
    const { updateTemplate } = await import('@/lib/actions/templates')
    await updateTemplate('tpl-1', { isShared: true })
    expect(tplUpdate).toHaveBeenCalledWith({
      where: { id: 'tpl-1' },
      data: { isShared: true },
    })
  })
})

describe('deleteTemplate', () => {
  it('lanza [TEMPLATE_NOT_FOUND] si no existe', async () => {
    tplFindUnique.mockResolvedValueOnce(null)
    const { deleteTemplate } = await import('@/lib/actions/templates')
    await expect(deleteTemplate('tpl-x')).rejects.toThrow(/TEMPLATE_NOT_FOUND/)
  })
})

describe('instantiateFromTemplate', () => {
  it('idempotencia: si ya existe la task con (rule,occurrenceDate), la devuelve', async () => {
    tplFindUnique.mockResolvedValueOnce({
      id: 'tpl-1',
      taskShape: { title: 'Recurring', type: 'AGILE_STORY', priority: 'MEDIUM' },
    })
    const occurrenceDate = new Date('2026-05-15T00:00:00.000Z')
    taskFindFirst.mockResolvedValueOnce({ id: 'task-existing' })
    const { instantiateFromTemplate } = await import('@/lib/actions/templates')
    const res = await instantiateFromTemplate({
      templateId: 'tpl-1',
      projectId: 'p1',
      recurrenceRuleId: 'rule-1',
      occurrenceDate,
    })
    expect(res.alreadyExisted).toBe(true)
    expect(res.taskId).toBe('task-existing')
    expect(taskCreate).not.toHaveBeenCalled()
  })

  it('crea una task nueva con startDate=occurrenceDate', async () => {
    tplFindUnique.mockResolvedValueOnce({
      id: 'tpl-1',
      taskShape: {
        title: 'Recurring',
        type: 'AGILE_STORY',
        priority: 'MEDIUM',
        durationDays: 2,
      },
    })
    const occurrenceDate = new Date('2026-05-15T00:00:00.000Z')
    const { instantiateFromTemplate } = await import('@/lib/actions/templates')
    const res = await instantiateFromTemplate({
      templateId: 'tpl-1',
      projectId: 'p1',
      recurrenceRuleId: 'rule-1',
      occurrenceDate,
    })
    expect(res.alreadyExisted).toBe(false)
    expect(taskCreate).toHaveBeenCalled()
    const args = taskCreate.mock.calls[0][0]
    expect(args.data.title).toBe('Recurring')
    expect(args.data.recurrenceRuleId).toBe('rule-1')
    expect(args.data.startDate.toISOString().slice(0, 10)).toBe('2026-05-15')
    // endDate = +2 días
    expect(args.data.endDate.toISOString().slice(0, 10)).toBe('2026-05-17')
  })
})
