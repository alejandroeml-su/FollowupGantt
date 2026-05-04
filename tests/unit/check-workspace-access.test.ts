import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P4 · Equipo P4-1 — Tests de los helpers de acceso a workspace.
 *
 * Cobertura:
 *   requireWorkspaceAccess:
 *    1. Sin sesión → [UNAUTHORIZED].
 *    2. Workspace inexistente → [WORKSPACE_NOT_FOUND].
 *    3. Sin membresía ni admin global → [NOT_MEMBER].
 *    4. Con membresía MEMBER → ok (devuelve role).
 *    5. ADMIN global sin membresía → ok (role=null).
 *    6. workspaceId vacío → [WORKSPACE_NOT_FOUND].
 *
 *   requireWorkspaceManager:
 *    7. MEMBER → [FORBIDDEN].
 *    8. OWNER → ok.
 *
 *   getDefaultWorkspaceForUser:
 *    9. Si ya posee uno, devuelve el más antiguo sin crear.
 *   10. Si no, crea uno con membership OWNER.
 */

const findUniqueWorkspace = vi.fn()
const findFirstWorkspace = vi.fn()
const createWorkspace = vi.fn()
const findUniqueMember = vi.fn()
const findUniqueUser = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    workspace: {
      findUnique: (...a: unknown[]) => findUniqueWorkspace(...a),
      findFirst: (...a: unknown[]) => findFirstWorkspace(...a),
      create: (...a: unknown[]) => createWorkspace(...a),
    },
    workspaceMember: {
      findUnique: (...a: unknown[]) => findUniqueMember(...a),
    },
    user: {
      findUnique: (...a: unknown[]) => findUniqueUser(...a),
    },
  },
}))

vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: () => getCurrentUserMock(),
  requireUser: async () => {
    const u = getCurrentUserMock()
    if (!u) throw new Error('[UNAUTHORIZED] Sesión requerida')
    return u
  },
}))

vi.mock('server-only', () => ({}))

import {
  requireWorkspaceAccess,
  requireWorkspaceManager,
  getDefaultWorkspaceForUser,
} from '@/lib/auth/check-workspace-access'

beforeEach(() => {
  findUniqueWorkspace.mockReset()
  findFirstWorkspace.mockReset()
  createWorkspace.mockReset()
  findUniqueMember.mockReset()
  findUniqueUser.mockReset()
  getCurrentUserMock.mockReset()
})

describe('requireWorkspaceAccess', () => {
  it('1. lanza [UNAUTHORIZED] cuando no hay sesión', async () => {
    getCurrentUserMock.mockReturnValue(null)
    findUniqueWorkspace.mockResolvedValue({ id: 'ws1' })
    await expect(requireWorkspaceAccess('ws1')).rejects.toThrow(
      /\[UNAUTHORIZED\]/,
    )
  })

  it('2. lanza [WORKSPACE_NOT_FOUND] cuando el workspace no existe', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'X',
      roles: ['AGENTE'],
    })
    findUniqueWorkspace.mockResolvedValue(null)
    await expect(requireWorkspaceAccess('ws-fantasma')).rejects.toThrow(
      /\[WORKSPACE_NOT_FOUND\]/,
    )
  })

  it('3. lanza [NOT_MEMBER] cuando user no es miembro ni admin', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'X',
      roles: ['AGENTE'],
    })
    findUniqueWorkspace.mockResolvedValue({ id: 'ws1' })
    findUniqueMember.mockResolvedValue(null)
    await expect(requireWorkspaceAccess('ws1')).rejects.toThrow(
      /\[NOT_MEMBER\]/,
    )
  })

  it('4. devuelve user + role MEMBER cuando hay membresía', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.c',
      name: 'X',
      roles: ['AGENTE'],
    }
    getCurrentUserMock.mockReturnValue(user)
    findUniqueWorkspace.mockResolvedValue({ id: 'ws1' })
    findUniqueMember.mockResolvedValue({ role: 'MEMBER' })
    const out = await requireWorkspaceAccess('ws1')
    expect(out.user).toEqual(user)
    expect(out.role).toBe('MEMBER')
  })

  it('5. ADMIN global sin membresía recibe acceso global con role=null', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.c',
      name: 'Admin',
      roles: ['ADMIN'],
    }
    getCurrentUserMock.mockReturnValue(user)
    findUniqueWorkspace.mockResolvedValue({ id: 'ws1' })
    const out = await requireWorkspaceAccess('ws1')
    expect(out.user).toEqual(user)
    expect(out.role).toBeNull()
    expect(findUniqueMember).not.toHaveBeenCalled()
  })

  it('6. workspaceId vacío lanza [WORKSPACE_NOT_FOUND] sin tocar BD', async () => {
    await expect(requireWorkspaceAccess('')).rejects.toThrow(
      /\[WORKSPACE_NOT_FOUND\]/,
    )
    expect(getCurrentUserMock).not.toHaveBeenCalled()
  })
})

describe('requireWorkspaceManager', () => {
  it('7. MEMBER lanza [FORBIDDEN]', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'X',
      roles: ['AGENTE'],
    })
    findUniqueWorkspace.mockResolvedValue({ id: 'ws1' })
    findUniqueMember.mockResolvedValue({ role: 'MEMBER' })
    await expect(requireWorkspaceManager('ws1')).rejects.toThrow(
      /\[FORBIDDEN\]/,
    )
  })

  it('8. OWNER pasa el guard', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.c',
      name: 'X',
      roles: ['AGENTE'],
    }
    getCurrentUserMock.mockReturnValue(user)
    findUniqueWorkspace.mockResolvedValue({ id: 'ws1' })
    findUniqueMember.mockResolvedValue({ role: 'OWNER' })
    const out = await requireWorkspaceManager('ws1')
    expect(out.role).toBe('OWNER')
  })
})

describe('getDefaultWorkspaceForUser', () => {
  it('9. devuelve el workspace existente sin crear uno nuevo', async () => {
    findFirstWorkspace.mockResolvedValue({ id: 'ws-old', slug: 'mi-ws' })
    const out = await getDefaultWorkspaceForUser('u1')
    expect(out).toEqual({ id: 'ws-old', slug: 'mi-ws' })
    expect(createWorkspace).not.toHaveBeenCalled()
  })

  it('10. crea workspace nuevo con membership OWNER cuando no existe', async () => {
    findFirstWorkspace.mockResolvedValue(null)
    findUniqueUser.mockResolvedValue({
      email: 'edwin@avante.com',
      name: 'Edwin',
    })
    createWorkspace.mockResolvedValue({ id: 'ws-new', slug: 'my-edwin-abc123' })
    const out = await getDefaultWorkspaceForUser('abc123def456')
    expect(out.id).toBe('ws-new')
    const args = createWorkspace.mock.calls.at(-1)?.[0] as {
      data: { ownerId: string; members: { create: { role: string } } }
    }
    expect(args.data.ownerId).toBe('abc123def456')
    expect(args.data.members.create.role).toBe('OWNER')
  })
})
