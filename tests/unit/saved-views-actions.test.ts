import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P2 · Equipo P2-1 — Tests de los server actions de Saved Views.
 *
 * Mockeamos `next/cache` (revalidate*, unstable_cache), `@/lib/prisma` y
 * `@/lib/auth` para evitar BD real, runtime Next y cookies.
 */

// ─────────────────────────── Mocks ───────────────────────────

const findMany = vi.fn()
const findFirst = vi.fn()
const findUnique = vi.fn()
const create = vi.fn()
const update = vi.fn()
const updateMany = vi.fn()
const deleteFn = vi.fn()
const txn = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    savedView: {
      findMany: (...args: unknown[]) => findMany(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args),
      updateMany: (...args: unknown[]) => updateMany(...args),
      delete: (...args: unknown[]) => deleteFn(...args),
    },
    $transaction: (...args: unknown[]) => txn(...args),
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache:
    (loader: (...a: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      loader(...args),
}))

const requireUser = vi.fn()
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUser(),
}))

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  findMany.mockReset()
  findMany.mockResolvedValue([])
  findFirst.mockReset()
  findFirst.mockResolvedValue(null)
  findUnique.mockReset()
  findUnique.mockResolvedValue(null)

  create.mockReset()
  create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'view-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  }))

  update.mockReset()
  update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    userId: 'u1',
    surface: 'LIST',
    name: 'Mi vista',
    isShared: false,
    isDefault: false,
    position: 1,
    filters: {},
    grouping: null,
    sorting: null,
    columnPrefs: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  }))

  updateMany.mockReset()
  updateMany.mockResolvedValue({ count: 0 })

  deleteFn.mockReset()
  deleteFn.mockResolvedValue({ id: 'view-1' })

  txn.mockReset()
  txn.mockImplementation(async (ops: unknown[]) => Promise.all(ops))

  requireUser.mockReset()
  requireUser.mockResolvedValue({ id: 'u1', name: 'Edwin', email: 'e@x.com' })
})

// ─────────────────────────── Tests ───────────────────────────

describe('createView', () => {
  it('crea una vista LIST con position incremental', async () => {
    findFirst.mockResolvedValueOnce(null) // duplicate check
    findFirst.mockResolvedValueOnce({ position: 4 }) // last position
    const { createView } = await import('@/lib/actions/saved-views')
    const out = await createView({
      name: 'Mi backlog',
      surface: 'LIST',
      filters: { status: 'TODO' },
    })
    expect(out.id).toBe('view-1')
    const callArg = create.mock.calls.at(-1)?.[0] as {
      data: { position: number; userId: string; surface: string }
    }
    expect(callArg.data.position).toBe(5)
    expect(callArg.data.userId).toBe('u1')
    expect(callArg.data.surface).toBe('LIST')
  })

  it('rechaza nombre vacío como [INVALID_INPUT]', async () => {
    const { createView } = await import('@/lib/actions/saved-views')
    await expect(
      createView({ name: '   ', surface: 'LIST', filters: {} }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza surface inválida como [INVALID_SURFACE]', async () => {
    const { createView } = await import('@/lib/actions/saved-views')
    await expect(
      // @ts-expect-error testing runtime validation
      createView({ name: 'X', surface: 'WHITEBOARD', filters: {} }),
    ).rejects.toThrow(/\[INVALID_SURFACE\]/)
  })

  it('rechaza grouping inválido como [INVALID_GROUPING]', async () => {
    const { createView } = await import('@/lib/actions/saved-views')
    await expect(
      createView({
        name: 'X',
        surface: 'LIST',
        filters: {},
        grouping: 'epic',
      }),
    ).rejects.toThrow(/\[INVALID_GROUPING\]/)
  })

  it('acepta grouping custom_field:<id>', async () => {
    const { createView } = await import('@/lib/actions/saved-views')
    const out = await createView({
      name: 'Por cliente',
      surface: 'LIST',
      filters: {},
      grouping: 'custom_field:abc123',
    })
    expect(out).toBeTruthy()
    const callArg = create.mock.calls.at(-1)?.[0] as {
      data: { grouping: string }
    }
    expect(callArg.data.grouping).toBe('custom_field:abc123')
  })

  it('rechaza nombre duplicado como [VIEW_NAME_DUPLICATE]', async () => {
    findFirst.mockResolvedValueOnce({ id: 'existing' })
    const { createView } = await import('@/lib/actions/saved-views')
    await expect(
      createView({ name: 'Duplicada', surface: 'LIST', filters: {} }),
    ).rejects.toThrow(/\[VIEW_NAME_DUPLICATE\]/)
  })

  it('rechaza acción sin sesión como [UNAUTHORIZED]', async () => {
    requireUser.mockRejectedValueOnce(new Error('[UNAUTHORIZED] Sesión requerida'))
    const { createView } = await import('@/lib/actions/saved-views')
    await expect(
      createView({ name: 'X', surface: 'LIST', filters: {} }),
    ).rejects.toThrow(/\[UNAUTHORIZED\]/)
  })
})

describe('updateView', () => {
  it('aplica cambios al owner', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'v1',
      userId: 'u1',
      surface: 'LIST',
      name: 'Original',
    })
    const { updateView } = await import('@/lib/actions/saved-views')
    const out = await updateView('v1', { name: 'Nueva' })
    expect(out.id).toBe('v1')
    const callArg = update.mock.calls.at(-1)?.[0] as {
      where: { id: string }
      data: { name?: string }
    }
    expect(callArg.data.name).toBe('Nueva')
  })

  it('rechaza no-owner como [FORBIDDEN]', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'v1',
      userId: 'OTHER_USER',
      surface: 'LIST',
      name: 'Ajena',
    })
    const { updateView } = await import('@/lib/actions/saved-views')
    await expect(updateView('v1', { name: 'Hack' })).rejects.toThrow(
      /\[FORBIDDEN\]/,
    )
  })

  it('rechaza id desconocido como [VIEW_NOT_FOUND]', async () => {
    findUnique.mockResolvedValueOnce(null)
    const { updateView } = await import('@/lib/actions/saved-views')
    await expect(updateView('v1', { name: 'X' })).rejects.toThrow(
      /\[VIEW_NOT_FOUND\]/,
    )
  })
})

