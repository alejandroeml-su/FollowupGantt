import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Ola P1 · Tests unitarios para los helpers de Auth/RBAC.
 *
 * Cobertura mínima requerida (8 casos):
 *
 *   requireProjectAccess:
 *    1. Sin sesión → [UNAUTHORIZED].
 *    2. Sin assignment ni admin → [FORBIDDEN].
 *    3. Usuario con ProjectAssignment → ok (devuelve user).
 *    4. Admin sin assignment → ok (acceso global).
 *    5. SUPER_ADMIN sin assignment → ok.
 *    6. projectId vacío → [FORBIDDEN].
 *
 *   password (verifyPassword/hashPassword):
 *    7. Hash + verify del mismo password → true.
 *    8. Verify con password incorrecto → false.
 *
 * Estrategia:
 *   - Mockeamos `@/lib/prisma` (solo `projectAssignment.findUnique`) y
 *     `@/lib/auth/get-current-user` para no tocar BD ni cookies.
 *   - El test de password usa el módulo real (PBKDF2 nativo Node).
 */

// ─── Mocks ────────────────────────────────────────────────────────

const findUniqueProjectAssignment = vi.fn()
const getCurrentUserMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    projectAssignment: {
      findUnique: (...args: unknown[]) =>
        findUniqueProjectAssignment(...args),
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

// `server-only` se importa desde varios archivos auth — vitest necesita
// stub porque marca import side-effects que rompen el render.
vi.mock('server-only', () => ({}))

// ─── SUTs ─────────────────────────────────────────────────────────

import { requireProjectAccess } from '@/lib/auth/check-project-access'
import { hashPassword, verifyPassword } from '@/lib/auth/password'

beforeEach(() => {
  findUniqueProjectAssignment.mockReset()
  getCurrentUserMock.mockReset()
})

describe('requireProjectAccess', () => {
  it('1. lanza [UNAUTHORIZED] cuando no hay sesión', async () => {
    getCurrentUserMock.mockReturnValue(null)
    await expect(requireProjectAccess('p1')).rejects.toThrow(
      /\[UNAUTHORIZED\]/,
    )
  })

  it('2. lanza [FORBIDDEN] cuando user no es admin y no tiene assignment', async () => {
    getCurrentUserMock.mockReturnValue({
      id: 'u1',
      email: 'a@b.c',
      name: 'Agente',
      roles: ['AGENTE'],
    })
    findUniqueProjectAssignment.mockResolvedValue(null)
    await expect(requireProjectAccess('p1')).rejects.toThrow(/\[FORBIDDEN\]/)
  })

  it('3. devuelve user cuando tiene ProjectAssignment', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.c',
      name: 'Agente',
      roles: ['AGENTE'],
    }
    getCurrentUserMock.mockReturnValue(user)
    findUniqueProjectAssignment.mockResolvedValue({ projectId: 'p1' })

    const result = await requireProjectAccess('p1')
    expect(result).toEqual(user)
    expect(findUniqueProjectAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_userId: { projectId: 'p1', userId: 'u1' } },
      }),
    )
  })

  it('4. ADMIN sin assignment recibe acceso global (sin tocar BD)', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.c',
      name: 'Admin',
      roles: ['ADMIN'],
    }
    getCurrentUserMock.mockReturnValue(user)
    const result = await requireProjectAccess('p1')
    expect(result).toEqual(user)
    expect(findUniqueProjectAssignment).not.toHaveBeenCalled()
  })

  it('5. SUPER_ADMIN sin assignment recibe acceso global', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.c',
      name: 'Edwin',
      roles: ['SUPER_ADMIN'],
    }
    getCurrentUserMock.mockReturnValue(user)
    const result = await requireProjectAccess('p1')
    expect(result).toEqual(user)
    expect(findUniqueProjectAssignment).not.toHaveBeenCalled()
  })

  it('6. projectId vacío lanza [FORBIDDEN] sin consultar sesión', async () => {
    await expect(requireProjectAccess('')).rejects.toThrow(/\[FORBIDDEN\]/)
    expect(getCurrentUserMock).not.toHaveBeenCalled()
  })
})

describe('hashPassword / verifyPassword', () => {
  it('7. verify del mismo password devuelve true', async () => {
    const hash = await hashPassword('Pa$$w0rd-12345')
    expect(hash).toMatch(/^pbkdf2\$\d+\$[^$]+\$[^$]+$/)
    expect(await verifyPassword('Pa$$w0rd-12345', hash)).toBe(true)
  })

  it('8. verify con password incorrecto devuelve false', async () => {
    const hash = await hashPassword('correct-password')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
    // Tampoco hace match con string vacío ni hash inválido.
    expect(await verifyPassword('', hash)).toBe(false)
    expect(await verifyPassword('correct-password', null)).toBe(false)
    expect(
      await verifyPassword('correct-password', 'no-pbkdf2-format'),
    ).toBe(false)
  })
})
