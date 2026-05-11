import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Support Chatbot · suite de tests del Route Handler `/api/support/chat`
 * y del helper de rate-limit. Mockeamos:
 *   - `@/lib/auth/get-current-user` → controla quién está autenticado.
 *   - `@/lib/audit/events` → recordAuditEventSafe es noop.
 *   - `@ai-sdk/anthropic` y `ai` → no hacemos llamadas reales al LLM.
 *   - `next/headers` → headers IP/UA sintéticos.
 *
 * No tocamos Prisma porque el endpoint no usa BD directamente.
 */

const mockRequireUser = vi.fn()
const mockRecordAuditSafe = vi.fn().mockResolvedValue(undefined)
const mockStreamText = vi.fn()
const mockAnthropic = vi.fn((id: string) => ({ id }))
const mockHeaders = vi.fn().mockResolvedValue(
  new Headers({ 'x-forwarded-for': '10.0.0.1', 'user-agent': 'vitest' }),
)

vi.mock('@/lib/auth/get-current-user', () => ({
  requireUser: () => mockRequireUser(),
  getCurrentUser: () => mockRequireUser(),
}))

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...args: unknown[]) => mockRecordAuditSafe(...args),
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditSafe(...args),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: (id: string) => mockAnthropic(id),
}))

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
}))

vi.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}))

// Helper to build a minimal text stream Response that the handler returns
function fakeStreamResponse(text: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function buildRequest(body: unknown): Request {
  return new Request('http://localhost/api/support/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  mockRequireUser.mockReset()
  mockRecordAuditSafe.mockReset().mockResolvedValue(undefined)
  mockStreamText.mockReset().mockImplementation(() => ({
    toTextStreamResponse: (init?: { headers?: Record<string, string> }) =>
      new Response('hello world', {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          ...(init?.headers ?? {}),
        },
      }),
  }))
  process.env.ANTHROPIC_API_KEY = 'test-key-anthropic-1234567890'

  // Cada test inicia con un rate-limit limpio.
  const mod = await import('@/lib/support/rate-limit')
  mod.__resetSupportRateLimitForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rate-limit helper', () => {
  it('rechaza la 31ª request del mismo usuario dentro de la ventana', async () => {
    const { assertWithinSupportLimit, __resetSupportRateLimitForTests, SUPPORT_RATE_LIMIT } =
      await import('@/lib/support/rate-limit')
    __resetSupportRateLimitForTests()
    expect(SUPPORT_RATE_LIMIT.maxRequests).toBe(30)

    for (let i = 0; i < 30; i += 1) {
      expect(() => assertWithinSupportLimit('user-1')).not.toThrow()
    }
    expect(() => assertWithinSupportLimit('user-1')).toThrow(/\[RATE_LIMITED\]/)
  })

  it('cuenta usuarios distintos por separado', async () => {
    const { assertWithinSupportLimit, __resetSupportRateLimitForTests } = await import(
      '@/lib/support/rate-limit'
    )
    __resetSupportRateLimitForTests()
    for (let i = 0; i < 30; i += 1) {
      assertWithinSupportLimit('user-A')
    }
    expect(() => assertWithinSupportLimit('user-B')).not.toThrow()
    expect(() => assertWithinSupportLimit('user-A')).toThrow(/\[RATE_LIMITED\]/)
  })

  it('rechaza userId vacío con [INVALID_INPUT]', async () => {
    const { assertWithinSupportLimit } = await import('@/lib/support/rate-limit')
    expect(() => assertWithinSupportLimit('')).toThrow(/\[INVALID_INPUT\]/)
  })
})

describe('buildSupportSystemPrompt', () => {
  it('inyecta el tone hint específico del rol GERENCIA_GENERAL', async () => {
    const { buildSupportSystemPrompt } = await import('@/lib/support/manuals-summary')
    const prompt = buildSupportSystemPrompt('GERENCIA_GENERAL')
    expect(prompt).toContain('GERENCIA_GENERAL')
    expect(prompt).toContain('estratégic')
    // Verifica que la knowledge base general también esté incluida.
    expect(prompt).toContain('Workspace = espacio multi-tenant')
  })

  it('cae a USER por defecto cuando rol es null', async () => {
    const { buildSupportSystemPrompt, getRoleToneHint, ROLE_TONE_HINTS } = await import(
      '@/lib/support/manuals-summary'
    )
    const prompt = buildSupportSystemPrompt(null)
    expect(prompt).toContain(ROLE_TONE_HINTS.USER)
    expect(getRoleToneHint(null)).toBe(ROLE_TONE_HINTS.USER)
    expect(getRoleToneHint('UNKNOWN_ROLE')).toBe(ROLE_TONE_HINTS.USER)
  })

  it('mapea AGENTE legacy al mismo hint operativo', async () => {
    const { getRoleToneHint } = await import('@/lib/support/manuals-summary')
    expect(getRoleToneHint('AGENTE')).toContain('AGENTE')
  })
})