describe('deleteView', () => {
  it('es idempotente cuando la vista no existe', async () => {
    findUnique.mockResolvedValueOnce(null)
    const { deleteView } = await import('@/lib/actions/saved-views')
    await expect(deleteView('missing')).resolves.toBeUndefined()
    expect(deleteFn).not.toHaveBeenCalled()
  })

  it('borra cuando el owner es el usuario actual', async () => {
    findUnique.mockResolvedValueOnce({ userId: 'u1', surface: 'LIST' })
    const { deleteView } = await import('@/lib/actions/saved-views')
    await deleteView('v1')
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'v1' } })
  })

  it('rechaza no-owner como [FORBIDDEN]', async () => {
    findUnique.mockResolvedValueOnce({ userId: 'OTHER', surface: 'LIST' })
    const { deleteView } = await import('@/lib/actions/saved-views')
    await expect(deleteView('v1')).rejects.toThrow(/\[FORBIDDEN\]/)
  })
})

describe('setDefaultView', () => {
  it('desmarca otras y marca la nueva como default', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'v1',
      userId: 'u1',
      surface: 'LIST',
    })
    const { setDefaultView } = await import('@/lib/actions/saved-views')
    await setDefaultView('v1', 'LIST')
    expect(txn).toHaveBeenCalledTimes(1)
    // Verificamos que se haya construido la operación de updateMany con isDefault:false
    const call = updateMany.mock.calls.at(-1)?.[0] as {
      where: { isDefault: boolean }
      data: { isDefault: boolean }
    }
    expect(call.where.isDefault).toBe(true)
    expect(call.data.isDefault).toBe(false)
  })

  it('rechaza si la vista no pertenece a la surface indicada', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'v1',
      userId: 'u1',
      surface: 'KANBAN',
    })
    const { setDefaultView } = await import('@/lib/actions/saved-views')
    await expect(setDefaultView('v1', 'LIST')).rejects.toThrow(
      /\[INVALID_SURFACE\]/,
    )
  })
})

describe('getViewsForUser', () => {
  it('lista las vistas del usuario para una superficie', async () => {
    findMany.mockResolvedValueOnce([
      { id: 'v1', name: 'A' },
      { id: 'v2', name: 'B' },
    ])
    const { getViewsForUser } = await import('@/lib/actions/saved-views')
    const out = await getViewsForUser('LIST')
    expect(out).toHaveLength(2)
    const args = findMany.mock.calls.at(-1)?.[0] as {
      where: { userId: string; surface: string }
    }
    expect(args.where.userId).toBe('u1')
    expect(args.where.surface).toBe('LIST')
  })

  it('rechaza surface inválida como [INVALID_SURFACE]', async () => {
    const { getViewsForUser } = await import('@/lib/actions/saved-views')
    await expect(
      // @ts-expect-error testing runtime
      getViewsForUser('FOO'),
    ).rejects.toThrow(/\[INVALID_SURFACE\]/)
  })
})

describe('getSharedViewsForOrg', () => {
  it('excluye las vistas del propio usuario', async () => {
    findMany.mockResolvedValueOnce([{ id: 's1', name: 'Compartida' }])
    const { getSharedViewsForOrg } = await import('@/lib/actions/saved-views')
    const out = await getSharedViewsForOrg('LIST')
    expect(out).toHaveLength(1)
    const args = findMany.mock.calls.at(-1)?.[0] as {
      where: {
        surface: string
        isShared: boolean
        NOT: { userId: string }
      }
    }
    expect(args.where.isShared).toBe(true)
    expect(args.where.NOT.userId).toBe('u1')
  })
})
