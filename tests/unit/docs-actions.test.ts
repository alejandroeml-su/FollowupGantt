import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P2 · Equipo P2-5 — Tests de los server actions de Docs / Wikis.
 *
 * Mockeamos `next/cache`, `@/lib/prisma` y `@/lib/auth`. Cada test
 * importa `docs` con `await import` para resetear el módulo en el
 * namespace de mocks.
 */

// ─────────────────────────── Mocks ───────────────────────────

const docFindUnique = vi.fn()
const docFindFirst = vi.fn()
const docFindMany = vi.fn()
const docCreate = vi.fn()
const docUpdate = vi.fn()
const versionFindUnique = vi.fn()
const versionFindMany = vi.fn()
const versionCreate = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    doc: {
      findUnique: (...args: unknown[]) => docFindUnique(...args),
      findFirst: (...args: unknown[]) => docFindFirst(...args),
      findMany: (...args: unknown[]) => docFindMany(...args),
      create: (...args: unknown[]) => docCreate(...args),
      update: (...args: unknown[]) => docUpdate(...args),
    },
    docVersion: {
      findUnique: (...args: unknown[]) => versionFindUnique(...args),
      findMany: (...args: unknown[]) => versionFindMany(...args),
      create: (...args: unknown[]) => versionCreate(...args),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

const requireUserMock = vi.fn()
vi.mock('@/lib/auth', () => ({
  requireUser: () => requireUserMock(),
}))

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  docFindUnique.mockReset()
  docFindUnique.mockResolvedValue({ id: 'd1', isArchived: false })

  docFindFirst.mockReset()
  docFindFirst.mockResolvedValue(null)

  docFindMany.mockReset()
  docFindMany.mockResolvedValue([])

  docCreate.mockReset()
  docCreate.mockResolvedValue({ id: 'd-new' })

  docUpdate.mockReset()
  docUpdate.mockResolvedValue({ id: 'd1' })

  versionFindUnique.mockReset()
  versionFindUnique.mockResolvedValue(null)

  versionFindMany.mockReset()
  versionFindMany.mockResolvedValue([])

  versionCreate.mockReset()
  versionCreate.mockResolvedValue({ id: 'v-new' })

  requireUserMock.mockReset()
  requireUserMock.mockResolvedValue({
    id: 'u1',
    email: 'edwin@avante.com',
    name: 'Edwin',
    roles: ['SUPER_ADMIN'],
  })
})

// ─────────────────────────── Tests ───────────────────────────

describe('createDoc', () => {
  it('crea un doc raíz y devuelve id', async () => {
    const { createDoc } = await import('@/lib/actions/docs')
    const out = await createDoc({ title: 'Arquitectura' })
    expect(out.id).toBe('d-new')
    const args = docCreate.mock.calls.at(-1)?.[0] as { data: { authorId: string; title: string; parentId: string | null } }
    expect(args.data.authorId).toBe('u1')
    expect(args.data.title).toBe('Arquitectura')
    expect(args.data.parentId).toBeNull()
  })

  it('rechaza título vacío como [INVALID_INPUT]', async () => {
    const { createDoc } = await import('@/lib/actions/docs')
    await expect(createDoc({ title: '   ' })).rejects.toThrow(/\[INVALID_INPUT\]/)
  })

  it('rechaza parentId inexistente como [INVALID_PARENT]', async () => {
    docFindUnique.mockResolvedValueOnce(null)
    const { createDoc } = await import('@/lib/actions/docs')
    await expect(
      createDoc({ title: 'X', parentId: 'p-fantasma' }),
    ).rejects.toThrow(/\[INVALID_PARENT\]/)
  })

  it('rechaza colgar de un parent archivado', async () => {
    docFindUnique.mockResolvedValueOnce({ id: 'p1', isArchived: true })
    const { createDoc } = await import('@/lib/actions/docs')
    await expect(
      createDoc({ title: 'X', parentId: 'p1' }),
    ).rejects.toThrow(/\[INVALID_PARENT\]/)
  })

  it('asigna position incremental basado en max+1 entre hermanos', async () => {
    docFindFirst.mockResolvedValueOnce({ position: 7 })
    const { createDoc } = await import('@/lib/actions/docs')
    await createDoc({ title: 'X' })
    const args = docCreate.mock.calls.at(-1)?.[0] as { data: { position: number } }
    expect(args.data.position).toBe(8)
  })

  it('crea versión inicial cuando el doc nace con contenido', async () => {
    const { createDoc } = await import('@/lib/actions/docs')
    await createDoc({ title: 'X', content: '# Hola mundo' })
    expect(versionCreate).toHaveBeenCalled()
    const args = versionCreate.mock.calls.at(-1)?.[0] as { data: { content: string; changeNote: string } }
    expect(args.data.content).toBe('# Hola mundo')
    expect(args.data.changeNote).toMatch(/[Vv]ersi/)
  })

  it('NO crea versión si el doc nace vacío', async () => {
    const { createDoc } = await import('@/lib/actions/docs')
    await createDoc({ title: 'X' })
    expect(versionCreate).not.toHaveBeenCalled()
  })
})

