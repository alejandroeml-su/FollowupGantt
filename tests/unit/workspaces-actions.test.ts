import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P4 · Equipo P4-1 — Tests de los server actions de Workspaces.
 *
 * Cobertura:
 *   createWorkspace:
 *    1. crea workspace + membership OWNER.
 *    2. slug inválido → [INVALID_INPUT].
 *    3. slug duplicado (P2002) → [SLUG_DUPLICATE].
 *
 *   inviteMember:
 *    4. genera token + URL para email no miembro.
 *    5. lanza [ALREADY_MEMBER] si el email ya es miembro.
 *
 *   acceptInvitation:
 *    6. crea membership y borra invitación cuando email coincide.
 *    7. lanza [INVITATION_NOT_FOUND] si token no existe.
 *    8. lanza [INVITATION_EXPIRED] si expiró.
 *    9. lanza [FORBIDDEN] si email no coincide con la sesión.
 *
 *   removeMember:
 *   10. lanza [OWNER_REMOVAL_FORBIDDEN] al intentar quitar al OWNER.
 *   11. idempotente: removed=false si no existe membresía.
 *
 *   switchWorkspace:
 *   12. setea cookie tras validar acceso.
 */

// ─────────────────────────── Mocks ───────────────────────────

const wsCreate = vi.fn()
const wsFindUnique = vi.fn()
const wsFindFirst = vi.fn()
const wsMemberFindMany = vi.fn()
const wsMemberFindUnique = vi.fn()
const wsMemberDeleteMany = vi.fn()
const wsMemberUpsert = vi.fn()
const invFindUnique = vi.fn()
const invFindMany = vi.fn()
const invDeleteMany = vi.fn()
const invDelete = vi.fn()
const invCreate = vi.fn()
const userFindUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    workspace: {
      create: (...a: unknown[]) => wsCreate(...a),
      findUnique: (...a: unknown[]) => wsFindUnique(...a),
      findFirst: (...a: unknown[]) => wsFindFirst(...a),
    },
    workspaceMember: {
      findMany: (...a: unknown[]) => wsMemberFindMany(...a),
      findUnique: (...a: unknown[]) => wsMemberFindUnique(...a),
      deleteMany: (...a: unknown[]) => wsMemberDeleteMany(...a),
      upsert: (...a: unknown[]) => wsMemberUpsert(...a),
    },
    workspaceInvitation: {
      findUnique: (...a: unknown[]) => invFindUnique(...a),
      findMany: (...a: unknown[]) => invFindMany(...a),
      deleteMany: (...a: unknown[]) => invDeleteMany(...a),
      delete: (...a: unknown[]) => invDelete(...a),
      create: (...a: unknown[]) => invCreate(...a),
    },
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
    },
  },
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

// Cookies mock — la action sólo escribe, no lee en estos tests salvo
// `getActiveWorkspaceId` que no testeamos aquí.
const cookieSet = vi.fn()
const cookieGet = vi.fn()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    set: (...args: unknown[]) => cookieSet(...args),
    get: (...args: unknown[]) => cookieGet(...args),
    delete: vi.fn(),
  }),
}))

// Auth mocks: requireUser devuelve sesión, requireWorkspaceManager
// pasa por defecto. Tests específicos pueden sobreescribir.
const sessionUser = {
  id: 'u-current',
  email: 'edwin@avante.com',
  name: 'Edwin',
  roles: ['SUPER_ADMIN'],
}

vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: async () => sessionUser,
  requireUser: async () => sessionUser,
}))

vi.mock('@/lib/auth/check-workspace-access', () => ({
  requireWorkspaceAccess: vi.fn(async () => ({
    user: sessionUser,
    role: 'OWNER',
  })),
  requireWorkspaceManager: vi.fn(async () => ({
    user: sessionUser,
    role: 'OWNER',
  })),
}))

