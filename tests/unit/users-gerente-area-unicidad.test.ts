import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regla de negocio · Wave P13 + UI fix 2026-05-11:
 *
 * Solo puede existir UN usuario activo con rol `GERENTE_AREA` por Gerencia.
 * `createUser`:
 *   1. Si `roleIds` incluye GERENTE_AREA → `gerenciaId` es OBLIGATORIO.
 *   2. Si ya existe otro user con role GERENTE_AREA + esa gerencia → throw
 *      `[GERENCIA_ALREADY_HAS_MANAGER]`.
 *
 * Los tests son puros · mockean prisma + invalidateCatalog + revalidatePath.
 */

const {
  prismaMock,
  revalidatePathMock,
  revalidateTagMock,
} = vi.hoisted(() => ({
  prismaMock: {
    role: {
      findMany: vi.fn(),
    },
    user: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  revalidatePathMock: vi.fn(),
  revalidateTagMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ default: prismaMock }))
vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock,
  revalidateTag: revalidateTagMock,
}))

function buildFormData(input: {
  name: string
  email: string
  roleIds?: string[]
  gerenciaId?: string | null
}): FormData {
  const fd = new FormData()
  fd.set('name', input.name)
  fd.set('email', input.email)
  for (const id of input.roleIds ?? []) fd.append('roleIds', id)
  if (input.gerenciaId !== undefined && input.gerenciaId !== null) {
    fd.set('gerenciaId', input.gerenciaId)
  }
  return fd
}

describe('createUser · regla GERENTE_AREA único por gerencia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.user.create.mockResolvedValue({ id: 'new-user' })
  })

  it('crea usuario sin rol GERENTE_AREA aunque venga gerenciaId vacío', async () => {
    prismaMock.role.findMany.mockResolvedValue([{ name: 'AGENTE' }])

    const { createUser } = await import('@/lib/actions')
    await createUser(
      buildFormData({ name: 'Juan', email: 'j@x.com', roleIds: ['role-agente'] }),
    )

    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.user.create).toHaveBeenCalledOnce()
  })

  it('rechaza GERENTE_AREA sin gerenciaId con [GERENCIA_REQUIRED]', async () => {
    prismaMock.role.findMany.mockResolvedValue([{ name: 'GERENTE_AREA' }])

    const { createUser } = await import('@/lib/actions')
    await expect(
      createUser(
        buildFormData({
          name: 'Pedro',
          email: 'p@x.com',
          roleIds: ['role-gerente'],
        }),
      ),
    ).rejects.toThrow(/GERENCIA_REQUIRED/)

    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('rechaza GERENTE_AREA cuando la gerencia ya tiene gerente con [GERENCIA_ALREADY_HAS_MANAGER]', async () => {
    prismaMock.role.findMany.mockResolvedValue([{ name: 'GERENTE_AREA' }])
    prismaMock.user.findFirst.mockResolvedValue({
      id: 'existing-user',
      name: 'Maria',
      email: 'maria@x.com',
    })

    const { createUser } = await import('@/lib/actions')
    await expect(
      createUser(
        buildFormData({
          name: 'Pedro',
          email: 'p@x.com',
          roleIds: ['role-gerente'],
          gerenciaId: 'ger-1',
        }),
      ),
    ).rejects.toThrow(/GERENCIA_ALREADY_HAS_MANAGER.*Maria/)

    expect(prismaMock.user.create).not.toHaveBeenCalled()
  })

  it('crea GERENTE_AREA cuando la gerencia está disponible', async () => {
    prismaMock.role.findMany.mockResolvedValue([{ name: 'GERENTE_AREA' }])
    prismaMock.user.findFirst.mockResolvedValue(null)

    const { createUser } = await import('@/lib/actions')
    await createUser(
      buildFormData({
        name: 'Pedro',
        email: 'p@x.com',
        roleIds: ['role-gerente'],
        gerenciaId: 'ger-2',
      }),
    )

    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: {
        gerenciaId: 'ger-2',
        roles: { some: { role: { name: 'GERENTE_AREA' } } },
      },
      select: { id: true, name: true, email: true },
    })
    expect(prismaMock.user.create).toHaveBeenCalledOnce()
    const callArgs = prismaMock.user.create.mock.calls[0][0]
    expect(callArgs.data.gerenciaId).toBe('ger-2')
  })

  it('mantiene gerenciaId también para roles distintos (no solo GERENTE_AREA)', async () => {
    prismaMock.role.findMany.mockResolvedValue([{ name: 'AGENTE' }])

    const { createUser } = await import('@/lib/actions')
    await createUser(
      buildFormData({
        name: 'Luis',
        email: 'l@x.com',
        roleIds: ['role-agente'],
        gerenciaId: 'ger-3',
      }),
    )

    // No valida unicidad porque no es GERENTE_AREA
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled()
    // Pero sí persiste gerenciaId (visibilidad heredada futura)
    const callArgs = prismaMock.user.create.mock.calls[0][0]
    expect(callArgs.data.gerenciaId).toBe('ger-3')
  })

  it('trim() limpia gerenciaId con whitespace', async () => {
    prismaMock.role.findMany.mockResolvedValue([{ name: 'GERENTE_AREA' }])
    prismaMock.user.findFirst.mockResolvedValue(null)

    const { createUser } = await import('@/lib/actions')
    await createUser(
      buildFormData({
        name: 'Ana',
        email: 'a@x.com',
        roleIds: ['role-gerente'],
        gerenciaId: '  ger-4  ',
      }),
    )

    const callArgs = prismaMock.user.create.mock.calls[0][0]
    expect(callArgs.data.gerenciaId).toBe('ger-4')
  })
})
