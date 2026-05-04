import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Tests del flujo de password reset (Ola P3 · Auth completo).
 *
 * Cubre:
 *   - requestReset(): no lanza con email inexistente (no enum).
 *   - requestReset(): persiste hash (NO el token plano) y dispara
 *     Resend con el link incluyendo el token plano.
 *   - confirmReset(): rechaza token expirado [TOKEN_EXPIRED].
 *   - confirmReset(): rechaza token ya usado [TOKEN_INVALID].
 *   - confirmReset(): éxito → actualiza password + marca usedAt + borra
 *     sesiones del usuario.
 *   - confirmReset(): rechaza password < 8 chars [INVALID_INPUT].
 */

vi.mock('server-only', () => ({}))

const userFindUnique = vi.fn()
const userUpdate = vi.fn()
const tokenCreate = vi.fn()
const tokenFindUnique = vi.fn()
const tokenUpdate = vi.fn()
const sessionDeleteMany = vi.fn()
const txnRunner = vi.fn()
const sendEmail = vi.fn()

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: (...a: unknown[]) => userFindUnique(...a),
      update: (...a: unknown[]) => userUpdate(...a),
    },
    passwordResetToken: {
      create: (...a: unknown[]) => tokenCreate(...a),
      findUnique: (...a: unknown[]) => tokenFindUnique(...a),
      update: (...a: unknown[]) => tokenUpdate(...a),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    session: {
      deleteMany: (...a: unknown[]) => sessionDeleteMany(...a),
    },
    $transaction: (ops: unknown[]) => txnRunner(ops),
  },
}))

vi.mock('@/lib/email/resend', () => ({
  getResendClient: () => ({
    emails: {
      send: (...a: unknown[]) => sendEmail(...a),
    },
  }),
  EMAIL_FROM: 'test@local',
  APP_URL: 'https://app.test',
}))

beforeEach(() => {
  userFindUnique.mockReset()
  userUpdate.mockReset()
  tokenCreate.mockReset()
  tokenFindUnique.mockReset()
  tokenUpdate.mockReset()
  sessionDeleteMany.mockReset()
  txnRunner.mockReset().mockResolvedValue([])
  sendEmail.mockReset().mockResolvedValue({ id: 'em-1' })
})

describe('requestReset', () => {
  it('1. con email inexistente NO crea token NI envía email (anti-enum) y devuelve ok', async () => {
    userFindUnique.mockResolvedValue(null)
    const { requestReset } = await import('@/lib/auth/password-reset')
    const r = await requestReset('ghost@x.com')
    expect(r).toEqual({ ok: true })
    expect(tokenCreate).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('2. crea token hasheado y envía email con link al token plano', async () => {
    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'edwin@avante.com',
      name: 'Edwin',
    })
    tokenCreate.mockResolvedValue({})
    const { requestReset } = await import('@/lib/auth/password-reset')
    await requestReset('edwin@avante.com')

    expect(tokenCreate).toHaveBeenCalledTimes(1)
    const call = tokenCreate.mock.calls[0][0]
    expect(call.data.userId).toBe('u1')
    expect(call.data.tokenHash).toMatch(/^[a-f0-9]{64}$/) // sha256 hex
    expect(call.data.expiresAt).toBeInstanceOf(Date)

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const emailArgs = sendEmail.mock.calls[0][0]
    expect(emailArgs.to).toBe('edwin@avante.com')
    expect(emailArgs.subject).toMatch(/Recuperar contraseña/i)
    expect(emailArgs.html).toContain('https://app.test/auth/reset-password?token=')
  })
})

describe('confirmReset', () => {
  it('3. rechaza password de menos de 8 chars con [INVALID_INPUT]', async () => {
    const { confirmReset } = await import('@/lib/auth/password-reset')
    await expect(confirmReset('tok', 'short')).rejects.toThrow(
      /\[INVALID_INPUT\]/,
    )
  })

  it('4. rechaza token inexistente con [TOKEN_INVALID]', async () => {
    tokenFindUnique.mockResolvedValue(null)
    const { confirmReset } = await import('@/lib/auth/password-reset')
    await expect(
      confirmReset('does-not-exist', 'newpassword123'),
    ).rejects.toThrow(/\[TOKEN_INVALID\]/)
  })

  it('5. rechaza token expirado con [TOKEN_EXPIRED]', async () => {
    const { __testing } = await import('@/lib/auth/password-reset')
    const rawToken = 'rawtoken'
    const tokenHash = __testing.hashToken(rawToken)
    tokenFindUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      tokenHash,
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    })
    const { confirmReset } = await import('@/lib/auth/password-reset')
    await expect(confirmReset(rawToken, 'newpassword123')).rejects.toThrow(
      /\[TOKEN_EXPIRED\]/,
    )
  })

  it('6. rechaza token ya consumido con [TOKEN_INVALID]', async () => {
    const { __testing } = await import('@/lib/auth/password-reset')
    const rawToken = 'usedtoken'
    const tokenHash = __testing.hashToken(rawToken)
    tokenFindUnique.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      tokenHash,
      expiresAt: new Date(Date.now() + __testing.TTL_MS),
      usedAt: new Date(),
    })
    const { confirmReset } = await import('@/lib/auth/password-reset')
    await expect(confirmReset(rawToken, 'newpassword123')).rejects.toThrow(
      /\[TOKEN_INVALID\]/,
    )
  })

  it('7. éxito → ejecuta transaction con update user + mark used + delete sessions', async () => {
    const { __testing } = await import('@/lib/auth/password-reset')
    const rawToken = 'goodtoken'
    const tokenHash = __testing.hashToken(rawToken)
    tokenFindUnique.mockResolvedValue({
      id: 't1',
      userId: 'u42',
      tokenHash,
      expiresAt: new Date(Date.now() + __testing.TTL_MS),
      usedAt: null,
    })
    const { confirmReset } = await import('@/lib/auth/password-reset')
    const result = await confirmReset(rawToken, 'newpassword123')
    expect(result.userId).toBe('u42')
    expect(txnRunner).toHaveBeenCalledTimes(1)
    // El array que recibe la transaction debe tener 3 ops.
    const ops = txnRunner.mock.calls[0][0]
    expect(Array.isArray(ops)).toBe(true)
    expect(ops.length).toBe(3)
  })
})