vi.mock('server-only', () => ({}))

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  wsCreate.mockReset()
  wsFindUnique.mockReset()
  wsFindFirst.mockReset()
  wsMemberFindMany.mockReset()
  wsMemberFindUnique.mockReset()
  wsMemberDeleteMany.mockReset()
  wsMemberUpsert.mockReset()
  invFindUnique.mockReset()
  invFindMany.mockReset()
  invDeleteMany.mockReset()
  invDelete.mockReset()
  invCreate.mockReset()
  userFindUnique.mockReset()
  cookieSet.mockReset()
  cookieGet.mockReset()

  // Defaults razonables.
  wsCreate.mockResolvedValue({ id: 'ws-new', slug: 'avante' })
  invDeleteMany.mockResolvedValue({ count: 0 })
  invCreate.mockResolvedValue({ id: 'inv-new' })
  wsMemberUpsert.mockResolvedValue({ workspaceId: 'ws1', userId: 'u-current' })
  wsMemberDeleteMany.mockResolvedValue({ count: 0 })
  invDelete.mockResolvedValue({ id: 'inv-1' })
})

// ─────────────────────────── Tests ───────────────────────────

describe('createWorkspace', () => {
  it('1. crea workspace y membership OWNER', async () => {
    const { createWorkspace: action } = await import('@/lib/actions/workspaces')
    const out = await action({ name: 'Avante', slug: 'avante' })
    expect(out).toEqual({ id: 'ws-new', slug: 'avante' })
    const args = wsCreate.mock.calls.at(-1)?.[0] as {
      data: {
        name: string
        slug: string
        ownerId: string
        members: { create: { userId: string; role: string } }
      }
    }
    expect(args.data.slug).toBe('avante')
    expect(args.data.ownerId).toBe('u-current')
    expect(args.data.members.create.role).toBe('OWNER')
  })

  it('2. rechaza slug inválido como [INVALID_INPUT]', async () => {
    const { createWorkspace: action } = await import('@/lib/actions/workspaces')
    await expect(
      action({ name: 'X', slug: 'INVALID-Slug-Caps' }),
    ).rejects.toThrow(/\[INVALID_INPUT\]/)
    await expect(action({ name: 'X', slug: '-x' })).rejects.toThrow(
      /\[INVALID_INPUT\]/,
    )
    await expect(action({ name: 'X', slug: 'a--b' })).rejects.toThrow(
      /\[INVALID_INPUT\]/,
    )
    expect(wsCreate).not.toHaveBeenCalled()
  })

  it('3. slug duplicado (P2002) lanza [SLUG_DUPLICATE]', async () => {
    const { Prisma } = await import('@prisma/client')
    wsCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique', {
        code: 'P2002',
        clientVersion: '6.0.0',
      }),
    )
    const { createWorkspace: action } = await import('@/lib/actions/workspaces')
    await expect(action({ name: 'X', slug: 'taken' })).rejects.toThrow(
      /\[SLUG_DUPLICATE\]/,
    )
  })
})

describe('inviteMember', () => {
  it('4. genera token y URL para email no miembro', async () => {
    userFindUnique.mockResolvedValue(null) // email no tiene cuenta
    const { inviteMember } = await import('@/lib/actions/workspaces')
    const out = await inviteMember({
      workspaceId: 'ws1',
      email: 'nuevo@avante.com',
      role: 'MEMBER',
      baseUrl: 'https://app.avante.com',
    })
    expect(out.token).toBeTruthy()
    expect(out.inviteUrl).toMatch(/^https:\/\/app\.avante\.com\/invite\/.+/)
    expect(out.expiresAt).toBeInstanceOf(Date)
    expect(invCreate).toHaveBeenCalled()
  })

  it('5. lanza [ALREADY_MEMBER] si el email ya es miembro', async () => {
    userFindUnique.mockResolvedValue({ id: 'u-existing' })
    wsMemberFindUnique.mockResolvedValue({ workspaceId: 'ws1' })
    const { inviteMember } = await import('@/lib/actions/workspaces')
    await expect(
      inviteMember({
        workspaceId: 'ws1',
        email: 'existente@avante.com',
        role: 'MEMBER',
      }),
    ).rejects.toThrow(/\[ALREADY_MEMBER\]/)
    expect(invCreate).not.toHaveBeenCalled()
  })
})

