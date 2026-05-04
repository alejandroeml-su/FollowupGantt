import 'server-only'

/**
 * Rate limiter en memoria para login (Ola P3 · Auth completo).
 *
 * Estrategia:
 *   - Sliding window con `Map<key, timestamps[]>` + cleanup lazy en
 *     cada `check()`. No requiere Redis para el MVP — escala vertical
 *     hasta ~10k req/s en una instancia Node.
 *   - Key compuesta por `email:ip` para complicar bypass: un atacante
 *     debería rotar AMBOS para evadir.
 *   - Window: 15 min, max 5 intentos. Configurable via env si Edwin
 *     lo pide.
 *
 * Trade-offs:
 *   - Memoria volátil: en deploys multi-instancia (Vercel serverless,
 *     k8s replicas) cada nodo tiene su contador propio. Aceptable para
 *     P3 — un atacante coordinado por nodo aún ve mitigación parcial.
 *     Migración a Redis pendiente cuando crezca la flota (TICKET-FUT).
 *   - GC: cada `check()` elimina entradas expiradas — no necesitamos
 *     timer adicional. Sí dejamos un cleanup global opcional para
 *     entornos long-running.
 *
 * Errores tipados:
 *   - `[RATE_LIMITED]` lanzado por `assertNotLimited()`.
 *
 * API:
 *   recordAttempt(key)       → registra un intento (fallido)
 *   isLimited(key)           → boolean
 *   reset(key)               → limpia (llamar tras login exitoso)
 *   assertNotLimited(key)    → lanza [RATE_LIMITED] si excede
 */

const WINDOW_MS = 15 * 60 * 1000 // 15 minutos
const MAX_ATTEMPTS = 5

// Module-scoped singleton: en Next 16 los módulos se cachean por
// runtime (Node) o por isolate (Edge). Como esta API es server-only
// y los handlers de auth corren en Node, el Map persiste entre
// requests dentro de un mismo proceso.
const attempts: Map<string, number[]> = new Map()

function prune(timestamps: number[], now: number): number[] {
  const cutoff = now - WINDOW_MS
  // Optimización: sliding window — los timestamps están en orden
  // creciente porque siempre `push` al final. Buscamos el primero
  // dentro de ventana con findIndex (O(n) en el peor caso, pero n ≤
  // MAX_ATTEMPTS+1 normalmente).
  const idx = timestamps.findIndex((t) => t > cutoff)
  return idx < 0 ? [] : timestamps.slice(idx)
}

/**
 * Compone una key estable. Lowercasea el email y trim para evitar
 * que `Edwin@Avante.com` y `edwin@avante.com` tengan contadores
 * separados. La IP se usa raw (puede venir de `x-forwarded-for`).
 */
export function buildKey(email: string, ip: string): string {
  const e = (email ?? '').trim().toLowerCase()
  const i = (ip ?? '').trim() || 'unknown'
  return `${e}|${i}`
}

/**
 * Registra un intento fallido en `key`. Llamar SOLO tras una verificación
 * inválida (no en éxito — eso lo limpia `reset`).
 */
export function recordAttempt(key: string): void {
  const now = Date.now()
  const list = prune(attempts.get(key) ?? [], now)
  list.push(now)
  attempts.set(key, list)
}

export function isLimited(key: string): boolean {
  const now = Date.now()
  const list = prune(attempts.get(key) ?? [], now)
  if (list.length === 0) {
    attempts.delete(key)
    return false
  }
  attempts.set(key, list) // persistir prune
  return list.length >= MAX_ATTEMPTS
}

/**
 * Lanza `[RATE_LIMITED]` si la key excede el cupo. Mensaje en
 * español para mostrar directo en UI. Incluye `retryAfterSec`.
 */
export function assertNotLimited(key: string): void {
  const now = Date.now()
  const list = prune(attempts.get(key) ?? [], now)
  if (list.length >= MAX_ATTEMPTS) {
    const oldest = list[0] ?? now
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldest + WINDOW_MS - now) / 1000),
    )
    throw new Error(
      `[RATE_LIMITED] Demasiados intentos. Reintenta en ${retryAfterSec}s.`,
    )
  }
}

/**
 * Limpia los intentos de una key. Llamar tras login exitoso.
 */
export function reset(key: string): void {
  attempts.delete(key)
}

/**
 * Cleanup global — recorre todo el map y poda entradas expiradas.
 * Útil para tests o si se quiere agendar un timer en runtime.
 */
export function cleanup(): number {
  const now = Date.now()
  let removed = 0
  for (const [k, list] of attempts) {
    const pruned = prune(list, now)
    if (pruned.length === 0) {
      attempts.delete(k)
      removed++
    } else if (pruned.length !== list.length) {
      attempts.set(k, pruned)
    }
  }
  return removed
}

// Helpers para tests — NO usar en producción.
export const __testing = {
  WINDOW_MS,
  MAX_ATTEMPTS,
  clear: () => attempts.clear(),
  size: () => attempts.size,
}
