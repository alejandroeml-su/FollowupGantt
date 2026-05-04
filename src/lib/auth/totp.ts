import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * TOTP (Time-based One-Time Password) RFC 6238 nativo (Ola P3 · Auth).
 *
 * Decisión técnica: NO instalar `otplib` ni `speakeasy`. Implementación
 * propia con `crypto.createHmac` (Node ≥ 16). El algoritmo es ~30
 * líneas y la criticidad amerita auditarlo en árbol propio. Compatible
 * 100% con Google Authenticator, Microsoft Authenticator, Authy,
 * 1Password — todos siguen RFC 6238 con SHA-1, 30s, 6 dígitos.
 *
 * Errores tipados:
 *   - `[INVALID_TOTP]` código incorrecto / mal formado.
 *   - `[INVALID_INPUT]` secret base32 corrupto.
 *
 * API pública:
 *   generateSecret()             → string (base32, 32 chars)
 *   buildOtpAuthUrl(...)         → URL para QR code
 *   generateCode(secret, t)      → string '123456'
 *   verifyCode(secret, code, t)  → boolean (acepta ±1 ventana de 30s)
 */

// ─── Base32 (RFC 4648, sin padding) ────────────────────────────────
// Google Authenticator usa este alfabeto. No usamos `node:` builtin
// porque Buffer no soporta base32 nativo.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  if (!clean.length) {
    throw new Error('[INVALID_INPUT] base32 vacío')
  }
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx < 0) {
      throw new Error('[INVALID_INPUT] carácter base32 inválido')
    }
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

// ─── TOTP core (RFC 6238) ──────────────────────────────────────────

const PERIOD_SECONDS = 30
const DIGITS = 6
const ALGORITHM = 'sha1' // Estándar TOTP / Google Authenticator.

/**
 * Genera un secret aleatorio de 20 bytes (160 bits, recomendado RFC
 * 4226 §4) y lo codifica como base32 sin padding.
 */
export function generateSecret(): string {
  return base32Encode(randomBytes(20))
}

/**
 * Construye la URI `otpauth://totp/...` que las apps autenticadoras
 * leen vía QR. `issuer` y `accountName` se URL-encodean.
 */
export function buildOtpAuthUrl(args: {
  secret: string
  accountName: string
  issuer?: string
}): string {
  const issuer = args.issuer || 'FollowupGantt'
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(args.accountName)}`
  const params = new URLSearchParams({
    secret: args.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/**
 * Calcula el código TOTP para un secret base32 y un timestamp Unix
 * (en segundos). Default: ahora.
 */
export function generateCode(secret: string, nowSec?: number): string {
  const key = base32Decode(secret)
  const now = Math.floor((nowSec ?? Date.now() / 1000) / PERIOD_SECONDS)

  // Counter big-endian 8 bytes (RFC 4226 §5.1).
  const counter = Buffer.alloc(8)
  // Como `now` cabe en 32 bits hasta el año 2106, escribimos los low
  // bits y dejamos los high en cero — comportamiento idéntico a las
  // libs de referencia hasta entonces.
  counter.writeUInt32BE(0, 0)
  counter.writeUInt32BE(now >>> 0, 4)

  const hmac = createHmac(ALGORITHM, key).update(counter).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff)

  const code = (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0')
  return code
}

/**
 * Verifica un código TOTP aceptando ±1 ventana de drift (±30s).
 * Comparación en tiempo constante para evitar timing attacks.
 */
export function verifyCode(
  secret: string,
  candidate: string,
  nowSec?: number,
): boolean {
  if (!candidate || !/^\d{6}$/.test(candidate)) return false
  const now = nowSec ?? Math.floor(Date.now() / 1000)
  for (const drift of [-1, 0, 1]) {
    let expected: string
    try {
      expected = generateCode(secret, now + drift * PERIOD_SECONDS)
    } catch {
      return false
    }
    const a = Buffer.from(candidate)
    const b = Buffer.from(expected)
    if (a.length === b.length && timingSafeEqual(a, b)) return true
  }
  return false
}

export const __testing = {
  PERIOD_SECONDS,
  DIGITS,
}
