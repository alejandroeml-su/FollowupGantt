/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Generador con LLM real.
 *
 * Convierte un `StandupContext` en un `Standup` validado por zod
 * usando el adapter unificado P7-1 (`generateObject` de
 * `@/lib/ai/llm`, alias de `generateLLM` con schema). Si la key no
 * está configurada o la llamada falla, cae a la heurística
 * `buildHeuristicStandup` para no romper el cron.
 *
 * Diseño:
 *   - **Cache in-memory** por `${scope}:${id}:${date}:${tone}:${format}`
 *     con TTL 12h (auto-refresh diario, evita N llamadas concurrentes en
 *     el mismo render). Sin Redis: el server action puede invalidar con
 *     `force: true`. Es memoización a nivel feature (no duplica el
 *     cache LLM de `withLLMCache`, que es process-local + revalidate).
 *   - **Inyección**: `generator?` permite inyectar un mock LLM en tests
 *     sin tocar el adapter.
 *   - **Wave C-DEBT-3**: la llamada real ya no importa
 *     `@ai-sdk/anthropic` directo; ahora pasa por `generateObject` del
 *     adapter unificado.
 *   - **Determinismo en tests**: la heurística es determinista; el LLM
 *     real obviamente no, pero los tests sólo cubren el flujo cache +
 *     fallback con un `generator` stub.
 *
 * El prompt se construye en español (es-GT) por default. El parámetro
 * `lang` queda reservado para futura internacionalización.
 */

import { generateObject } from '@/lib/ai/llm'
import { standupSchema, type Standup } from './standup-schema'
import {
  buildHeuristicStandup,
  type HeuristicStandupOptions,
} from './heuristic-standup'
import type { StandupContext } from './build-standup-context'

// ─────────────────────────── Cache ─────────────────────────────────────

const CACHE_TTL_MS = 12 * 60 * 60 * 1000 // 12h

