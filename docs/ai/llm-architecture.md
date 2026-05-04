# LLM adapter — Arquitectura

> Wave P7 · Equipo P7-1.
> Este adapter es la base que las features P7-2 (categorización LLM),
> P7-3 (predicción de riesgo), P7-4 (sugerencias) y P7-5 (resúmenes
> de proyecto) consumirán. La heurística determinista P5-4 se mantiene
> intacta y actúa como fallback.

## Capas

```
src/lib/ai/llm/
├─ types.ts           ← contratos públicos (LLMConfig, LLMResponse, LLMError)
├─ client.ts          ← singleton Anthropic | OpenAI (lazy import del SDK)
├─ generate.ts        ← wrapper sobre `generateText` / `generateObject`
├─ with-cache.ts      ← `unstable_cache` + tag `llm:{scope}`
├─ with-fallback.ts   ← HOF: try LLM, catch → heurística
├─ redact-pii.ts      ← regex pre-prompt
└─ metrics.ts         ← contador in-memory (calls/tokens/errors/fallbacks)
```

Las features de P7-2..5 importan **sólo desde el barrel `src/lib/ai/llm/`**
(no del SDK directamente), de modo que cualquier ajuste al adapter
se propaga sin tocar consumidores.

## Provider strategy

`resolveProvider(env)` (pure function en `client.ts`):

| Estado de env                                | Resultado          |
| -------------------------------------------- | ------------------ |
| `LLM_ENABLED=false`                          | `disabled`         |
| `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` | `anthropic`        |
| `LLM_PROVIDER=openai` + `OPENAI_API_KEY`     | `openai`           |
| Sin override: Anthropic key presente         | `anthropic`        |
| Sin override: sólo OpenAI key                | `openai`           |
| Ninguna key                                  | `disabled`         |

Cuando el provider es `disabled`, `getLLMClient()` devuelve `null`,
forzando a los consumidores a caer al fallback heurístico.

Modelos por defecto:

- Anthropic: `claude-haiku-4-5-20251001`
- OpenAI: `gpt-4o-mini`

## `generateText` vs `generateObject`

`generateLLM(opts)` decide automáticamente:

- `opts.schema` ausente → `generateText` (output: `string`).
- `opts.schema` (zod) presente → `generateObject` (output: `z.infer<schema>`).

**Recomendación**: para todas las features estructuradas (P7-2/3/4),
**siempre usar schema**. Eso garantiza:

1. Validación automática (el SDK `ai` rechaza respuestas que no
   parsean como `z.parse(object)`).
2. Tipos en consumidores sin casts.
3. Mejor retry behavior (el SDK reintenta JSON parse failures).

`generateText` se reserva para casos abiertos (ej. resúmenes en
lenguaje natural — P7-5).

## Cache strategy

`withLLMCache(fn, options)` envuelve un `() => Promise<LLMResponse<T>>`
con `unstable_cache`:

- **Key**: `llm:{scope}:{id}:{modelTag}:{hash8}` donde `hash8` es
  SHA-256 truncado del `prompt + system + schemaName`.
- **Tag**: `llm:{scope}` para invalidación granular (ej.
  `revalidateTag('llm:project-summary')` después de cambiar el
  template del prompt).
- **TTL**: default 3600s (1h). Override por call.

Por qué `unstable_cache` y no `'use cache'` (Next 16):

- `'use cache'` requiere Cache Components habilitado, no está activo
  en este proyecto.
- `unstable_cache` permite TTL programático sin migrar a un boundary
  `'use cache'`.

Deuda registrada: cuando Edwin habilite Cache Components, migrar a
`'use cache'` + `cacheTag` + `cacheLife`.

## Cost estimation

`metrics.ts` mantiene un contador in-memory por modelo
(`{calls, cacheHits, tokensIn, tokensOut, errors, fallbacks}`). El
costo concreto se calcula off-line usando los rates publicados:

| Modelo                          | $/1M input | $/1M output |
| ------------------------------- | ---------- | ----------- |
| claude-haiku-4-5-20251001       | ~$1        | ~$5         |
| gpt-4o-mini                     | ~$0.15     | ~$0.60      |

