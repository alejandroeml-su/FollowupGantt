import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * R3.0 · Fase 2 · SSO/SAML — Tests de JIT provisioning.
 *
 * Cubre:
 *   - Vínculo existente → reutiliza userId y refresca lastLoginAt.
 *   - Email existente sin link → enlaza al user existente, no crea.
 *   - Sin user previo → crea User + crea SsoUserLink.
 *   - Sin workspaceRole y sin membership → crea WorkspaceMember MEMBER.
 *   - Con workspaceRole superior → promueve membership.
 *   - Con workspaceRole inferior → NO degrada.
 */

const findUniqueLink = vi.fn()
const updateLink = vi.fn()
const findUniqueUser = vi.fn()
const createUser = vi.fn()
const createLink = vi.fn()
const findUniqueMember = vi.fn()
const createMember = vi.fn()
const updateMember = vi.fn()

vi.mock('@/lib/prisma', () => {
  const tx = {
    ssoUserLink: {
      findUnique: (...a: unknown[]) => findUniqueLink(...a),
      update: (...a: unknown[]) => updateLink(...a),
      create: (...a: unknown[]) => createLink(...a),
    },
    user: {
      findUnique: (...a: unknown[]) => findUniqueUser(...a),
      create: (...a: unknown[]) => createUser(...a),
    },
    workspaceMember: {
      findUnique: (...a: unknown[]) => findUniqueMember(...a),
      create: (...a: unknown[]) => createMember(...a),
      update: (...a: unknown[]) => updateMember(...a),
    },
  }
  return {
    default: {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
})

async function run(profile: {
  externalId: string
  email: string
  name: string
  workspaceRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | null
}) {
  const { createOrLinkUser } = await import('@/lib/sso/provisioning')
  return createOrLinkUser({
    workspaceId: 'ws-1',
    providerId: 'prov-1',
    profile: {
      externalId: profile.externalId,
      email: profile.email,
      name: profile.name,
      workspaceRole: profile.workspaceRole ?? null,
    },
  })
}

describe('createOrLinkUser', () => {
  it('1. reutiliza el link existente y refresca lastLoginAt', async () => {
    findUniqueLink.mockResolvedValueOnce({ userId: 'user-existing' })
    findUniqueMember.mockResolvedValueOnce({ workspaceId: 'ws-1' })

    const result = await run({
      externalId: 'ext-1',
      email: 'a@b.com',
      name: 'A',
    })

    expect(result.userId).toBe('user-existing')
    expect(result.created).toBe(false)
    expect(updateLink).toHaveBeenCalledTimes(1)
    expect(createUser).not.toHaveBeenCalled()
    expect(createLink).not.toHaveBeenCalled()
  })

  it('2. enlaza a un User existente por email (no crea)', async () => {
    findUniqueLink.mockResolvedValueOnce(null)
    findUniqueUser.mockResolvedValueOnce({ id: 'user-byemail' })
    findUniqueMember.mockResolvedValueOnce({ workspaceId: 'ws-1' })

    const result = await run({
      externalId: 'ext-2',
      email: 'b@c.com',
      name: 'B',
    })

    expect(result.userId).toBe('user-byemail')
    expect(result.created).toBe(false)
    expect(createUser).not.toHaveBeenCalled()
    expect(createLink).toHaveBeenCalledTimes(1)
  })

  it('3. crea User + crea SsoUserLink cuando es first-time', async () => {
    findUniqueLink.mockResolvedValueOnce(null)
    findUniqueUser.mockResolvedValueOnce(null)
    createUser.mockResolvedValueOnce({ id: 'user-new' })
    findUniqueMember.mockResolvedValueOnce(null)

    const result = await run({
      externalId: 'ext-3',
      email: 'new@x.com',
      name: 'New',
    })

    expect(result.userId).toBe('user-new')
    expect(result.created).toBe(true)
    expect(createUser).toHaveBeenCalledWith({
      data: { email: 'new@x.com', name: 'New' },
      select: { id: true },
    })
    expect(createLink).toHaveBeenCalledTimes(1)
    expect(createMember).toHaveBeenCalledTimes(1)
    expect(createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { workspaceId: 'ws-1', userId: 'user-new', role: 'MEMBER' },
      }),
    )
  })

  it('4. promueve WorkspaceMember a rol más alto', async () => {
    findUniqueLink.mockResolvedValueOnce({ userId: 'u' })
    findUniqueMember.mockResolvedValueOnce({ role: 'MEMBER' })

    await run({
      externalId: 'e',
      email: 'a@b.com',
      name: 'A',
      workspaceRole: 'ADMIN',
    })

    expect(updateMember).toHaveBeenCalledTimes(1)
    expect(updateMember).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'ADMIN' } }),
    )
  })

  it('5. NO degrada cuando el IdP entrega un rol inferior', async () => {
    findUniqueLink.mockResolvedValueOnce({ userId: 'u' })
    findUniqueMember.mockResolvedValueOnce({ role: 'OWNER' })

    await run({
      externalId: 'e',
      email: 'a@b.com',
      name: 'A',
      workspaceRole: 'MEMBER',
    })

    expect(updateMember).not.toHaveBeenCalled()
  })

  it('6. crea WorkspaceMember MEMBER cuando no hay rol IdP ni membresía previa', async () => {
    findUniqueLink.mockResolvedValueOnce({ userId: 'u' })
    findUniqueMember.mockResolvedValueOnce(null)

    await run({
      externalId: 'e',
      email: 'a@b.com',
      name: 'A',
    })

    expect(createMember).toHaveBeenCalledTimes(1)
    expect(createMember).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { workspaceId: 'ws-1', userId: 'u', role: 'MEMBER' },
      }),
    )
  })
})