describe('updateDoc', () => {
  it('versiona automáticamente cuando el contenido cambia', async () => {
    docFindUnique.mockResolvedValueOnce({
      id: 'd1',
      content: 'viejo',
      isArchived: false,
    })
    const { updateDoc } = await import('@/lib/actions/docs')
    await updateDoc('d1', { content: 'nuevo' })
    expect(versionCreate).toHaveBeenCalled()
    const args = versionCreate.mock.calls.at(-1)?.[0] as { data: { content: string; authorId: string } }
    expect(args.data.content).toBe('nuevo')
    expect(args.data.authorId).toBe('u1')
  })

  it('NO versiona cuando solo cambia el title', async () => {
    docFindUnique.mockResolvedValueOnce({
      id: 'd1',
      content: 'mismo',
      isArchived: false,
    })
    const { updateDoc } = await import('@/lib/actions/docs')
    await updateDoc('d1', { title: 'nuevo título' })
    expect(versionCreate).not.toHaveBeenCalled()
  })

  it('rechaza editar un doc archivado como [INVALID_INPUT]', async () => {
    docFindUnique.mockResolvedValueOnce({
      id: 'd1',
      content: 'x',
      isArchived: true,
    })
    const { updateDoc } = await import('@/lib/actions/docs')
    await expect(updateDoc('d1', { content: 'y' })).rejects.toThrow(
      /\[INVALID_INPUT\]/,
    )
  })

  it('rechaza id inexistente como [DOC_NOT_FOUND]', async () => {
    docFindUnique.mockResolvedValueOnce(null)
    const { updateDoc } = await import('@/lib/actions/docs')
    await expect(updateDoc('fantasma', { content: 'x' })).rejects.toThrow(
      /\[DOC_NOT_FOUND\]/,
    )
  })
})

describe('deleteDoc / restoreDoc (soft)', () => {
  it('marca isArchived=true en deleteDoc', async () => {
    const { deleteDoc } = await import('@/lib/actions/docs')
    await deleteDoc('d1')
    const args = docUpdate.mock.calls.at(-1)?.[0] as { where: { id: string }; data: { isArchived: boolean } }
    expect(args.where.id).toBe('d1')
    expect(args.data.isArchived).toBe(true)
  })

  it('marca isArchived=false en restoreDoc', async () => {
    const { restoreDoc } = await import('@/lib/actions/docs')
    await restoreDoc('d1')
    const args = docUpdate.mock.calls.at(-1)?.[0] as { data: { isArchived: boolean } }
    expect(args.data.isArchived).toBe(false)
  })
})

describe('moveDoc · detección de ciclos', () => {
  it('rechaza self-parent como [INVALID_PARENT]', async () => {
    const { moveDoc } = await import('@/lib/actions/docs')
    await expect(moveDoc('d1', 'd1')).rejects.toThrow(/\[INVALID_PARENT\]/)
  })

  it('rechaza colgar el doc de uno de sus descendientes', async () => {
    // Tree:  d1 → d2 → d3.  Intentar moveDoc(d1, d3) debe fallar.
    docFindUnique
      // ensureDocExists(d1)
      .mockResolvedValueOnce({ id: 'd1', isArchived: false })
      // findUnique para validar newParent (d3)
      .mockResolvedValueOnce({ id: 'd3', isArchived: false })
      // detectsCycle: cursor=d3, d3.parentId=d2
      .mockResolvedValueOnce({ parentId: 'd2' })
      // cursor=d2, d2.parentId=d1 ⇒ detecta ciclo
      .mockResolvedValueOnce({ parentId: 'd1' })

    const { moveDoc } = await import('@/lib/actions/docs')
    await expect(moveDoc('d1', 'd3')).rejects.toThrow(/\[INVALID_PARENT\]/)
  })

  it('permite mover a un padre legítimo (sin ciclo)', async () => {
    // Tree:  a, b   (siblings).  moveDoc(a, b) no debe fallar.
    docFindUnique
      .mockResolvedValueOnce({ id: 'a', isArchived: false }) // ensureDocExists
      .mockResolvedValueOnce({ id: 'b', isArchived: false }) // valida parent
      .mockResolvedValueOnce({ parentId: null }) // detectsCycle: b.parentId=null

    const { moveDoc } = await import('@/lib/actions/docs')
    await expect(moveDoc('a', 'b')).resolves.toBeUndefined()
    expect(docUpdate).toHaveBeenCalled()
  })
})

