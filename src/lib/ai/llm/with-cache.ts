/**
 * Ola P7 · Equipo P7-1 · LLM adapter base — Wrapper de cache.
 *
 * Envuelve una función `() => Promise<LLMResponse<T>>` con
 * `unstable_cache` de Next.js, etiquetando con `llm:{key}` para
 * invalidación granular vía `revalidateTag('llm:project-summary:42')`.
 *
 * Decisión: usamos `unstable_cache` (no la nueva directiva `use cache`
 * de Next 16) porque:
 *   1. La spec del equipo P7-1 lo pide explícitamente.
 *   2. `unstable_cache` permite TTL programático (`revalidate: ttl`) sin
 *      mover la función a un boundary `'use cache'`.
 *   3. La nueva API requiere Cache Components habilitado, lo cual no
 *      está activado en este proyecto (P7-X queda como deuda registrada).
 *
 * Nota: Cuando esté disponible Cache Components, migrar a `use cache`
 * + `cacheTag` + `cacheLife`.
 *
 * Hash determinista: la cache key se compone de:
 *   - `key` lógico provisto por el llamador
 *   - hash SHA-256 del prompt + system + schema name + model
 *
 * Esto garantiza que un cambio en el prompt invalide el cache sin
 * tener que manipular tags manualmente.
 */

import { createHash } from 'node:crypto'
import { unstable_cache } from 'next/cache'

import { recordLLMCacheHit } from './metrics'
import type { LLMResponse } from './types'

const DEFAULT_TTL_SECONDS = 3600 // 1 hora

export interface CacheKeyParts {
  /** Identificador lógico (ej. 'project-summary'). */
  scope: string
  /** ID de entidad (ej. projectId). */
  id?: string | number
  /** Modelo concreto (ej. 'claude-haiku-4-5-...'). */
  model?: string
  /** Prompt + system + schemaName concatenados antes de hashear. */
  contentToHash?: string
}

/**
 * Construye una cache key estable. Forma final:
 *   `llm:{scope}:{id}:{modelTag}:{hash8}`
 * El hash es SHA-256 truncado a 8 chars hex (suficiente entropía para
 * dedup intra-scope, evita keys gigantes en logs).
 */
export function buildLLMCacheKey(parts: CacheKeyParts): string {
  const scope = parts.scope.trim() || 'unknown'
  const id = parts.id != null ? String(parts.id) : 'global'
  const modelTag = (parts.model ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_')
  const hash = parts.contentToHash
    ? createHash('sha256').update(parts.contentToHash).digest('hex').slice(0, 12)
    : 'nohash'
  return `llm:${scope}:${id}:${modelTag}:${hash}`
}

/** Tag asociado al scope (para `revalidateTag`). */
export function buildLLMCacheTag(scope: string): string {
  return `llm:${scope.trim() || 'unknown'}`
}

export interface WithLLMCacheOptions {
  /** Identificador lógico (ej. 'project-summary'). */
  scope: string
  /** ID de entidad. Opcional. */
  id?: string | number
  /** Modelo concreto (ej. 'claude-haiku-4-5-...'). */
  model: string
  /** Texto que define la unicidad del prompt (prompt + system + schema). */
  contentToHash: string
  /** TTL en segundos. Default 3600. */
  ttl?: number
  /** Tags adicionales. */
  extraTags?: readonly string[]
}

/**
 * Envuelve `fn` con `unstable_cache`. Cuando hay cache hit, marca el
 * `LLMResponse.cached = true` y registra el cache hit en métricas.
 *
 * Detalle: `unstable_cache` cachea por key + args. Pasamos los key
 * parts como `keyParts` (segundo argumento) para que Next los incluya
 * en su key interno; la entrada de la función va sin args (closure
 * sobre `fn`).
 */
export async function withLLMCache<T>(
  fn: () => Promise<LLMResponse<T>>,
  options: WithLLMCacheOptions,
): Promise<LLMResponse<T>> {
  const ttl = options.ttl ?? DEFAULT_TTL_SECONDS
  const key = buildLLMCacheKey({
    scope: options.scope,
    id: options.id,
    model: options.model,
    contentToHash: options.contentToHash,
  })
  const tag = buildLLMCacheTag(options.scope)
  const tags = [tag, ...(options.extraTags ?? [])]

  // `unstable_cache` no expone si fue hit/miss. Usamos un "wallclock
  // sentinel" indirecto: cacheamos la respuesta original (con
  // cached=false) y luego, al recibirla, comparamos por timestamp si
  // queremos. Más simple: cacheamos un objeto serializable y siempre
  // marcamos `cached=true` desde el segundo call. Para distinguirlo,
  // usamos un Map en memoria de "keys vistas en este proceso" (best
  // effort — perdible entre cold starts, pero suficiente para métricas
  // de runtime).
  const cachedFn = unstable_cache(
    async () => {
      const r = await fn()
      // Removemos `cached` antes de serializar; lo reescribimos en cada
      // recuperación.
      return { ...r, cached: false }
    },
    [key],
    { tags, revalidate: ttl },
  )

  const isWarm = warmKeys.has(key)
  const result = await cachedFn()
  if (isWarm) {
    recordLLMCacheHit(options.model)
    return { ...result, cached: true }
  }
  warmKeys.add(key)
  return result
}

/** Set in-memory de keys vistas (para distinguir hot vs cold). */
const warmKeys = new Set<string>()

/** Reset para tests. */
export function __resetLLMCacheWarmTracking(): void {
  warmKeys.clear()
}
