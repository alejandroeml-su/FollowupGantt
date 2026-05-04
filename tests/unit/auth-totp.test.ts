import { describe, it, expect } from 'vitest'

/**
 * Tests del módulo TOTP (RFC 6238) — Ola P3 · Auth completo.
 *
 * Cubre:
 *   - Vectores de prueba RFC 6238 (Apéndice B) con secret SHA-1.
 *   - generateSecret() devuelve base32 de 32 chars (160 bits / 5).
 *   - verifyCode acepta el código actual y rechaza códigos inválidos.
 *   - verifyCode tolera ±1 ventana de drift.
 *   - base32 encode/decode roundtrip.
 *   - buildOtpAuthUrl construye URI parseable.
 */

import {
  generateSecret,
  generateCode,
  verifyCode,
  buildOtpAuthUrl,
  base32Encode,
  base32Decode,
  __testing,
} from '@/lib/auth/totp'

// El test vector clásico de RFC 6238 §B usa el ASCII secret
// "12345678901234567890". En base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
const RFC_SECRET_ASCII = '12345678901234567890'
const RFC_SECRET_BASE32 = base32Encode(Buffer.from(RFC_SECRET_ASCII, 'utf8'))

describe('TOTP — RFC 6238 vectors (SHA-1, 6 dígitos)', () => {
  it('1. T = 59  → 287082', () => {
    expect(generateCode(RFC_SECRET_BASE32, 59)).toBe('287082')
  })
  it('2. T = 1111111109 → 081804', () => {
    expect(generateCode(RFC_SECRET_BASE32, 1111111109)).toBe('081804')
  })
  it('3. T = 1111111111 → 050471', () => {
    expect(generateCode(RFC_SECRET_BASE32, 1111111111)).toBe('050471')
  })
  it('4. T = 1234567890 → 005924', () => {
    expect(generateCode(RFC_SECRET_BASE32, 1234567890)).toBe('005924')
  })
})

describe('TOTP — verifyCode', () => {
  it('5. acepta el código correcto en t=now', () => {
    const secret = generateSecret()
    const now = Math.floor(Date.now() / 1000)
    const code = generateCode(secret, now)
    expect(verifyCode(secret, code, now)).toBe(true)
  })

  it('6. tolera drift ±1 ventana (30s)', () => {
    const secret = generateSecret()
    const now = 1700000000
    const codePrev = generateCode(secret, now - __testing.PERIOD_SECONDS)
    const codeNext = generateCode(secret, now + __testing.PERIOD_SECONDS)
    expect(verifyCode(secret, codePrev, now)).toBe(true)
    expect(verifyCode(secret, codeNext, now)).toBe(true)
  })

  it('7. rechaza códigos fuera de ventana (drift > 1)', () => {
    const secret = generateSecret()
    const now = 1700000000
    const codeFar = generateCode(
      secret,
      now + 5 * __testing.PERIOD_SECONDS,
    )
    expect(verifyCode(secret, codeFar, now)).toBe(false)
  })

  it('8. rechaza formatos inválidos sin lanzar', () => {
    const secret = generateSecret()
    expect(verifyCode(secret, '12345', 0)).toBe(false) // 5 dígitos
    expect(verifyCode(secret, 'ABCDEF', 0)).toBe(false) // no numérico
    expect(verifyCode(secret, '', 0)).toBe(false)
  })
})

describe('TOTP — secret + base32', () => {
  it('9. generateSecret produce base32 de 32 chars (160 bits)', () => {
    const s = generateSecret()
    expect(s).toMatch(/^[A-Z2-7]{32}$/)
  })

  it('10. base32 roundtrip: encode→decode preserva bytes', () => {
    const buf = Buffer.from('hola, mundo!', 'utf8')
    const enc = base32Encode(buf)
    const dec = base32Decode(enc)
    expect(dec.toString('utf8')).toBe('hola, mundo!')
  })

  it('11. base32Decode lanza con caracter inválido', () => {
    expect(() => base32Decode('1234')).toThrow(/INVALID_INPUT/)
  })
})

describe('TOTP — otpauth URL', () => {
  it('12. buildOtpAuthUrl incluye issuer, secret y algoritmo', () => {
    const url = buildOtpAuthUrl({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: 'edwin@avante.com',
      issuer: 'FollowupGantt',
    })
    expect(url).toMatch(/^otpauth:\/\/totp\//)
    expect(url).toMatch(/secret=JBSWY3DPEHPK3PXP/)
    expect(url).toMatch(/issuer=FollowupGantt/)
    expect(url).toMatch(/algorithm=SHA1/)
    expect(url).toMatch(/digits=6/)
    expect(url).toMatch(/period=30/)
    expect(url).toMatch(/edwin%40avante\.com/) // email URL-encoded
  })
})
