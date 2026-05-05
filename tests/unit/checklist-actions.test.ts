import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave C-debt-1 · Equipo C-DEBT-1 — Tests de los server actions de
 * Checklist (`@/lib/actions/checklist`).
 *
 * Mockeamos:
 *   - `@/lib/prisma` (todos los modelos usados: task, checklist,
 *     checklistItem; método transaction).
 *   - `@/lib/auth/check-project-access` (`requireProjectAccess` resuelve
 *     siempre OK salvo override por test).
 *   - `@/lib/auth/get-current-user` (devuelve un usuario fake).
 *   - `next/cache` está mockeado globalmente en `tests/setup.ts`.
 */

// ─────────────────────────── Mocks ───────────────────────────

const taskFindUnique = vi.fn()
const checklistFindUnique = vi.fn()
const checklistFindMany = vi.fn()
const checklistCreate = vi.fn()
const itemFindUnique = vi.fn()
const itemFindFirst = vi.fn()
const itemFindMany = vi.fn()
const itemCreate = vi.fn()
const itemUpdate = vi.fn()
const itemDelete = vi.fn()
const txFn = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    task: {
      findUnique: (...args: unknown[]) => taskFindUnique(...args),
    },
    checklist: {
      findUnique: (...args: unknown[]) => checklistFindUnique(...args),
      findMany: (...args: unknown[]) => checklistFindMany(...args),
      create: (...args: unknown[]) => checklistCreate(...args),
    },
    checklistItem: {
      findUnique: (...args: unknown[]) => itemFindUnique(...args),
      findFirst: (...args: unknown[]) => itemFindFirst(...args),
      findMany: (...args: unknown[]) => itemFindMany(...args),
      create: (...args: unknown[]) => itemCreate(...args),
      update: (...args: unknown[]) => itemUpdate(...args),
      delete: (...args: unknown[]) => itemDelete(...args),
    },
    $transaction: (...args: unknown[]) => txFn(...args),
  },
}))

const requireProjectAccessMock = vi.fn()
vi.mock('@/lib/auth/check-project-access', () => ({
  requireProjectAccess: (...args: unknown[]) => requireProjectAccessMock(...args),
}))

const getCurrentUserMock = vi.fn()
vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}))

// ─────────────────────────── Reset ───────────────────────────

const FAKE_NOW = new Date('2026-05-04T10:00:00.000Z')
const ITEM_BASE = {
  text: 'Item demo',
  position: 1,
  done: false,
  doneAt: null,
  doneById: null,
  createdAt: FAKE_NOW,
  updatedAt: FAKE_NOW,
}

beforeEach(() => {
  taskFindUnique.mockReset().mockResolvedValue({ id: 't1', projectId: 'p1' })
  checklistFindUnique.mockReset().mockResolvedValue(null)
  checklistFindMany.mockReset().mockResolvedValue([])
  checklistCreate.mockReset().mockImplementation(
    async ({ data, include }: { data: Record<string, unknown>; include?: unknown }) => ({
      id: 'cl-new',
      taskId: data.taskId,
      title: (data.title as string | null | undefined) ?? null,
      createdAt: FAKE_NOW,
      updatedAt: FAKE_NOW,
      items: include
        ? // Reflejar items creados en cascada si vienen en `data.items.create`.
          (
            (data.items as { create?: Array<{ text: string; position: number }> } | undefined)?.create ?? []
          ).map((it, idx) => ({
            id: `cli-${idx + 1}`,
            checklistId: 'cl-new',
            ...ITEM_BASE,
            text: it.text,
            position: it.position,
          }))
        : [],
    }),
  )
  itemFindUnique.mockReset().mockResolvedValue(null)
  itemFindFirst.mockReset().mockResolvedValue(null)
  itemFindMany.mockReset().mockResolvedValue([])
  itemCreate.mockReset().mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'cli-1',
      checklistId: data.checklistId,
      ...ITEM_BASE,
      ...data,
    }),
  )
  itemUpdate.mockReset().mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
      id: where.id,
      checklistId: 'cl-1',
      ...ITEM_BASE,
      ...data,
    }),
  )
  itemDelete.mockReset().mockResolvedValue({ id: 'cli-1' })
  txFn.mockReset().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops))
  requireProjectAccessMock.mockReset().mockResolvedValue({ id: 'u1', name: 'User', email: 'u@x', roles: [] })
  getCurrentUserMock.mockReset().mockResolvedValue({ id: 'u1', name: 'User', email: 'u@x', roles: [] })
})

