import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave P17-C · Tests del guard SUPER_ADMIN del panel /admin.
 *
 * Cobertura:
 *  1. Sin sesión → redirect('/') + audit access.denied.
 *  2. Usuario USER → redirect('/') + audit access.denied.
 *  3. Usuario ADMIN (no SUPER_ADMIN) → redirect('/') + audit.
 *  4. Usuario SUPER_ADMIN → devuelve el SessionUser sin audit.
 *  5. requireSuperAdminOrThrow lanza [FORBIDDEN] (no redirige) para no SUPER_ADMIN.
 *  6. requireSuperAdminOrThrow lanza [UNAUTHORIZED] sin sesión.
 *  7. isCurrentUserSuperAdmin devuelve booleano sin lanzar.
 */

// `vi.mock` se hoistea al top — usar `vi.hoisted` para crear los mocks
// antes que las factories.
const {
  getCurrentUserMock,
  recordAuditEventSafeMock,
  redirectMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  recordAuditEventSafeMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { redirectTo: path })
  }),
}))

vi.mock('@/lib/prisma', () => ({ default: {} }))
vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: () => getCurrentUserMock(),
}))
vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...a: unknown[]) => recordAuditEventSafeMock(...a),
}))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/headers', () => ({
  headers: async () => ({
    get: (k: string) => {
      if (k === 'x-forwarded-for') return '10.0.0.1'
      if (k === 'user-agent') return 'vitest'
      if (k === 'x-pathname') return '/admin/workspaces'
      return null
    },
  }),
}))
vi.mock('server-only', () => ({}))

import {
  requireSuperAdmin,
  requireSuperAdminOrThrow,
  isCurrentUserSuperAdmin,
} from '@/lib/auth/check-super-admin'

beforeEach(() => {
  getCurrentUserMock.mockReset()
  recordAuditEventSafeMock.mockReset()
  redirectMock.mockClear()
})

describe('requireSuperAdmin (page/layout guard)', () => {
  it('1. sin sesión → redirect("/") + audit access.denied', async () => {
    getCurrentUserMock.mockReturnValue(null)
    await expect(requireSuperAdmin()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/')
    expect(recordAuditEventSafeMock).toHaveBeenCalledTimes(1)
    const arg = recordAuditEventSafeMock.mock.calls[0][0]
    expect(arg.action).toBe('access.denied')
    expect(arg.entityType).toBe('admin_panel')
    expect(arg.metadata.reason).toBe('UNAUTHENTICATED')
    expect(arg.actorId).toBeNull()
  })

  it('2. usuario USER → redirect + audit con reason INSUFFICIENT_ROLE', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'u-1',
      email: 'a@b.c',
      name: 'A',
      roles: ['USER'],
    })
    await expect(requireSuperAdmin()).rejects.toThrow('NEXT_REDIRECT')
    const arg = recordAuditEventSafeMock.mock.calls[0][0]
    expect(arg.metadata.reason).toBe('INSUFFICIENT_ROLE')
    expect(arg.actorId).toBe('u-1')
  })

  it('3. usuario ADMIN (no SUPER_ADMIN) → redirect + audit', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'u-2',
      email: 'admin@avante.com',
      name: 'Admin',
      roles: ['ADMIN'],
    })
    await expect(requireSuperAdmin()).rejects.toThrow('NEXT_REDIRECT')
    expect(redirectMock).toHaveBeenCalledWith('/')
    expect(recordAuditEventSafeMock).toHaveBeenCalledOnce()
  })

  it('4. SUPER_ADMIN → devuelve user, sin audit ni redirect', async () => {
    const user = {
      id: 'u-super',
      email: 'super@avante.com',
      name: 'Super',
      roles: ['SUPER_ADMIN'],
    }
    getCurrentUserMock.mockReturnValue(user)
    const out = await requireSuperAdmin()
    expect(out).toEqual(user)
    expect(redirectMock).not.toHaveBeenCalled()
    expect(recordAuditEventSafeMock).not.toHaveBeenCalled()
  })
})

describe('requireSuperAdminOrThrow (server action guard)', () => {
  it('5. usuario USER → lanza [FORBIDDEN]', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'u',
      email: 'a@b',
      name: 'A',
      roles: ['USER'],
    })
    await expect(requireSuperAdminOrThrow()).rejects.toThrow(/\[FORBIDDEN\]/)
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('6. sin sesión → lanza [UNAUTHORIZED]', async () => {
    getCurrentUserMock.mockReturnValue(null)
    await expect(requireSuperAdminOrThrow()).rejects.toThrow(/\[UNAUTHORIZED\]/)
  })
})

describe('isCurrentUserSuperAdmin', () => {
  it('7a. devuelve true para SUPER_ADMIN', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'x',
      email: 'a@b',
      name: 'A',
      roles: ['SUPER_ADMIN'],
    })
    expect(await isCurrentUserSuperAdmin()).toBe(true)
  })

  it('7b. devuelve false para USER', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'x',
      email: 'a@b',
      name: 'A',
      roles: ['USER'],
    })
    expect(await isCurrentUserSuperAdmin()).toBe(false)
  })

  it('7c. devuelve false sin sesión, sin lanzar', async () => {
    getCurrentUserMock.mockReturnValue(null)
    expect(await isCurrentUserSuperAdmin()).toBe(false)
  })
})
