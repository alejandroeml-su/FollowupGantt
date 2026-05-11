import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Mantenimiento de usuarios · update + deactivate + reactivate.
 *
 * Cobertura:
 *  - updateUser respeta la regla "1 GERENTE_AREA por gerencia" (excluye self).
 *  - updateUser reemplaza roles atómicamente (deleteMany + create en tx).
 *  - deactivateUser setea archivedAt = now().
 *  - reactivateUser setea archivedAt = null.
 */

const {
  prismaMock,
  revalidatePathMock,
  revalidateTagMock,
} = vi.hoisted(() => ({
  prismaMock: {
    role: { findMany: vi.fn() },
    user: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    userRole: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
  revalidatePathMock: vi.fn(),
  revalidateTagMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: prismaMock }))
vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: revalidateTagMock,
}))

function buildFormData(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const x of v) fd.append(k, x)
    else fd.set(k, v)
  }
  return fd
}

describe('updateUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.$transaction.mockResolvedValue([{}, { id: 'u1' }])
  })

  it('rechaza sin id con [INVALID_INPUT]', async () => {
    const { updateUser } = await import('@/lib/actions')
    await expect(
      updateUser(buildFormData({ name: 'X', email: 'x@x.com' })),
    ).rejects.toThrow(/INVALID_INPUT/)
  })

  it('respeta regla 1 GERENTE_AREA por gerencia · excluye al mismo user', async () => {
    prismaMock.role.findMany.mockResolvedValue([{ name: 'GERENTE_AREA' }])
    // Sin conflicto: findFirst retorna null porque solo busca OTROS users
    prismaMock.user.findFirst.mockResolvedValue(null)

    const { updateUser } = await import('@/lib/actions')
    await updateUser(
      buildFormData({
        id: 'u1',
        name: 'Pedro',
        email: 'p@x.com',
        roleIds: ['role-gerente'],
        gerenciaId: 'ger-1',
      }),
    )

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: 'u1' },
        gerenciaId: 'ger-1',
        roles: { some: { role: { name: 'GERENTE_AREA' } } },
      },
      select: { id: true, name: true, email: true },
    })
    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
  })

  it('lanza [GERENCIA_ALREADY_HAS_MANAGER] si otro user ya es gerente', async () => {
    prismaMock.role.findMany.mockResolvedValue([{ name: 'GERENTE_AREA' }])
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'u2',
      name: 'Maria',
      email: 'm@x.com',
    })

    const { updateUser } = await import('@/lib/actions')
    await expect(
      updateUser(
        buildFormData({
          id: 'u1',
          name: 'Pedro',
          email: 'p@x.com',
          roleIds: ['role-gerente'],
          gerenciaId: 'ger-1',
        }),
      ),
    ).rejects.toThrow(/GERENCIA_ALREADY_HAS_MANAGER.*Maria/)

    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('reemplaza roles en transacción (deleteMany + update)', async () => {
    prismaMock.role.findMany.mockResolvedValue([{ name: 'AGENTE' }])

    const { updateUser } = await import('@/lib/actions')
    await updateUser(
      buildFormData({
        id: 'u1',
        name: 'Luis',
        email: 'l@x.com',
        roleIds: ['role-agente', 'role-admin'],
      }),
    )

    expect(prismaMock.$transaction).toHaveBeenCalledOnce()
    // Verifica que los dos miembros de la transacción se construyeron
    const txArg = prismaMock.$transaction.mock.calls[0][0]
    expect(Array.isArray(txArg)).toBe(true)
    expect(txArg).toHaveLength(2)
  })
})

describe('deactivateUser / reactivateUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.update.mockResolvedValue({ id: 'u1' })
  })

  it('deactivateUser setea archivedAt = Date instance', async () => {
    const { deactivateUser } = await import('@/lib/actions')
    await deactivateUser(buildFormData({ id: 'u1' }))

    expect(prismaMock.user.update).toHaveBeenCalledOnce()
    const arg = prismaMock.user.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'u1' })
    expect(arg.data.archivedAt).toBeInstanceOf(Date)
  })

  it('reactivateUser setea archivedAt = null', async () => {
    const { reactivateUser } = await import('@/lib/actions')
    await reactivateUser(buildFormData({ id: 'u1' }))

    expect(prismaMock.user.update).toHaveBeenCalledOnce()
    const arg = prismaMock.user.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'u1' })
    expect(arg.data.archivedAt).toBe(null)
  })

  it('ambos rechazan sin id con [INVALID_INPUT]', async () => {
    const { deactivateUser, reactivateUser } = await import('@/lib/actions')
    await expect(deactivateUser(buildFormData({}))).rejects.toThrow(/INVALID_INPUT/)
    await expect(reactivateUser(buildFormData({}))).rejects.toThrow(/INVALID_INPUT/)
  })
})
