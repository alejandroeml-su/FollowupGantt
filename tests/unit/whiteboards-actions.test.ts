import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P5 · Equipo P5-1 — Tests de los server actions de Whiteboards.
 * Mockeamos `next/cache`, `@/lib/prisma` y `@/lib/auth` para evitar BD
 * real, runtime Next y cookies de sesión.
 */

// ─────────────────────────── Mocks ───────────────────────────

const wbFindMany = vi.fn()
const wbFindUnique = vi.fn()
const wbCreate = vi.fn()
const wbUpdate = vi.fn()
const wbDelete = vi.fn()

const elFindFirst = vi.fn()
const elFindUnique = vi.fn()
const elFindMany = vi.fn()
const elCreate = vi.fn()
const elUpdate = vi.fn()
const elDelete = vi.fn()
const elDeleteMany = vi.fn()

const txn = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    whiteboard: {
      findMany: (...a: unknown[]) => wbFindMany(...a),
      findUnique: (...a: unknown[]) => wbFindUnique(...a),
      create: (...a: unknown[]) => wbCreate(...a),
      update: (...a: unknown[]) => wbUpdate(...a),
      delete: (...a: unknown[]) => wbDelete(...a),
    },
    whiteboardElement: {
      findFirst: (...a: unknown[]) => elFindFirst(...a),
      findUnique: (...a: unknown[]) => elFindUnique(...a),
      findMany: (...a: unknown[]) => elFindMany(...a),
      create: (...a: unknown[]) => elCreate(...a),
      update: (...a: unknown[]) => elUpdate(...a),
      delete: (...a: unknown[]) => elDelete(...a),
      deleteMany: (...a: unknown[]) => elDeleteMany(...a),
    },
    project: { findUnique: vi.fn() },
    $transaction: (...a: unknown[]) => txn(...a),
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache:
    (loader: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      loader(...a),
}))

const requireUser = vi.fn()
const requireProjectAccess = vi.fn()
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUser(),
  requireProjectAccess: (id: string) => requireProjectAccess(id),
}))

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  for (const fn of [
    wbFindMany,
    wbFindUnique,
    wbCreate,
    wbUpdate,
    wbDelete,
    elFindFirst,
    elFindUnique,
    elFindMany,
    elCreate,
    elUpdate,
    elDelete,
    elDeleteMany,
    txn,
    requireUser,
    requireProjectAccess,
  ]) {
    fn.mockReset()
  }

  requireUser.mockResolvedValue({ id: 'user-1', name: 'Edwin', email: 'e@x', roles: [] })
  requireProjectAccess.mockResolvedValue({ id: 'user-1', name: 'Edwin', email: 'e@x', roles: [] })

  wbFindMany.mockResolvedValue([])
  wbFindUnique.mockResolvedValue(null)
  wbCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'wb-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    isArchived: false,
    description: null,
    projectId: null,
    createdById: null,
    ...data,
  }))
  wbUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    title: 'updated',
    description: null,
    projectId: null,
    createdById: 'user-1',
    isArchived: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  }))
  wbDelete.mockResolvedValue({ id: 'wb-1' })

  elFindFirst.mockResolvedValue(null)
  elFindUnique.mockResolvedValue(null)
  elFindMany.mockResolvedValue([])
  elCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'el-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    rotation: 0,
    zIndex: 1,
    ...data,
  }))
  elUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    whiteboardId: 'wb-1',
    type: 'STICKY',
    x: 0,
    y: 0,
    width: 160,
    height: 160,
    rotation: 0,
    zIndex: 1,
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  }))
  elDelete.mockResolvedValue({ id: 'el-1' })
  elDeleteMany.mockResolvedValue({ count: 1 })

  txn.mockImplementation(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]))
})

// ─────────────────────────── Tests ───────────────────────────

