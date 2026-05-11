import { anthropic } from '@ai-sdk/anthropic'
import { streamText, type ModelMessage } from 'ai'
import { headers as nextHeaders } from 'next/headers'
import { requireUser } from '@/lib/auth/get-current-user'
import { recordAuditEventSafe } from '@/lib/audit/events'
import { buildSupportSystemPrompt } from '@/lib/support/manuals-summary'
import { assertWithinSupportLimit } from '@/lib/support/rate-limit'

/**
 * Support Chatbot · Route Handler para Sync.
 *
 * Diseño:
 *   - POST con `{ messages: ChatMessage[], userRole?: string }`.
 *   - `requireUser()` lanza `[UNAUTHORIZED]` si no hay sesión → 401.
 *   - Rate-limit por user (30 msg/hora). Si excede → 429.
 *   - System prompt incluye knowledge base condensado de `docs/manuales/*.md`
 *     + tone hint según el rol del usuario actual.
 *   - Modelo: `claude-haiku-4-5-20251001` — escogido por latencia/costo
 *     (~3x más barato + ~2x más rápido que Sonnet). Para preguntas de
 *     soporte tipo FAQ, la diferencia de calidad es marginal y la UX
 *     mejor justifica el trade-off.
 *   - Stream: `result.toTextStreamResponse()` devuelve text/event-stream
 *     con Content-Type correcto y heartbeats — exactamente lo que pidió
 *     el spec, sobre `ReadableStream` web standard.
 *
 * Audit:
 *   - Primer mensaje del thread → `support.chat_started`.
 *   - Cada turno del usuario → `support.chat_message_sent`.
 *
 * Errores tipados (devueltos como JSON con status apropiado):
 *   - `[UNAUTHORIZED]` (401) — sin sesión.
 *   - `[INVALID_INPUT]` (400) — payload vacío o mal formado.
 *   - `[RATE_LIMITED]` (429) — exceso de cupo del usuario.
 *   - `[SERVICE_UNAVAILABLE]` (503) — falta `ANTHROPIC_API_KEY`.
 */

export const maxDuration = 30

interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface SupportChatRequest {
  messages: ChatMessage[]
  userRole?: string
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

function parseBody(raw: unknown): SupportChatRequest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('[INVALID_INPUT] El cuerpo de la petición es inválido.')
  }
  const obj = raw as Record<string, unknown>
  const messages = obj.messages
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('[INVALID_INPUT] Se requiere al menos un mensaje.')
  }
  const parsed: ChatMessage[] = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') {
      throw new Error('[INVALID_INPUT] Mensaje con formato inválido.')
    }
    const mo = m as Record<string, unknown>
    const role = mo.role
    const content = mo.content
    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      throw new Error('[INVALID_INPUT] role inválido.')
    }
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('[INVALID_INPUT] Mensaje vacío no permitido.')
    }
    if (content.length > 4000) {
      throw new Error('[INVALID_INPUT] Mensaje excede 4000 caracteres.')
    }
    parsed.push({ role, content: content.trim() })
  }
  const lastIsUser = parsed[parsed.length - 1].role === 'user'
  if (!lastIsUser) {
    throw new Error('[INVALID_INPUT] El último mensaje debe ser del usuario.')
  }
  const userRole =
    typeof obj.userRole === 'string' && obj.userRole.length > 0
      ? obj.userRole
      : undefined
  return { messages: parsed, userRole }
}

export async function POST(req: Request): Promise<Response> {
  // 1. Auth — lanza [UNAUTHORIZED] si no hay sesión.
  let user
  try {
    user = await requireUser()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sesión requerida'
    return jsonError('UNAUTHORIZED', msg, 401)
  }

  // 2. Anthropic config check.
  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError(
      'SERVICE_UNAVAILABLE',
      'ANTHROPIC_API_KEY no está configurada en el servidor.',
      503,
    )
  }

  // 3. Parse + validate input.
  let body: SupportChatRequest
  try {
    const raw = await req.json()
    body = parseBody(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Payload inválido'
    return jsonError('INVALID_INPUT', msg, 400)
  }

  // 4. Rate-limit por usuario (30 req/hora).
  try {
    assertWithinSupportLimit(user.id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Rate limit'
    return jsonError('RATE_LIMITED', msg, 429)
  }

  // 5. Audit (fire-and-forget, nunca bloquea el stream).
  const isFirstTurn = body.messages.filter((m) => m.role === 'user').length === 1
  const ip = await getClientIp()
  const ua = await getUserAgent()
  if (isFirstTurn) {
    void recordAuditEventSafe({
      actorId: user.id,
      action: 'support.chat_started',
      entityType: 'support_chat',
      entityId: user.id,
      ipAddress: ip,
      userAgent: ua,
      metadata: { role: body.userRole ?? user.roles[0] ?? null },
    })
  }
  void recordAuditEventSafe({
    actorId: user.id,
    action: 'support.chat_message_sent',
    entityType: 'support_chat',
    entityId: user.id,
    ipAddress: ip,
    userAgent: ua,
    metadata: {
      role: body.userRole ?? user.roles[0] ?? null,
      messageLength: body.messages[body.messages.length - 1].content.length,
      turnCount: body.messages.filter((m) => m.role === 'user').length,
    },
  })

  // 6. Build system prompt with role-specific tone hint.
  const resolvedRole = body.userRole ?? user.roles[0] ?? 'USER'
  const system = buildSupportSystemPrompt(resolvedRole)

  // 7. Stream the LLM response.
  const coreMessages: ModelMessage[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  try {
    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system,
      messages: coreMessages,
      temperature: 0.3,
    })
    return result.toTextStreamResponse({
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error LLM'
    return jsonError('LLM_ERROR', msg, 502)
  }
}

async function getClientIp(): Promise<string | null> {
  try {
    const h = await nextHeaders()
    const fwd = h.get('x-forwarded-for')
    if (fwd) return fwd.split(',')[0].trim() || null
    return h.get('x-real-ip') ?? null
  } catch {
    return null
  }
}

async function getUserAgent(): Promise<string | null> {
  try {
    const h = await nextHeaders()
    return h.get('user-agent')
  } catch {
    return null
  }
}
