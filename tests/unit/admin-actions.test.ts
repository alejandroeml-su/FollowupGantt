import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave P17-C · Tests de las server actions del panel /admin.
 *
 * Cobertura focalizada en validaciones que NO requieren BD real:
 *  1. createAdminWorkspace rechaza slug inválido con [INVALID_INPUT].
 *  2. createAdminWorkspace propaga [SLUG_DUPLICATE] al colisionar P2002.
 *  3. archiveAdminWorkspace setea archivedAt en BD + audit log.
 *  4. deleteAdminGerencia bloquea con [HAS_PROJECTS] cuando hay proyectos activos.
 *  5. deleteAdminArea bloquea con [HAS_PROJECTS] cuando hay proyectos activos.
 *  6. updateUserRole bloquea self-demotion con [CANNOT_DEMOTE_SELF].
 *  7. updateUserRole reemplaza el rol y emite audit.
 *  8. createGlobalTemplate falla con [INVALID_PAYLOAD] cuando el payload no
 *     cumple el shape para el kind elegido.
 *  9. applyGlobalTemplateToWorkspace clona el row con workspaceId set.
 */

// vi.hoisted: las factories de vi.mock se ejecutan antes que el resto del
// módulo, así que las dependencias deben crearse vía hoisted.
const { prismaMock, requireSuperAdminOrThrowMock, recordAuditEventSafeMock, FakePrismaKnownRequestError } = vi.hoisted(() => {
  class FakePrismaKnownRequestError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.code = code
    }
  }
  return {
    requireSuperAdminOrThrowMock: vi.fn(),
    recordAuditEventSafeMock: vi.fn(),
    FakePrismaKnownRequestError,
    prismaMock: {
      workspace: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
        count: vi.fn(),
      },
      gerencia: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findUnique: vi.fn(),
      },
      area: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findUnique: vi.fn(),
      },
      project: {
        count: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      role: {
        upsert: vi.fn(),
      },
      userRole: {
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
      globalTemplate: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(async (ops: unknown[]) => {
        return Promise.all(
          ops.map((o) =>
            typeof o === 'function' ? (o as () => unknown)() : (o as Promise<unknown>),
          ),
        )
      }),
    },
  }
})

vi.mock('@/lib/auth/check-super-admin', () => ({
  requireSuperAdminOrThrow: () => requireSuperAdminOrThrowMock(),
}))

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...a: unknown[]) => recordAuditEventSafeMock(...a),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('server-only', () => ({}))

vi.mock('@/lib/prisma', () => ({ default: prismaMock }))

vi.mock('@prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: FakePrismaKnownRequestError },
}))

import {
  createAdminWorkspace,
  archiveAdminWorkspace,
  deleteAdminGerencia,
  deleteAdminArea,
  updateUserRole,
  createGlobalTemplate,
  applyGlobalTemplateToWorkspace,
} from '@/lib/actions/admin'

const SUPER = { id: 'super-1', email: 'super@a.com', name: 'Super', roles: ['SUPER_ADMIN'] }

beforeEach(() => {
  vi.resetAllMocks()
  requireSuperAdminOrThrowMock.mockResolvedValue(SUPER)
})

describe('createAdminWorkspace', () => {
  it('1. rechaza slug inválido con [INVALID_INPUT]', async () => {
    await expect(
      createAdminWorkspace({ name: 'X', slug: '--invalido--' }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
    expect(prismaMock.workspace.create).not.toHaveBeenCalled()
  })

  it('2. propaga [SLUG_DUPLICATE] al colisionar P2002', async () => {
    prismaMock.workspace.create.mockRejectedValueOnce(
      new FakePrismaKnownRequestError('dup', 'P2002'),
    )
    await expect(
      createAdminWorkspace({ name: 'X', slug: 'avante-ti' }),
    ).rejects.toThrow(/\[SLUG_DUPLICATE\]/)
  })
})

describe('archiveAdminWorkspace', () => {
  it('3. setea archivedAt y emite audit', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: 'ws-1',
      name: 'X',
      archivedAt: null,
    })
    prismaMock.workspace.update.mockResolvedValue({ id: 'ws-1' })
    const out = await archiveAdminWorkspace({ id: 'ws-1' })
    expect(out.id).toBe('ws-1')
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: expect.objectContaining({ archivedAt: expect.any(Date) }),
    })
    expect(recordAuditEventSafeMock).toHaveBeenCalledOnce()
    expect(recordAuditEventSafeMock.mock.calls[0][0].action).toBe(
      'workspace.archived',
    )
  })
})