describe('acceptInvitation', () => {
  it('6. acepta invitación válida y crea membership', async () => {
    invFindUnique.mockResolvedValue({
      id: 'inv-1',
      workspaceId: 'ws1',
      email: 'edwin@avante.com',
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const { acceptInvitation } = await import('@/lib/actions/workspaces')
    const out = await acceptInvitation({ token: 'good-token' })
    expect(out.workspaceId).toBe('ws1')
    expect(out.role).toBe('MEMBER')
    expect(wsMemberUpsert).toHaveBeenCalled()
    expect(invDelete).toHaveBeenCalledWith({ where: { token: 'good-token' } })
  })

  it('7. lanza [INVITATION_NOT_FOUND] si el token no existe', async () => {
    invFindUnique.mockResolvedValue(null)
    const { acceptInvitation } = await import('@/lib/actions/workspaces')
    await expect(acceptInvitation({ token: 'bad' })).rejects.toThrow(
      /\[INVITATION_NOT_FOUND\]/,
    )
  })

  it('8. lanza [INVITATION_EXPIRED] si está expirada', async () => {
    invFindUnique.mockResolvedValue({
      id: 'inv-1',
      workspaceId: 'ws1',
      email: 'edwin@avante.com',
      role: 'MEMBER',
      expiresAt: new Date(Date.now() - 60_000),
    })
    const { acceptInvitation } = await import('@/lib/actions/workspaces')
    await expect(acceptInvitation({ token: 'expired' })).rejects.toThrow(
      /\[INVITATION_EXPIRED\]/,
    )
  })

  it('9. lanza [FORBIDDEN] si el email no coincide con la sesión', async () => {
    invFindUnique.mockResolvedValue({
      id: 'inv-1',
      workspaceId: 'ws1',
      email: 'otra@avante.com',
      role: 'MEMBER',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const { acceptInvitation } = await import('@/lib/actions/workspaces')
    await expect(acceptInvitation({ token: 'mismatch' })).rejects.toThrow(
      /\[FORBIDDEN\]/,
    )
  })
})

describe('removeMember', () => {
  it('10. bloquea remover al OWNER con [OWNER_REMOVAL_FORBIDDEN]', async () => {
    wsFindUnique.mockResolvedValue({ ownerId: 'u-owner' })
    const { removeMember } = await import('@/lib/actions/workspaces')
    await expect(
      removeMember({ workspaceId: 'ws1', userId: 'u-owner' }),
    ).rejects.toThrow(/\[OWNER_REMOVAL_FORBIDDEN\]/)
    expect(wsMemberDeleteMany).not.toHaveBeenCalled()
  })

  it('11. idempotente: devuelve removed=false si no existía membresía', async () => {
    wsFindUnique.mockResolvedValue({ ownerId: 'u-other' })
    wsMemberDeleteMany.mockResolvedValue({ count: 0 })
    const { removeMember } = await import('@/lib/actions/workspaces')
    const out = await removeMember({ workspaceId: 'ws1', userId: 'u-ghost' })
    expect(out).toEqual({ removed: false })
  })
})

describe('switchWorkspace', () => {
  it('12. setea la cookie x-active-workspace tras validar acceso', async () => {
    const { switchWorkspace } = await import('@/lib/actions/workspaces')
    const out = await switchWorkspace({ workspaceId: 'ws1' })
    expect(out).toEqual({ workspaceId: 'ws1' })
    expect(cookieSet).toHaveBeenCalled()
    const [name, value] = cookieSet.mock.calls.at(-1) as [string, string]
    expect(name).toBe('x-active-workspace')
    expect(value).toBe('ws1')
  })
})
