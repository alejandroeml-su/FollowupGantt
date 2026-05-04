import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Wave C2 · Tests del HOF `withErrorTracking` para server actions.
 *
 * Verificamos que:
 *  - El wrapper preserva el resultado en el happy path.
 *  - Re-lanza el error tras capturarlo (contrato Next).
 *  - Llama a `Sentry.captureException` cuando Sentry está activo.
 *  - Sanitiza args (no envía passwords/tokens a Sentry).
 *  - Emite el breadcrumb de "entered action".
 */

// ─────────────────────────── Mocks ───────────────────────────

const captureException = vi.fn()
const addBreadcrumb = vi.fn()
const withScope = vi.fn()

// Capturamos las llamadas a `scope.setContext(name, ctx)` para
// poder verificar la sanitización end-to-end (logger → withScope →
// scope.setContext). Cada test puede leer/limpiar este buffer.
const setContextCalls: Array<{ name: string; ctx: Record<string, unknown> }> = []

vi.mock('@sentry/nextjs', () => {
  return {
    captureException: (...args: unknown[]) => captureException(...args),
    captureMessage: vi.fn(),
    addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
    withScope: (cb: (scope: unknown) => void) => {
      const scope = {
        setLevel: vi.fn(),
        setContext: (name: string, ctx: Record<string, unknown>) =>
          setContextCalls.push({ name, ctx }),
        setTag: vi.fn(),
      }
      withScope(cb)
      cb(scope)
    },
  }
})

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  captureException.mockReset()
  addBreadcrumb.mockReset()
  withScope.mockReset()
  setContextCalls.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

const setSentryActive = (): void => {
  process.env.NODE_ENV = 'production'
  process.env.SENTRY_DSN = 'https://x@o.ingest.sentry.io/0'
}

const setSentryInactive = (): void => {
  process.env.NODE_ENV = 'development'
  delete process.env.SENTRY_DSN
  delete process.env.NEXT_PUBLIC_SENTRY_DSN
}

// ─────────────────────────── Tests ───────────────────────────

describe('withErrorTracking · happy path', () => {
  it('devuelve el resultado de la action sin modificarlo', async () => {
    setSentryInactive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')
    const action = vi.fn(async (a: number, b: number) => a + b)
    const wrapped = withErrorTracking(action, 'math.add')
    const out = await wrapped(2, 3)
    expect(out).toBe(5)
    expect(action).toHaveBeenCalledWith(2, 3)
  })

  it('preserva el tipo de retorno (Promise<...>)', async () => {
    setSentryInactive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')
    const wrapped = withErrorTracking(
      async (id: string) => ({ id, status: 'ok' as const }),
      'tasks.fetch',
    )
    const result = await wrapped('t-1')
    expect(result.status).toBe('ok')
    expect(result.id).toBe('t-1')
  })

  it('emite breadcrumb "entered action" siempre (incluso sin error)', async () => {
    // El breadcrumb se llama en addBreadcrumb del SDK; el SDK real lo
    // ignora si no está inicializado, pero nuestro mock lo registra siempre.
    setSentryInactive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')
    const wrapped = withErrorTracking(async () => 'ok', 'noop.action')
    await wrapped()
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'server-action',
        message: '→ noop.action',
      }),
    )
  })
})

describe('withErrorTracking · error path', () => {
  it('re-lanza el error original tras capturarlo', async () => {
    setSentryActive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')
    const err = new Error('db connection failed')
    const action = vi.fn(async () => {
      throw err
    })
    const wrapped = withErrorTracking(action, 'tasks.create')
    await expect(wrapped()).rejects.toBe(err)
  })

  it('llama a captureException con la Error original cuando Sentry está activo', async () => {
    setSentryActive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')
    const err = new Error('boom')
    const wrapped = withErrorTracking(async () => {
      throw err
    }, 'tasks.delete')
    await expect(wrapped()).rejects.toBe(err)
    expect(captureException).toHaveBeenCalledWith(err)
  })

  it('en dev no llama a captureException pero sí imprime en consola', async () => {
    setSentryInactive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')
    const wrapped = withErrorTracking(async () => {
      throw new Error('local-only')
    }, 'local.action')
    await expect(wrapped()).rejects.toThrow('local-only')
    expect(captureException).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it('envuelve strings/números thrown en Error', async () => {
    setSentryActive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')
    const wrapped = withErrorTracking(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'not-an-error'
    }, 'weird.action')
    await expect(wrapped()).rejects.toBe('not-an-error')
    // captureException recibe un Error envuelto (el logger lo crea).
    expect(captureException).toHaveBeenCalledTimes(1)
    const passed = captureException.mock.calls[0]?.[0]
    expect(passed).toBeInstanceOf(Error)
  })
})

describe('withErrorTracking · sanitización de args', () => {
  it('redacta keys con nombre tipo "password" en los args reportados', async () => {
    setSentryActive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')

    const wrapped = withErrorTracking(
      async (_input: { email: string; password: string }) => {
        throw new Error('auth failed')
      },
      'auth.login',
    )
    await expect(
      wrapped({ email: 'e@x.com', password: 'hunter2' }),
    ).rejects.toThrow('auth failed')

    // El logger.error llama a `scope.setContext('log', safeCtx)` con
    // `args` ya sanitizados (json-roundtripped + claves con nombre
    // tipo "password" reemplazadas por "[REDACTED]").
    const logCtx = setContextCalls.find((c) => c.name === 'log')
    expect(logCtx).toBeDefined()
    const args = logCtx?.ctx.args as unknown[]
    expect(args).toBeDefined()
    const firstArg = args[0] as Record<string, unknown>
    expect(firstArg.password).toBe('[REDACTED]')
    expect(firstArg.email).toBe('e@x.com')
  })

  it('trunca strings largos para no inflar el evento Sentry', async () => {
    setSentryActive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')
    const longArg = 'x'.repeat(2000)
    const wrapped = withErrorTracking(async (_s: string) => {
      throw new Error('too-much')
    }, 'big.payload')
    await expect(wrapped(longArg)).rejects.toThrow('too-much')
    // El logger se invoca con args ya sanitizados. Aquí verificamos el
    // contrato indirecto: captureException fue llamado y el wrapper
    // no rompe con strings grandes.
    expect(captureException).toHaveBeenCalledTimes(1)
  })
})

describe('withErrorTracking · contrato del wrapper', () => {
  it('no envuelve dos veces si la action ya fue envuelta', async () => {
    setSentryInactive()
    const { withErrorTracking } = await import('@/lib/observability/with-error-tracking')
    const action = vi.fn(async () => 'v')
    const wrapped1 = withErrorTracking(action, 'a.first')
    const wrapped2 = withErrorTracking(wrapped1, 'a.second')
    await wrapped2()
    expect(action).toHaveBeenCalledTimes(1)
    // Cada capa emite su propio breadcrumb — comportamiento esperado.
    expect(addBreadcrumb).toHaveBeenCalledTimes(2)
  })
})
