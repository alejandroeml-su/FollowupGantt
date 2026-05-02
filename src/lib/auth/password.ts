import 'server-only'
import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Hash de contraseñas usando PBKDF2-SHA-512 con sal aleatoria.
 *
 * Decisión técnica (Ola P1 · Auth MVP): no podemos instalar `bcryptjs` ni
 * `argon2` en el worktree aislado (el lockfile no los incluye y `npm
 * install` arriesga romper deps). PBKDF2 viene en `node:crypto`,
 * cumple OWASP ASVS L1 con ≥210k iteraciones SHA-512 y es lo
 * suficientemente lento para defenderse de fuerza bruta sin necesidad de
 * wasm/native. Cuando Edwin apruebe instalar `bcryptjs` esta función se
 * reescribe en una iteración corta (las hashes existentes seguirán
 * verificándose porque guardamos el algoritmo en el prefijo).
 *
 * Formato del hash persistido:
 *   pbkdf2$<iter>$<saltBase64>$<hashBase64>
 *
 * Verificar:
 *   await verifyPassword(plain, stored)  → boolean
 *
 * Generar:
 *   await hashPassword(plain)            → string listo para Prisma
 */

const pbkdf2Async = promisify(pbkdf2)

const ITERATIONS = 210_000 // OWASP 2023 PBKDF2-SHA512 mínimo
const SALT_BYTES = 16
const KEY_BYTES = 64
const DIGEST = 'sha512'

export async function hashPassword(plain: string): Promise<string> {
  if (!plain || typeof plain !== 'string') {
    throw new Error('[INVALID_CREDENTIALS] password vacío')
  }
  const salt = randomBytes(SALT_BYTES)
  const hash = await pbkdf2Async(plain, salt, ITERATIONS, KEY_BYTES, DIGEST)
  return `pbkdf2$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!plain || !stored) return false
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iter = Number.parseInt(parts[1] ?? '', 10)
  if (!Number.isFinite(iter) || iter < 1000 || iter > 10_000_000) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[2] ?? '', 'base64')
    expected = Buffer.from(parts[3] ?? '', 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  const actual = await pbkdf2Async(plain, salt, iter, expected.length, DIGEST)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}