interface CacheEntry {
  value: Standup
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(opts: {
  scope: 'project' | 'user'
  id: string
  date: string
  tone: 'formal' | 'casual'
  format: 'standup' | 'briefing'
  lang: 'es' | 'en'
}): string {
  return `standup:${opts.scope}:${opts.id}:${opts.date}:${opts.tone}:${opts.format}:${opts.lang}`
}

/**
 * Limpia el cache. Útil en tests y desde el server action `regenerate`.
 */
export function clearStandupCache(): void {
  cache.clear()
}

// ─────────────────────────── Tipos ─────────────────────────────────────

export interface GenerateStandupOptions extends HeuristicStandupOptions {
  /** Override de tono. Default `formal`. */
  tone?: 'formal' | 'casual'
  /** `standup` (formato Scrum tradicional) o `briefing` (resumen ejecutivo). */
  format?: 'standup' | 'briefing'
  /** Idioma del output. Default `es`. */
  lang?: 'es' | 'en'
  /** Bypassea el cache (regenerate manual). */
  force?: boolean
  /**
   * Generador inyectable (mock en tests). Recibe el contexto y debe
   * devolver un objeto que satisfaga `standupSchema`. Si arroja, se cae
   * al fallback heurístico.
   */
  generator?: (ctx: StandupContext) => Promise<unknown>
  /** Reloj inyectable; default `Date.now`. */
  now?: () => number
}

// ─────────────────────────── Prompt builder ────────────────────────────

function buildSystemPrompt(format: 'standup' | 'briefing', lang: 'es' | 'en'): string {
  if (lang === 'en') {
    return [
      'You are the daily standup writer for FollowupGantt.',
      'Output valid JSON matching the provided schema. Be concise, professional, blame-neutral.',
      'Group items per user. Mention the project name only when scope is multi-project.',
      format === 'briefing'
        ? 'Style: executive briefing, focus on outcomes and risks.'
        : 'Style: classic Scrum standup (yesterday / today / blockers).',
    ].join(' ')
  }
  return [
    'Eres el redactor del daily standup de FollowupGantt (gestión PMI/Agile/ITIL).',
    'Devuelves JSON válido conforme al schema. Sé conciso, profesional y sin culpar a nadie.',
    'Agrupa los items por usuario. Menciona el nombre del proyecto sólo si el scope abarca varios.',
    format === 'briefing'
      ? 'Estilo: briefing ejecutivo, enfocado en resultados y riesgos.'
      : 'Estilo: standup Scrum clásico (ayer / hoy / bloqueos).',
    'Idioma: español (es-GT). Evita anglicismos innecesarios.',
  ].join(' ')
}

function summarizeTask(t: {
  title: string
  projectName: string
  assigneeName: string | null
  endDate: Date | null
  isMilestone: boolean
  blockerReason?: string | null
}): string {
  const milestone = t.isMilestone ? ' [hito]' : ''
  const owner = t.assigneeName ? `· ${t.assigneeName}` : '· Sin asignar'
  const due = t.endDate ? ` · vence ${t.endDate.toISOString().slice(0, 10)}` : ''
  const blocker = t.blockerReason ? ` · motivo: ${t.blockerReason}` : ''
  return `- ${t.title}${milestone} (${t.projectName}) ${owner}${due}${blocker}`
}

function buildUserPrompt(
  ctx: StandupContext,
  opts: { tone: 'formal' | 'casual'; format: 'standup' | 'briefing' },
): string {
  const lines: string[] = []
  lines.push(`Fecha: ${ctx.date}`)
  if (ctx.meta.projectName) lines.push(`Proyecto: ${ctx.meta.projectName}`)
  lines.push(`Tono: ${opts.tone}. Formato: ${opts.format}.`)
  lines.push(`Participantes: ${ctx.meta.participants.join(', ') || '—'}`)

  lines.push('\n## Ayer (DONE en últimas 24h):')
  if (ctx.yesterday.length === 0) lines.push('— sin tareas completadas —')
  for (const t of ctx.yesterday) lines.push(summarizeTask(t))

  lines.push('\n## Hoy (IN_PROGRESS + hitos próximos):')
  if (ctx.today.length === 0) lines.push('— sin tareas activas —')
  for (const t of ctx.today) lines.push(summarizeTask(t))

  lines.push('\n## Bloqueos:')
  if (ctx.blockers.length === 0) lines.push('— ninguno detectado —')
  for (const t of ctx.blockers) lines.push(summarizeTask(t))

  if (ctx.recentComments.length > 0) {
    lines.push('\n## Actividad reciente (comentarios):')
    for (const c of ctx.recentComments.slice(0, 8)) {
      lines.push(`- ${c.taskTitle} · ${c.authorName ?? 'Sistema'}`)
    }
  }

  lines.push(
    '\nGenera el JSON respetando exactamente el schema. Cada bloque ' +
      'yesterday/today debe agrupar items por usuario. Cada blocker debe tener ' +
      '"description" + (opcional) "suggestedAction". El resumen corto va en una ' +
      'línea (<= 240 chars) y el largo en markdown 5-7 líneas.',
  )

  return lines.join('\n')
}

// ─────────────────────────── Generator real (adapter unificado) ────────

/**
 * Wave C-DEBT-3: llamamos al adapter unificado en vez de
 * `@ai-sdk/anthropic` directo. `generateObject` de `@/lib/ai/llm` es
 * alias de `generateLLM` con schema → devuelve `LLMResponse<Standup>`.
 * Extraemos `.output` para preservar el contrato `Promise<unknown>` que
 * espera `generateStandup`.
 */
async function callAnthropic(
  ctx: StandupContext,
  opts: { tone: 'formal' | 'casual'; format: 'standup' | 'briefing'; lang: 'es' | 'en' },
): Promise<unknown> {
  const result = await generateObject({
    schema: standupSchema,
    system: buildSystemPrompt(opts.format, opts.lang),
    prompt: buildUserPrompt(ctx, opts),
  })
  return result.output
}

// ─────────────────────────── Generator principal ───────────────────────

/**
 * Genera el standup. Estrategia:
 *   1. Cache hit (no `force`) → retorna cacheado.
 *   2. Si hay `generator` inyectado → lo usa (tests).
 *   3. Si `ANTHROPIC_API_KEY` está set → llama al LLM real.
 *   4. En cualquier error o sin key → fallback heurístico.
 *
 * Siempre devuelve un `Standup` válido (zod-parsed).
 */
export async function generateStandup(
  ctx: StandupContext,
  opts: GenerateStandupOptions = {},
): Promise<Standup> {
  const tone = opts.tone ?? 'formal'
  const format = opts.format ?? 'standup'
  const lang = opts.lang ?? 'es'
  const now = opts.now ?? Date.now

  const key = cacheKey({
    scope: ctx.scope,
    id: ctx.scopeId,
    date: ctx.date,
    tone,
    format,
    lang,
  })

  if (!opts.force) {
    const hit = cache.get(key)
    if (hit && hit.expiresAt > now()) {
      return hit.value
    }
  }

  // Determinar generator: inyectado > LLM real > heurística.
  const useLLM =
    opts.generator !== undefined ||
    Boolean(process.env.ANTHROPIC_API_KEY)

  let value: Standup
  if (useLLM) {
    try {
      const raw = opts.generator
        ? await opts.generator(ctx)
        : await callAnthropic(ctx, { tone, format, lang })
      const parsed = standupSchema.safeParse(raw)
      if (parsed.success) {
        value = parsed.data
      } else {
        // El LLM devolvió algo inválido → fallback.
        value = buildHeuristicStandup(ctx, { tone })
      }
    } catch {
      // Timeout / red / quota → fallback.
      value = buildHeuristicStandup(ctx, { tone })
    }
  } else {
    value = buildHeuristicStandup(ctx, { tone })
  }

  cache.set(key, { value, expiresAt: now() + CACHE_TTL_MS })
  return value
}

// ─────────────────────────── Test helpers ──────────────────────────────

/**
 * Devuelve el tamaño del cache. Útil para tests; no exponer en UI.
 */
export function _internalStandupCacheSize(): number {
  return cache.size
}
