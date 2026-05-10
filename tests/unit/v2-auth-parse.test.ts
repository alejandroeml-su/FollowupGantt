import { describe, it, expect } from 'vitest'

/**
 * Wave P17-B · Tests del parser/generador de API keys v2.
 *
 * Cubre:
 *   - Formato canónico `sk_<prefix>_<secret>`.
 *   - parseApiKey rechaza shapes inválidos sin throw.
 *   - generateApiKey produce keys recoverables (parse(plain) === parts).
 *   - sha256Hex es determinista.
 */

import { generateApiKey, parseApiKey, sha256Hex } from '@/lib/api/v2-auth'

describe('generateApiKey', () => {
  it('produce plaintext con prefijo sk_, prefix len 8, hash hex 64', () => {
    const k = generateApiKey()
    expect(k.plaintext.startsWith('sk_')).toBe(true)
    expect(k.prefix).toMatch(/^[0-9a-f]{8}$/)
    expect(k.hashedKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hash del plaintext es igual al hashedKey persistido', () => {
    const k = generateApiKey()
    expect(sha256Hex(k.plaintext)).toBe(k.hashedKey)
  })

  it('genera valores distintos en invocaciones consecutivas', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.plaintext).not.toBe(b.plaintext)
    expect(a.prefix).not.toBe(b.prefix)
  })
})

describe('parseApiKey', () => {
  it('parsea el plaintext canónico de generateApiKey', () => {
    const k = generateApiKey()
    const parts = parseApiKey(k.plaintext)
    expect(parts).not.toBeNull()
    expect(parts?.prefix).toBe(k.prefix)
    expect(parts?.secret.length).toBeGreaterThan(0)
  })

  it('rechaza si NO empieza con sk_', () => {
    expect(parseApiKey('fg_abcd1234_secret')).toBeNull()
    expect(parseApiKey('whatever')).toBeNull()
  })

  it('rechaza si NO incluye el separador _', () => {
    expect(parseApiKey('sk_abcd1234secret')).toBeNull()
  })

  it('rechaza si el prefix NO tiene 8 chars', () => {
    expect(parseApiKey('sk_short_secret')).toBeNull()
    expect(parseApiKey('sk_thisistooooolong_secret')).toBeNull()
  })

  it('rechaza si el secret está vacío', () => {
    expect(parseApiKey('sk_abcd1234_')).toBeNull()
  })

  it('rechaza tipos no-string', () => {
    expect(parseApiKey(null as unknown as string)).toBeNull()
    expect(parseApiKey(123 as unknown as string)).toBeNull()
  })
})

describe('sha256Hex', () => {
  it('es determinista', () => {
    expect(sha256Hex('hello')).toBe(sha256Hex('hello'))
  })

  it('distintas inputs producen distintos hashes', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'))
  })

  it('produce 64 chars hex', () => {
    expect(sha256Hex('any')).toMatch(/^[0-9a-f]{64}$/)
  })
})