describe('getDocsTree', () => {
  it('construye jerarquía a partir de filas planas', async () => {
    docFindMany.mockResolvedValueOnce([
      {
        id: 'r',
        title: 'Raíz',
        parentId: null,
        position: 1,
        isArchived: false,
        projectId: null,
        taskId: null,
        authorId: 'u1',
        author: { id: 'u1', name: 'Edwin' },
        updatedAt: new Date(),
      },
      {
        id: 'c1',
        title: 'Hijo 1',
        parentId: 'r',
        position: 1,
        isArchived: false,
        projectId: null,
        taskId: null,
        authorId: 'u1',
        author: { id: 'u1', name: 'Edwin' },
        updatedAt: new Date(),
      },
      {
        id: 'c2',
        title: 'Hijo 2',
        parentId: 'r',
        position: 2,
        isArchived: false,
        projectId: null,
        taskId: null,
        authorId: 'u1',
        author: { id: 'u1', name: 'Edwin' },
        updatedAt: new Date(),
      },
    ])
    const { getDocsTree } = await import('@/lib/actions/docs')
    const tree = await getDocsTree()
    expect(tree).toHaveLength(1)
    expect(tree[0].id).toBe('r')
    expect(tree[0].children).toHaveLength(2)
    expect(tree[0].children.map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('por defecto excluye docs archivados (filtro en where)', async () => {
    const { getDocsTree } = await import('@/lib/actions/docs')
    await getDocsTree()
    const args = docFindMany.mock.calls.at(-1)?.[0] as { where: { isArchived?: boolean } }
    expect(args.where.isArchived).toBe(false)
  })
})

describe('restoreDocVersion', () => {
  it('rechaza versionId inexistente como [VERSION_NOT_FOUND]', async () => {
    versionFindUnique.mockResolvedValueOnce(null)
    const { restoreDocVersion } = await import('@/lib/actions/docs')
    await expect(restoreDocVersion('v-fantasma')).rejects.toThrow(
      /\[VERSION_NOT_FOUND\]/,
    )
  })

  it('aplica el contenido al doc y crea una nueva versión de auditoría', async () => {
    versionFindUnique.mockResolvedValueOnce({
      id: 'v1',
      docId: 'd1',
      content: 'estado anterior',
      createdAt: new Date('2026-04-01T10:00:00Z'),
    })
    const { restoreDocVersion } = await import('@/lib/actions/docs')
    const out = await restoreDocVersion('v1')
    expect(out.docId).toBe('d1')
    // Doc se actualiza
    const updateArg = docUpdate.mock.calls.at(-1)?.[0] as { where: { id: string }; data: { content: string } }
    expect(updateArg.where.id).toBe('d1')
    expect(updateArg.data.content).toBe('estado anterior')
    // Nueva versión registrada (audit trail)
    expect(versionCreate).toHaveBeenCalled()
    const versionArg = versionCreate.mock.calls.at(-1)?.[0] as { data: { content: string; changeNote: string } }
    expect(versionArg.data.content).toBe('estado anterior')
    expect(versionArg.data.changeNote).toMatch(/[Rr]estaurado/)
  })
})

describe('searchDocs', () => {
  it('devuelve [] para query menor a 2 chars', async () => {
    const { searchDocs } = await import('@/lib/actions/docs')
    expect(await searchDocs('a')).toEqual([])
    expect(await searchDocs('  ')).toEqual([])
    expect(docFindMany).not.toHaveBeenCalled()
  })

  it('genera snippet alrededor del primer match en content', async () => {
    docFindMany.mockResolvedValueOnce([
      {
        id: 'd1',
        title: 'Doc',
        content:
          'Texto largo previo. Aquí está la palabra clave que buscamos. Texto posterior continuando',
        projectId: null,
        taskId: null,
        updatedAt: new Date(),
      },
    ])
    const { searchDocs } = await import('@/lib/actions/docs')
    const out = await searchDocs('palabra')
    expect(out).toHaveLength(1)
    expect(out[0].snippet).toMatch(/palabra clave/i)
    // Trunca con elipsis cuando es necesario
    expect(out[0].snippet.length).toBeLessThan(120)
  })
})