// ─────────────────────────── Tests ───────────────────────────

describe('createChecklist', () => {
  it('crea checklist sin items', async () => {
    const { createChecklist } = await import('@/lib/actions/checklist')
    const out = await createChecklist({ taskId: 't1', title: 'Demo' })
    expect(out.id).toBe('cl-new')
    expect(out.title).toBe('Demo')
    expect(out.items).toEqual([])
    const callArg = checklistCreate.mock.calls.at(-1)?.[0] as {
      data: { taskId: string; title: string | null }
    }
    expect(callArg.data.taskId).toBe('t1')
    expect(callArg.data.title).toBe('Demo')
  })

  it('crea checklist con primer item incluido', async () => {
    const { createChecklist } = await import('@/lib/actions/checklist')
    const out = await createChecklist({
      taskId: 't1',
      firstItemText: 'Primer item',
    })
    expect(out.items).toHaveLength(1)
    expect(out.items[0].text).toBe('Primer item')
    expect(out.items[0].position).toBe(1)
  })

  it('rechaza cuando la task no existe como [TASK_NOT_FOUND]', async () => {
    taskFindUnique.mockResolvedValueOnce(null)
    const { createChecklist } = await import('@/lib/actions/checklist')
    await expect(
      createChecklist({ taskId: 'no-existe', title: 'X' }),
    ).rejects.toThrow(/\[TASK_NOT_FOUND\]/)
  })

  it('rechaza cuando requireProjectAccess lanza [FORBIDDEN]', async () => {
    requireProjectAccessMock.mockRejectedValueOnce(new Error('[FORBIDDEN] sin acceso'))
    const { createChecklist } = await import('@/lib/actions/checklist')
    await expect(
      createChecklist({ taskId: 't1', title: 'X' }),
    ).rejects.toThrow(/\[FORBIDDEN\]/)
  })

  it('rechaza taskId vacío como [INVALID_INPUT]', async () => {
    const { createChecklist } = await import('@/lib/actions/checklist')
    await expect(
      createChecklist({ taskId: '', title: 'X' }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })
})

describe('addChecklistItem', () => {
  beforeEach(() => {
    checklistFindUnique.mockResolvedValue({
      id: 'cl-1',
      taskId: 't1',
      task: { id: 't1', projectId: 'p1' },
    })
  })

  it('asigna position = max + 1 cuando hay items previos', async () => {
    itemFindFirst.mockResolvedValueOnce({ position: 7 })
    const { addChecklistItem } = await import('@/lib/actions/checklist')
    const out = await addChecklistItem({ checklistId: 'cl-1', text: 'Nuevo' })
    expect(out.position).toBe(8)
    const arg = itemCreate.mock.calls.at(-1)?.[0] as { data: { position: number } }
    expect(arg.data.position).toBe(8)
  })

  it('asigna position = 1 cuando el checklist está vacío', async () => {
    itemFindFirst.mockResolvedValueOnce(null)
    const { addChecklistItem } = await import('@/lib/actions/checklist')
    await addChecklistItem({ checklistId: 'cl-1', text: 'Nuevo' })
    const arg = itemCreate.mock.calls.at(-1)?.[0] as { data: { position: number } }
    expect(arg.data.position).toBe(1)
  })

  it('rechaza checklistId desconocido como [CHECKLIST_NOT_FOUND]', async () => {
    checklistFindUnique.mockResolvedValueOnce(null)
    const { addChecklistItem } = await import('@/lib/actions/checklist')
    await expect(
      addChecklistItem({ checklistId: 'no-existe', text: 'x' }),
    ).rejects.toThrow(/\[CHECKLIST_NOT_FOUND\]/)
  })

  it('rechaza texto vacío como [INVALID_INPUT]', async () => {
    const { addChecklistItem } = await import('@/lib/actions/checklist')
    await expect(
      addChecklistItem({ checklistId: 'cl-1', text: '   ' }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })
})

describe('toggleChecklistItem', () => {
  beforeEach(() => {
    itemFindUnique.mockResolvedValue({
      id: 'cli-1',
      checklistId: 'cl-1',
      done: false,
      checklist: { taskId: 't1', task: { id: 't1', projectId: 'p1' } },
    })
  })

  it('flip false → true setea doneAt y doneById', async () => {
    const { toggleChecklistItem } = await import('@/lib/actions/checklist')
    const out = await toggleChecklistItem({ itemId: 'cli-1' })
    expect(out.done).toBe(true)
    const arg = itemUpdate.mock.calls.at(-1)?.[0] as {
      data: { done: boolean; doneAt: Date | null; doneById: string | null }
    }
    expect(arg.data.done).toBe(true)
    expect(arg.data.doneAt).toBeInstanceOf(Date)
    expect(arg.data.doneById).toBe('u1')
  })

  it('flip true → false limpia doneAt y doneById', async () => {
    itemFindUnique.mockResolvedValueOnce({
      id: 'cli-1',
      checklistId: 'cl-1',
      done: true,
      checklist: { taskId: 't1', task: { id: 't1', projectId: 'p1' } },
    })
    const { toggleChecklistItem } = await import('@/lib/actions/checklist')
    await toggleChecklistItem({ itemId: 'cli-1' })
    const arg = itemUpdate.mock.calls.at(-1)?.[0] as {
      data: { done: boolean; doneAt: Date | null; doneById: string | null }
    }
    expect(arg.data.done).toBe(false)
    expect(arg.data.doneAt).toBeNull()
    expect(arg.data.doneById).toBeNull()
  })

  it('rechaza itemId desconocido como [ITEM_NOT_FOUND]', async () => {
    itemFindUnique.mockResolvedValueOnce(null)
    const { toggleChecklistItem } = await import('@/lib/actions/checklist')
    await expect(
      toggleChecklistItem({ itemId: 'cli-x' }),
    ).rejects.toThrow(/\[ITEM_NOT_FOUND\]/)
  })

  it('asigna doneById=null cuando no hay sesión', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null)
    const { toggleChecklistItem } = await import('@/lib/actions/checklist')
    await toggleChecklistItem({ itemId: 'cli-1' })
    const arg = itemUpdate.mock.calls.at(-1)?.[0] as { data: { doneById: string | null } }
    expect(arg.data.doneById).toBeNull()
  })
})

describe('deleteChecklistItem', () => {
  it('borra y delega revalidate (idempotente OK cuando existe)', async () => {
    itemFindUnique.mockResolvedValueOnce({
      id: 'cli-1',
      checklist: { taskId: 't1', task: { projectId: 'p1' } },
    })
    const { deleteChecklistItem } = await import('@/lib/actions/checklist')
    const out = await deleteChecklistItem({ itemId: 'cli-1' })
    expect(out.ok).toBe(true)
    expect(itemDelete).toHaveBeenCalledWith({ where: { id: 'cli-1' } })
  })

  it('es idempotente: NO lanza si el item no existe', async () => {
    itemFindUnique.mockResolvedValueOnce(null)
    const { deleteChecklistItem } = await import('@/lib/actions/checklist')
    await expect(
      deleteChecklistItem({ itemId: 'cli-fantasma' }),
    ).resolves.toEqual({ ok: true, itemId: 'cli-fantasma' })
    expect(itemDelete).not.toHaveBeenCalled()
  })
})

describe('reorderChecklistItems', () => {
  beforeEach(() => {
    checklistFindUnique.mockResolvedValue({
      id: 'cl-1',
      taskId: 't1',
      task: { id: 't1', projectId: 'p1' },
    })
    itemFindMany.mockResolvedValue([
      { id: 'cli-1' },
      { id: 'cli-2' },
      { id: 'cli-3' },
    ])
  })

  it('reordena items en transacción con position 1..N', async () => {
    const { reorderChecklistItems } = await import('@/lib/actions/checklist')
    const out = await reorderChecklistItems({
      checklistId: 'cl-1',
      itemIds: ['cli-3', 'cli-1', 'cli-2'],
    })
    expect(out.count).toBe(3)
    expect(txFn).toHaveBeenCalledTimes(1)
  })

  it('rechaza itemIds duplicados como [INVALID_INPUT]', async () => {
    const { reorderChecklistItems } = await import('@/lib/actions/checklist')
    await expect(
      reorderChecklistItems({
        checklistId: 'cl-1',
        itemIds: ['cli-1', 'cli-1', 'cli-2'],
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza itemIds que no pertenecen al checklist', async () => {
    const { reorderChecklistItems } = await import('@/lib/actions/checklist')
    await expect(
      reorderChecklistItems({
        checklistId: 'cl-1',
        itemIds: ['cli-1', 'cli-2', 'cli-otro'],
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza listas incompletas (no cubren todos los items)', async () => {
    const { reorderChecklistItems } = await import('@/lib/actions/checklist')
    await expect(
      reorderChecklistItems({
        checklistId: 'cl-1',
        itemIds: ['cli-1', 'cli-2'],
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })
})

describe('applyAIChecklistSuggestion', () => {
  it('crea Checklist + N items en orden con title default', async () => {
    const { applyAIChecklistSuggestion } = await import(
      '@/lib/actions/checklist'
    )
    const out = await applyAIChecklistSuggestion({
      taskId: 't1',
      items: [
        { text: 'Paso 1' },
        { text: 'Paso 2', optional: true },
        { text: 'Paso 3' },
      ],
    })
    expect(out.title).toBe('Sugerido por IA')
    expect(out.items).toHaveLength(3)
    expect(out.items.map((it) => it.position)).toEqual([1, 2, 3])
    const arg = checklistCreate.mock.calls.at(-1)?.[0] as {
      data: { items: { create: Array<{ text: string; position: number }> } }
    }
    expect(arg.data.items.create).toEqual([
      { text: 'Paso 1', position: 1 },
      { text: 'Paso 2', position: 2 },
      { text: 'Paso 3', position: 3 },
    ])
  })

  it('rechaza items vacío como [INVALID_INPUT]', async () => {
    const { applyAIChecklistSuggestion } = await import(
      '@/lib/actions/checklist'
    )
    await expect(
      applyAIChecklistSuggestion({ taskId: 't1', items: [] }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza items con text vacío como [INVALID_INPUT]', async () => {
    const { applyAIChecklistSuggestion } = await import(
      '@/lib/actions/checklist'
    )
    await expect(
      applyAIChecklistSuggestion({
        taskId: 't1',
        items: [{ text: '' }],
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('respeta title personalizado cuando se pasa', async () => {
    const { applyAIChecklistSuggestion } = await import(
      '@/lib/actions/checklist'
    )
    await applyAIChecklistSuggestion({
      taskId: 't1',
      title: 'Mi checklist custom',
      items: [{ text: 'a' }],
    })
    const arg = checklistCreate.mock.calls.at(-1)?.[0] as {
      data: { title: string }
    }
    expect(arg.data.title).toBe('Mi checklist custom')
  })

  it('lanza [TASK_NOT_FOUND] si la task no existe', async () => {
    taskFindUnique.mockResolvedValueOnce(null)
    const { applyAIChecklistSuggestion } = await import(
      '@/lib/actions/checklist'
    )
    await expect(
      applyAIChecklistSuggestion({
        taskId: 'no-existe',
        items: [{ text: 'a' }],
      }),
    ).rejects.toThrow(/\[TASK_NOT_FOUND\]/)
  })
})

describe('getChecklistsForTask', () => {
  it('devuelve lista vacía cuando no hay checklists', async () => {
    const { getChecklistsForTask } = await import('@/lib/actions/checklist')
    const out = await getChecklistsForTask('t1')
    expect(out).toEqual([])
  })

  it('mapea checklists con items ordenados', async () => {
    checklistFindMany.mockResolvedValueOnce([
      {
        id: 'cl-1',
        taskId: 't1',
        title: 'Demo',
        createdAt: FAKE_NOW,
        updatedAt: FAKE_NOW,
        items: [
          {
            id: 'cli-1',
            checklistId: 'cl-1',
            text: 'A',
            done: false,
            position: 1,
            doneAt: null,
            doneById: null,
            createdAt: FAKE_NOW,
            updatedAt: FAKE_NOW,
          },
          {
            id: 'cli-2',
            checklistId: 'cl-1',
            text: 'B',
            done: true,
            position: 2,
            doneAt: FAKE_NOW,
            doneById: 'u1',
            createdAt: FAKE_NOW,
            updatedAt: FAKE_NOW,
          },
        ],
      },
    ])
    const { getChecklistsForTask } = await import('@/lib/actions/checklist')
    const out = await getChecklistsForTask('t1')
    expect(out).toHaveLength(1)
    expect(out[0].items).toHaveLength(2)
    expect(out[0].items[1].done).toBe(true)
    expect(out[0].items[1].doneAt).toBe(FAKE_NOW.toISOString())
  })

  it('rechaza taskId vacío como [INVALID_INPUT]', async () => {
    const { getChecklistsForTask } = await import('@/lib/actions/checklist')
    await expect(getChecklistsForTask('')).rejects.toThrow(/\[INVALID_INPUT\]/)
  })
})