describe('POST /api/support/chat', () => {
  it('devuelve 401 si no hay sesión', async () => {
    mockRequireUser.mockRejectedValue(new Error('[UNAUTHORIZED] Sesión requerida'))
    const { POST } = await import('@/app/api/support/chat/route')

    const res = await POST(
      buildRequest({ messages: [{ role: 'user', content: 'hola' }] }),
    )
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it('devuelve 503 si falta ANTHROPIC_API_KEY', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'u1',
      email: 'u@test.com',
      name: 'U',
      roles: ['USER'],
    })
    delete process.env.ANTHROPIC_API_KEY
    const { POST } = await import('@/app/api/support/chat/route')

    const res = await POST(
      buildRequest({ messages: [{ role: 'user', content: 'hola' }] }),
    )
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('devuelve 400 si el mensaje del usuario está vacío', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'u1',
      email: 'u@test.com',
      name: 'U',
      roles: ['USER'],
    })
    const { POST } = await import('@/app/api/support/chat/route')

    const res = await POST(
      buildRequest({ messages: [{ role: 'user', content: '   ' }] }),
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('INVALID_INPUT')
    expect(body.error.message).toMatch(/vac/i)
  })

  it('devuelve 400 si messages no es un array no vacío', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'u1',
      email: 'u@test.com',
      name: 'U',
      roles: ['USER'],
    })
    const { POST } = await import('@/app/api/support/chat/route')

    const res = await POST(buildRequest({ messages: [] }))
    expect(res.status).toBe(400)
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it('devuelve 400 si el último mensaje no es del usuario', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'u1',
      email: 'u@test.com',
      name: 'U',
      roles: ['USER'],
    })
    const { POST } = await import('@/app/api/support/chat/route')

    const res = await POST(
      buildRequest({
        messages: [
          { role: 'user', content: 'hola' },
          { role: 'assistant', content: 'mundo' },
        ],
      }),
    )
    expect(res.status).toBe(400)
    expect(mockStreamText).not.toHaveBeenCalled()
  })

  it('llama streamText con el modelo Haiku y un system prompt que respeta el rol del user', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'u-mgr',
      email: 'mgr@test.com',
      name: 'Manager',
      roles: ['GERENTE_AREA'],
    })

    const { POST } = await import('@/app/api/support/chat/route')
    const res = await POST(
      buildRequest({ messages: [{ role: 'user', content: '¿Cómo creo un proyecto?' }] }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    expect(mockStreamText).toHaveBeenCalledTimes(1)
    expect(mockAnthropic).toHaveBeenCalledWith('claude-haiku-4-5-20251001')
    const call = mockStreamText.mock.calls[0][0] as {
      system: string
      messages: Array<{ role: string; content: string }>
    }
    expect(call.system).toContain('GERENTE_AREA')
    expect(call.system).toContain('Sync Support')
    expect(call.messages).toHaveLength(1)
    expect(call.messages[0].content).toBe('¿Cómo creo un proyecto?')
  })

  it('emite eventos de audit support.chat_started + support.chat_message_sent en el primer turno', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'u-2',
      email: 'u2@test.com',
      name: 'U2',
      roles: ['USER'],
    })
    const { POST } = await import('@/app/api/support/chat/route')
    await POST(
      buildRequest({ messages: [{ role: 'user', content: 'pregunta inicial' }] }),
    )

    const actions = mockRecordAuditSafe.mock.calls.map(
      (c) => (c[0] as { action: string }).action,
    )
    expect(actions).toContain('support.chat_started')
    expect(actions).toContain('support.chat_message_sent')
  })

  it('en turnos subsecuentes solo emite support.chat_message_sent', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'u-3',
      email: 'u3@test.com',
      name: 'U3',
      roles: ['USER'],
    })
    const { POST } = await import('@/app/api/support/chat/route')
    await POST(
      buildRequest({
        messages: [
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: 'r1' },
          { role: 'user', content: 'q2' },
        ],
      }),
    )
    const actions = mockRecordAuditSafe.mock.calls.map(
      (c) => (c[0] as { action: string }).action,
    )
    expect(actions).not.toContain('support.chat_started')
    expect(actions).toContain('support.chat_message_sent')
  })

  it('devuelve 429 cuando el usuario excede el rate limit', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'spammer',
      email: 's@test.com',
      name: 'S',
      roles: ['USER'],
    })
    const { POST } = await import('@/app/api/support/chat/route')
    const req = () =>
      buildRequest({ messages: [{ role: 'user', content: 'hola' }] })

    for (let i = 0; i < 30; i += 1) {
      const res = await POST(req())
      expect(res.status).toBe(200)
    }
    const blocked = await POST(req())
    expect(blocked.status).toBe(429)
    const body = await blocked.json()
    expect(body.error.code).toBe('RATE_LIMITED')
  })

  it('respeta userRole explícito del payload sobre el rol del session user', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'u-4',
      email: 'u4@test.com',
      name: 'U4',
      roles: ['USER'],
    })
    const { POST } = await import('@/app/api/support/chat/route')
    await POST(
      buildRequest({
        messages: [{ role: 'user', content: 'p' }],
        userRole: 'SUPER_ADMIN',
      }),
    )
    const call = mockStreamText.mock.calls[0][0] as { system: string }
    expect(call.system).toContain('SUPER_ADMIN')
  })

  it('marca el verbo support.chat_started con metadata.role del payload', async () => {
    mockRequireUser.mockResolvedValue({
      id: 'u-5',
      email: 'u5@test.com',
      name: 'U5',
      roles: ['GERENCIA_GENERAL'],
    })
    const { POST } = await import('@/app/api/support/chat/route')
    await POST(
      buildRequest({ messages: [{ role: 'user', content: 'q' }] }),
    )
    const startedCall = mockRecordAuditSafe.mock.calls.find(
      (c) => (c[0] as { action: string }).action === 'support.chat_started',
    )
    expect(startedCall).toBeDefined()
    const payload = startedCall![0] as {
      metadata: { role: string }
      actorId: string
    }
    expect(payload.metadata.role).toBe('GERENCIA_GENERAL')
    expect(payload.actorId).toBe('u-5')
  })
})

// Note: fakeStreamResponse is exported via usage in setup but kept for
// future tests that need to verify body parsing. Mark as used to silence
// any "unused" linter complaint.
void fakeStreamResponse
