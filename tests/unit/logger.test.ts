import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Wave C2 · Tests del logger estructurado.
 *
 * Mockeamos `@sentry/nextjs` con stubs determinísticos. Cada test
 * controla `process.env.SENTRY_DSN` y `process.env.NODE_ENV` para
 * verificar las dos rutas (no-op en dev/sin DSN, captura en prod).
 */

// ─────────────────────────── Mocks ───────────────────────────

const captureException = vi.fn()
const captureMessage = vi.fn()
const addBreadcrumb = vi.fn()
const withScope = vi.fn()

vi.mock('@sentry/nextjs', () => {
  return {
    captureException: (...args: unknown[]) => captureException(...args),
    captureMessage: (...args: unknown[]) => captureMessage(...args),
    addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
    withScope: (cb: (scope: unknown) => void) => {
      const scope = {
        setLevel: vi.fn(),
        setContext: vi.fn(),
        setTag: vi.fn(),
      }
      withScope(cb)
      cb(scope)
    },
  }
})

// ─────────────────────────── Helpers ─────────────────────────

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
  captureException.mockReset()
  captureMessage.mockReset()
  addBreadcrumb.mockReset()
  withScope.mockReset()
  // Stub silenciador de console para mantener output de tests limpio.
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

const setSentryActive = (): void => {
  process.env.NODE_ENV = 'production'
  process.env.SENTRY_DSN = 'https://example@o0.ingest.sentry.io/0'
}

const setSentryInactive = (): void => {
  process.env.NODE_ENV = 'development'
  delete process.env.SENTRY_DSN
  delete process.env.NEXT_PUBLIC_SENTRY_DSN
}

// ─────────────────────────── Tests ───────────────────────────

describe('logger · sanitizeContext', () => {
  it('redacta claves con nombre tipo "password"', async () => {
    const { sanitizeContext } = await import('@/lib/observability/logger')
    const out = sanitizeContext({ password: 'hunter2', userId: 'u1' })
    expect(out.password).toBe('[REDACTED]')
    expect(out.userId).toBe('u1')
  })

  it('redacta token, secret, apiKey, authorization, cookie (case-insensitive)', async () => {
    const { sanitizeContext } = await import('@/lib/observability/logger')
    const out = sanitizeContext({
      Token: 't',
      mySecret: 's',
      apiKey: 'k',
      Authorization: 'Bearer x',
      cookie: 'c=1',
      keep: 'ok',
    })
    expect(out.Token).toBe('[REDACTED]')
    expect(out.mySecret).toBe('[REDACTED]')
    expect(out.apiKey).toBe('[REDACTED]')
    expect(out.Authorization).toBe('[REDACTED]')
    expect(out.cookie).toBe('[REDACTED]')
    expect(out.keep).toBe('ok')
  })

  it('devuelve {} si recibe undefined', async () => {
    const { sanitizeContext } = await import('@/lib/observability/logger')
    expect(sanitizeContext(undefined)).toEqual({})
  })
})

describe('logger.info', () => {
  it('en dev/no-DSN imprime con console.info y no llama a Sentry', async () => {
    setSentryInactive()
    const { logger } = await import('@/lib/observability/logger')
    logger.info('hello', { userId: 'u1' })
    expect(addBreadcrumb).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenCalledWith('[info] hello', { userId: 'u1' })
  })

  it('en prod con DSN emite breadcrumb (no console.info)', async () => {
    setSentryActive()
    const { logger } = await import('@/lib/observability/logger')
    logger.info('hello', { userId: 'u1' })
    expect(addBreadcrumb).toHaveBeenCalledTimes(1)
    expect(addBreadcrumb.mock.calls[0]?.[0]).toMatchObject({
      category: 'log',
      level: 'info',
      message: 'hello',
      data: { userId: 'u1' },
    })
    expect(console.info).not.toHaveBeenCalled()
  })

  it('sanitiza secrets antes de enviarlos a Sentry', async () => {
    setSentryActive()
    const { logger } = await import('@/lib/observability/logger')
    logger.info('login', { userId: 'u1', password: 'hunter2' })
    const arg = addBreadcrumb.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    expect(arg.data.password).toBe('[REDACTED]')
    expect(arg.data.userId).toBe('u1')
  })
})

describe('logger.warn', () => {
  it('en dev imprime con console.warn', async () => {
    setSentryInactive()
    const { logger } = await import('@/lib/observability/logger')
    logger.warn('cache miss', { key: 'kpi' })
    expect(captureMessage).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalled()
  })

  it('en prod usa captureMessage con level "warning"', async () => {
    setSentryActive()
    const { logger } = await import('@/lib/observability/logger')
    logger.warn('cache miss', { key: 'kpi' })
    expect(captureMessage).toHaveBeenCalledWith('cache miss', 'warning')
    expect(withScope).toHaveBeenCalledTimes(1)
  })
})

describe('logger.error', () => {
  it('en dev imprime con console.error y no toca Sentry', async () => {
    setSentryInactive()
    const { logger } = await import('@/lib/observability/logger')
    logger.error(new Error('boom'), { action: 'tasks.create' })
    expect(captureException).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it('en prod llama a captureException con la Error original', async () => {
    setSentryActive()
    const { logger } = await import('@/lib/observability/logger')
    const err = new Error('boom')
    logger.error(err, { action: 'tasks.create' })
    expect(captureException).toHaveBeenCalledWith(err)
  })

  it('envuelve strings en Error antes de capturarlos', async () => {
    setSentryActive()
    const { logger } = await import('@/lib/observability/logger')
    logger.error('plain string error')
    expect(captureException).toHaveBeenCalledTimes(1)
    const passed = captureException.mock.calls[0]?.[0]
    expect(passed).toBeInstanceOf(Error)
    expect((passed as Error).message).toBe('plain string error')
  })

  it('en prod también imprime en consola para visibilidad local', async () => {
    setSentryActive()
    const { logger } = await import('@/lib/observability/logger')
    logger.error(new Error('boom'))
    expect(console.error).toHaveBeenCalled()
  })
})

describe('logger · activación condicional', () => {
  it('NEXT_PUBLIC_SENTRY_DSN también activa Sentry (cliente)', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.SENTRY_DSN
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://x@o.sentry.io/1'
    const { logger } = await import('@/lib/observability/logger')
    logger.info('client-side')
    expect(addBreadcrumb).toHaveBeenCalled()
  })

  it('DSN presente pero NODE_ENV=development → no envía a Sentry', async () => {
    process.env.NODE_ENV = 'development'
    process.env.SENTRY_DSN = 'https://x@o.sentry.io/1'
    const { logger } = await import('@/lib/observability/logger')
    logger.info('dev-with-dsn')
    expect(addBreadcrumb).not.toHaveBeenCalled()
  })
})