describe('createWhiteboard', () => {
  it('crea pizarra con projectId valida acceso al proyecto', async () => {
    const { createWhiteboard } = await import('@/lib/actions/whiteboards')
    await createWhiteboard({ title: 'Pizarra Q3', projectId: 'p1' })
    expect(requireProjectAccess).toHaveBeenCalledWith('p1')
    expect(wbCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Pizarra Q3',
          projectId: 'p1',
          createdById: 'user-1',
        }),
      }),
    )
  })

  it('rechaza título vacío con [INVALID_INPUT]', async () => {
    const { createWhiteboard } = await import('@/lib/actions/whiteboards')
    await expect(createWhiteboard({ title: '   ' })).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('crea pizarra sin proyecto sólo requiere usuario autenticado', async () => {
    const { createWhiteboard } = await import('@/lib/actions/whiteboards')
    await createWhiteboard({ title: 'Personal' })
    expect(requireUser).toHaveBeenCalled()
    expect(requireProjectAccess).not.toHaveBeenCalled()
  })
})

describe('createElement', () => {
  it('crea sticky con zIndex incremental', async () => {
    elFindFirst.mockResolvedValueOnce({ zIndex: 5 })
    wbFindUnique.mockResolvedValueOnce({
      id: 'wb-1',
      title: 't',
      projectId: null,
      createdById: 'user-1',
    })

    const { createElement } = await import('@/lib/actions/whiteboards')
    await createElement({
      whiteboardId: 'wb-1',
      type: 'STICKY',
      x: 0,
      y: 0,
      width: 160,
      height: 160,
      rotation: 0,
      data: { kind: 'sticky', color: '#FEF08A', text: 'nota' },
    })

    expect(elCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ zIndex: 6, type: 'STICKY' }),
      }),
    )
    // Touch del whiteboard.updatedAt
    expect(wbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'wb-1' } }),
    )
  })

  it('rechaza data inválida con [INVALID_INPUT]', async () => {
    wbFindUnique.mockResolvedValueOnce({
      id: 'wb-1',
      title: 't',
      projectId: null,
      createdById: 'user-1',
    })
    const { createElement } = await import('@/lib/actions/whiteboards')
    await expect(
      createElement({
        whiteboardId: 'wb-1',
        type: 'SHAPE',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        data: { kind: 'shape', variant: 'unknown', fill: '#fff', stroke: '#000' },
      }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('lanza [NOT_FOUND] si la pizarra no existe', async () => {
    wbFindUnique.mockResolvedValueOnce(null)
    const { createElement } = await import('@/lib/actions/whiteboards')
    await expect(
      createElement({
        whiteboardId: 'missing',
        type: 'STICKY',
        x: 0,
        y: 0,
        width: 160,
        height: 160,
        rotation: 0,
        data: { kind: 'sticky', color: '#FEF08A', text: '' },
      }),
    ).rejects.toThrow(/\[NOT_FOUND\]/)
  })
})

describe('updateWhiteboardElements (autosave)', () => {
  it('aplica patches en transacción', async () => {
    wbFindUnique.mockResolvedValueOnce({
      id: 'wb-1',
      title: 't',
      projectId: null,
      createdById: 'user-1',
    })
    const { updateWhiteboardElements } = await import('@/lib/actions/whiteboards')
    await updateWhiteboardElements('wb-1', [
      { id: 'el-1', x: 10, y: 20 },
      { id: 'el-2', x: 30, y: 40 },
    ])
    expect(txn).toHaveBeenCalled()
  })

  it('no falla con array vacío', async () => {
    const { updateWhiteboardElements } = await import('@/lib/actions/whiteboards')
    await expect(updateWhiteboardElements('wb-1', [])).resolves.toBeUndefined()
    expect(txn).not.toHaveBeenCalled()
  })

  it('rechaza más de 500 patches', async () => {
    const { updateWhiteboardElements } = await import('@/lib/actions/whiteboards')
    const big = Array.from({ length: 501 }, (_, i) => ({ id: `el-${i}` }))
    await expect(updateWhiteboardElements('wb-1', big)).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('valida cada patch con zod', async () => {
    wbFindUnique.mockResolvedValueOnce({
      id: 'wb-1',
      title: 't',
      projectId: null,
      createdById: 'user-1',
    })
    const { updateWhiteboardElements } = await import('@/lib/actions/whiteboards')
    await expect(
      updateWhiteboardElements('wb-1', [{ id: '', x: 1 } as unknown as { id: string; x: number }]),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
  })
})

describe('deleteElement / deleteElements', () => {
  it('deleteElement borra y revalida', async () => {
    elFindUnique.mockResolvedValueOnce({ id: 'el-1', whiteboardId: 'wb-1' })
    wbFindUnique.mockResolvedValueOnce({
      id: 'wb-1',
      title: 't',
      projectId: null,
      createdById: 'user-1',
    })
    const { deleteElement } = await import('@/lib/actions/whiteboards')
    await deleteElement('el-1')
    expect(elDelete).toHaveBeenCalledWith({ where: { id: 'el-1' } })
  })

  it('deleteElements en lote usa deleteMany', async () => {
    wbFindUnique.mockResolvedValueOnce({
      id: 'wb-1',
      title: 't',
      projectId: null,
      createdById: 'user-1',
    })
    const { deleteElements } = await import('@/lib/actions/whiteboards')
    await deleteElements('wb-1', ['el-1', 'el-2'])
    expect(elDeleteMany).toHaveBeenCalledWith({
      where: { whiteboardId: 'wb-1', id: { in: ['el-1', 'el-2'] } },
    })
  })

  it('deleteElements con array vacío no llama prisma', async () => {
    const { deleteElements } = await import('@/lib/actions/whiteboards')
    await deleteElements('wb-1', [])
    expect(elDeleteMany).not.toHaveBeenCalled()
  })
})

describe('archive / restore', () => {
  it('archiveWhiteboard marca isArchived=true', async () => {
    wbFindUnique.mockResolvedValueOnce({
      id: 'wb-1',
      title: 't',
      projectId: null,
      createdById: 'user-1',
    })
    const { archiveWhiteboard } = await import('@/lib/actions/whiteboards')
    await archiveWhiteboard('wb-1')
    expect(wbUpdate).toHaveBeenCalledWith({
      where: { id: 'wb-1' },
      data: { isArchived: true },
    })
  })

  it('restoreWhiteboard desmarca isArchived', async () => {
    wbFindUnique.mockResolvedValueOnce({
      id: 'wb-1',
      title: 't',
      projectId: null,
      createdById: 'user-1',
    })
    const { restoreWhiteboard } = await import('@/lib/actions/whiteboards')
    await restoreWhiteboard('wb-1')
    expect(wbUpdate).toHaveBeenCalledWith({
      where: { id: 'wb-1' },
      data: { isArchived: false },
    })
  })
})

describe('setElementData', () => {
  it('valida data según el type del elemento existente', async () => {
    elFindUnique.mockResolvedValueOnce({ id: 'el-1', whiteboardId: 'wb-1', type: 'STICKY' })
    wbFindUnique.mockResolvedValueOnce({
      id: 'wb-1',
      title: 't',
      projectId: null,
      createdById: 'user-1',
    })
    const { setElementData } = await import('@/lib/actions/whiteboards')
    await setElementData('el-1', { kind: 'sticky', color: '#FEF08A', text: 'hola' })
    expect(elUpdate).toHaveBeenCalled()
  })

  it('lanza [NOT_FOUND] cuando el elemento no existe', async () => {
    elFindUnique.mockResolvedValueOnce(null)
    const { setElementData } = await import('@/lib/actions/whiteboards')
    await expect(
      setElementData('missing', { kind: 'sticky', color: '#FEF08A', text: '' }),
    ).rejects.toThrow(/\[NOT_FOUND\]/)
  })
})