Edwin puede consultar `getLLMMetrics()` desde un endpoint admin (no
incluido en P7-1) para auditoría.

## PII redaction

`redactPII(text)` reemplaza heurísticamente:

- Emails → `[EMAIL]`
- Teléfonos (10-15 dígitos, formatos MX/genéricos) → `[PHONE]`
- RFC mexicano → `[RFC]`
- Tokens API (`fg_*`, `sk_*`, `ghp_*`, `gho_*`) → `[TOKEN]`
- Bearer tokens → `Bearer [BEARER]`
- URLs con `?token=` / `?apikey=` → preserva URL, redacta valor

**No es un escáner DLP**. Es una mitigación. Cualquier campo libre
que el usuario pegue puede contener datos sensibles que la regex no
cubra (números de cuenta, direcciones, etc.). Edwin debe seguir
tratando los prompts enviados al provider externo como datos
"shared with third party" en términos de cumplimiento.

Idempotente: aplicar `redactPII` dos veces produce el mismo output
(los placeholders no contienen patrones que vuelvan a matchear).

## Fallback heurística

`withFallback(llmFn, heuristicFn, { name })`:

1. Si `LLM_ENABLED=false` o `provider === 'disabled'` →
   directamente `heuristicFn`.
2. Si `llmFn()` lanza `LLMError` (timeout, rate limit, invalid
   response, no client) → log warning a Sentry + `heuristicFn`.
3. Si `llmFn()` resuelve → `{ source: 'llm', confidence }`.

**Garantía**: `withFallback` siempre devuelve un resultado. La UI
distingue procedencia con `source` y `provider` para que el usuario
sepa si una predicción la generó el modelo o la heurística local.

Confianza por defecto:

- LLM sin override → `0.85`.
- Heurística sin override → `0.6` (la heurística P5-4 ya devuelve la
  suya; este es sólo un piso).

## Timeouts y abort

- Default 30s por call (constante en `generate.ts`).
- AbortController interno + `opts.signal` externo encadenable vía
  `anySignal([...])`. Si cualquiera dispara `abort`, el SDK
  cancela y `generateLLM` lanza `LLMError(LLM_TIMEOUT)`.
- En contexto Server Action / Route Handler, recomendamos pasar el
  `request.signal` para que un cliente que cancele propague
  inmediatamente.

## Códigos de error

Mapeados en `mapToLLMError(err)`:

| Código                  | Origen heurístico                         |
| ----------------------- | ----------------------------------------- |
| `LLM_TIMEOUT`           | `abort`/`timeout` en mensaje              |
| `LLM_RATE_LIMIT`        | `rate limit` o `429` en mensaje           |
| `LLM_INVALID_RESPONSE`  | `NoObjectGenerated` / `TypeValidation`    |
| `LLM_NO_CLIENT`         | `getLLMClient()` devolvió null            |
| `LLM_PROVIDER_ERROR`    | catch-all para errores no clasificados    |

Los consumidores hacen `if (err instanceof LLMError && err.code === ...)`.

## Testing

`tests/unit/llm-*.test.ts` (≥ 25 casos):

- `llm-generate.test.ts` — happy path con schema, timeout, error
  mapping.
- `llm-with-fallback.test.ts` — LLM ok / LLM falla / disabled.
- `llm-redact-pii.test.ts` — 8 fixtures (emails, tokens, phones, etc.).
- `llm-with-cache.test.ts` — cache hit/miss, key construction, TTL.

Mocks:

- `vi.mock('ai', ...)` para `generateText`/`generateObject` en tests
  de `generate`.
- `vi.mock('next/cache', ...)` ya está en `tests/setup.ts` (global)
  — los tests de cache lo sobrescriben por archivo.

## Acciones para Edwin

1. Configurar `ANTHROPIC_API_KEY` en Vercel (Production + Preview).
2. Opcional: `OPENAI_API_KEY` como redundancia.
3. Mientras `LLM_ENABLED=false` (default seguro al desplegar P7-1
   sin keys), las features P5-4 actuales siguen funcionando sin cambios.
4. Tras P7-2..5: validar el dashboard de métricas (endpoint pendiente)
   para presupuestar costos.