describe('deleteAdminGerencia', () => {
  it('4. bloquea con [HAS_PROJECTS] cuando hay proyectos activos', async () => {
    prismaMock.gerencia.findUnique.mockResolvedValue({ id: 'g-1', name: 'TI' })
    prismaMock.project.count.mockResolvedValue(2)
    await expect(deleteAdminGerencia({ id: 'g-1' })).rejects.toThrow(
      /\[HAS_PROJECTS\]/,
    )
    expect(prismaMock.gerencia.delete).not.toHaveBeenCalled()
  })

  it('4b. permite eliminar gerencia sin proyectos activos', async () => {
    prismaMock.gerencia.findUnique.mockResolvedValue({ id: 'g-2', name: 'OPS' })
    prismaMock.project.count.mockResolvedValue(0)
    prismaMock.gerencia.delete.mockResolvedValue({ id: 'g-2' })
    const out = await deleteAdminGerencia({ id: 'g-2' })
    expect(out.id).toBe('g-2')
    expect(prismaMock.gerencia.delete).toHaveBeenCalledWith({
      where: { id: 'g-2' },
    })
  })
})

describe('deleteAdminArea', () => {
  it('5. bloquea con [HAS_PROJECTS] cuando el área tiene proyectos activos', async () => {
    prismaMock.area.findUnique.mockResolvedValue({
      id: 'a-1',
      name: 'Dev',
      gerenciaId: 'g-1',
    })
    prismaMock.project.count.mockResolvedValue(1)
    await expect(deleteAdminArea({ id: 'a-1' })).rejects.toThrow(
      /\[HAS_PROJECTS\]/,
    )
  })
})

describe('updateUserRole', () => {
  it('6. bloquea self-demotion con [CANNOT_DEMOTE_SELF]', async () => {
    await expect(
      updateUserRole({ userId: SUPER.id, role: 'USER' }),
    ).rejects.toThrow(/\[CANNOT_DEMOTE_SELF\]/)
    expect(prismaMock.userRole.create).not.toHaveBeenCalled()
  })

  it('7. reemplaza el rol y emite audit user.role_changed', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u-1',
      email: 'a@b.c',
      roles: [{ role: { id: 'r-old', name: 'USER' } }],
    })
    prismaMock.role.upsert.mockResolvedValue({ id: 'r-admin', name: 'ADMIN' })

    const out = await updateUserRole({ userId: 'u-1', role: 'ADMIN' })

    expect(out).toEqual({ userId: 'u-1', role: 'ADMIN' })
    expect(prismaMock.role.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'ADMIN' } }),
    )
    expect(prismaMock.$transaction).toHaveBeenCalled()
    expect(recordAuditEventSafeMock).toHaveBeenCalledOnce()
    const auditArg = recordAuditEventSafeMock.mock.calls[0][0]
    expect(auditArg.action).toBe('user.role_changed')
    expect(auditArg.before).toEqual({ roles: ['USER'] })
    expect(auditArg.after).toEqual({ roles: ['ADMIN'] })
  })
})

describe('createGlobalTemplate · validación de payload', () => {
  it('8. falla con [INVALID_PAYLOAD] si el shape no encaja con el kind', async () => {
    await expect(
      createGlobalTemplate({
        name: 'broken',
        kind: 'WBS',
        // WBS exige { tasks: [...] } no vacío.
        payload: { tasks: [] },
      }),
    ).rejects.toThrow(/\[INVALID_PAYLOAD\]/)
    expect(prismaMock.globalTemplate.create).not.toHaveBeenCalled()
  })

  it('8b. acepta payload válido para kind PROJECT', async () => {
    prismaMock.globalTemplate.create.mockResolvedValue({ id: 't-1' })
    const out = await createGlobalTemplate({
      name: 'Plantilla SCRUM',
      kind: 'PROJECT',
      payload: { name: 'Default', methodology: 'SCRUM' },
    })
    expect(out.id).toBe('t-1')
    expect(prismaMock.globalTemplate.create).toHaveBeenCalled()
  })
})

describe('applyGlobalTemplateToWorkspace', () => {
  it('9. clona el row con workspaceId set y deja el original intacto', async () => {
    prismaMock.globalTemplate.findUnique.mockResolvedValue({
      id: 't-original',
      name: 'WBS Estándar',
      kind: 'WBS',
      payload: { tasks: [{ title: 'Fase 1' }] },
    })
    prismaMock.workspace.findUnique.mockResolvedValue({ id: 'ws-1' })
    prismaMock.globalTemplate.create.mockResolvedValue({ id: 't-clon' })

    const out = await applyGlobalTemplateToWorkspace({
      templateId: 't-original',
      workspaceId: 'ws-1',
    })
    expect(out.id).toBe('t-clon')
    const createCall = prismaMock.globalTemplate.create.mock.calls.at(-1)?.[0]
    expect(createCall).toMatchObject({
      data: {
        name: 'WBS Estándar',
        kind: 'WBS',
        workspaceId: 'ws-1',
      },
    })
    // Audit log de aplicación.
    expect(
      recordAuditEventSafeMock.mock.calls.find(
        (c) => c[0].action === 'global_template.applied',
      ),
    ).toBeTruthy()
  })
})
