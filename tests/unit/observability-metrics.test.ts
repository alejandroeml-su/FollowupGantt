import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

/**
 * Wave P17-D · Tests del helper de métricas RED.
 *
 * Covertura:
 *   - recordRed acumula count/errors y honra ring buffer
 *   - snapshotMetrics calcula percentiles correctos sobre datos canned
 *   - resetMetrics borra todas las métricas
 *   - withMetrics envuelve correctamente y propaga errores
 *   - emitSloBreadcrumbs sólo emite cuando count >= minSampleCount y
 *     se exceden errorRate/p95
 *
 * Mockeamos `@sentry/nextjs` para verificar las llamadas a addBreadcrumb
 * sin acoplarnos al SDK real.
 */

const addBreadcrumb = vi.fn()

vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumb(...args),
}))

// `server-only` lanza en runtime de cliente — lo neutralizamos para test.
vi.mock('server-only', () => ({}))

import {
  recordRed,
  snapshotMetrics,
  resetMetrics,
  withMetrics,
  emitSloBreadcrumbs,
  __internals,
} from '@/lib/observability/metrics'

beforeEach(() => {
  resetMetrics()
  addBreadcrumb.mockReset()
})

afterEach(() => {
  resetMetrics()
})

describe('recordRed', () => {
  it('inicializa una métrica nueva con la primera observación', () => {
    recordRed('action.test', 100, false)
    const snap = snapshotMetrics()
    expect(snap['action.test']).toBeDefined()
    expect(snap['action.test'].count).toBe(1)
    expect(snap['action.test'].errors).toBe(0)
    expect(snap['action.test'].errorRate).toBe(0)
  })

  it('acumula errors cuando isError=true', () => {
    recordRed('action.test', 100, false)
    recordRed('action.test', 200, true)
    recordRed('action.test', 300, true)
    const snap = snapshotMetrics()
    expect(snap['action.test'].count).toBe(3)
    expect(snap['action.test'].errors).toBe(2)
    // 2/3 = 66.666... → redondeado a 66.67
    expect(snap['action.test'].errorRate).toBeCloseTo(66.67, 1)
  })

  it('respeta el ring buffer (descarta la muestra más antigua)', () => {
    const cap = __internals.MAX_DURATION_SAMPLES
    // Insertamos cap+10 muestras: las primeras 10 deben caer.
    for (let i = 0; i < cap + 10; i++) {
      recordRed('action.ring', i, false)
    }
    const internal = __internals.metrics.get('action.ring')
    expect(internal).toBeDefined()
    expect(internal!.durationsMs.length).toBe(cap)
    // La primera muestra retenida es índice 10 (las 0..9 fueron drop).
    expect(internal!.durationsMs[0]).toBe(10)
    // El count agregado SÍ refleja todas las observaciones, no solo las
    // que caben en el buffer — count es contador, no array.
    const snap = snapshotMetrics()
    expect(snap['action.ring'].count).toBe(cap + 10)
  })

  it('clampea durationMs negativo o no-finito a 0', () => {
    recordRed('action.weird', -50, false)
    recordRed('action.weird', Number.NaN, false)
    recordRed('action.weird', 100, false)
    const snap = snapshotMetrics()
    expect(snap['action.weird'].count).toBe(3)
    // p99 en 3 muestras = la última en orden → 100.
    expect(snap['action.weird'].p99).toBe(100)
    // p50 con [0, 0, 100] → la posición 2 (ceil(0.5*3)=2) → idx 1 → 0.
    expect(snap['action.weird'].p50).toBe(0)
  })

  it('no registra cuando name es vacío (defensa)', () => {
    recordRed('', 100, false)
    const snap = snapshotMetrics()
    expect(Object.keys(snap)).toHaveLength(0)
  })
})

describe('snapshotMetrics percentiles', () => {
  it('calcula p50/p95/p99 correctos sobre datos canned [10..100]', () => {
    // 10 muestras espaciadas a 10, 20, …, 100.
    for (let i = 1; i <= 10; i++) {
      recordRed('action.percentiles', i * 10, false)
    }
    const snap = snapshotMetrics()['action.percentiles']
    // nearest-rank:
    //   p50 → ceil(0.50*10)=5 → idx 4 → 50
    //   p95 → ceil(0.95*10)=10 → idx 9 → 100
    //   p99 → ceil(0.99*10)=10 → idx 9 → 100
    expect(snap.p50).toBe(50)
    expect(snap.p95).toBe(100)
    expect(snap.p99).toBe(100)
  })

  it('devuelve 0 para percentiles cuando no hay muestras', () => {
    // Caso degenerado: forzamos una métrica con count > 0 pero array
    // vacío — no debería pasar en la práctica pero el helper lo tolera.
    const snap = snapshotMetrics()
    expect(snap).toEqual({})
  })

  it('preserva el orden de inserción de las claves', () => {
    recordRed('action.zeta', 10, false)
    recordRed('action.alpha', 20, false)
    recordRed('action.middle', 30, false)
    const keys = Object.keys(snapshotMetrics())
    expect(keys).toEqual(['action.zeta', 'action.alpha', 'action.middle'])
  })
})

describe('resetMetrics', () => {
  it('borra todas las métricas y lastSampleAt', () => {
    recordRed('action.a', 100, false)
    recordRed('action.b', 200, true)
    expect(Object.keys(snapshotMetrics())).toHaveLength(2)
    resetMetrics()
    expect(snapshotMetrics()).toEqual({})
  })
})

describe('withMetrics wrapper', () => {
  it('registra duración + isError=false en éxito', async () => {
    const result = await withMetrics('action.ok', async () => {
      return 'hello'
    })
    expect(result).toBe('hello')
    const snap = snapshotMetrics()['action.ok']
    expect(snap.count).toBe(1)
    expect(snap.errors).toBe(0)
  })

  it('registra isError=true y re-lanza la excepción', async () => {
    await expect(
      withMetrics('action.fail', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const snap = snapshotMetrics()['action.fail']
    expect(snap.count).toBe(1)
    expect(snap.errors).toBe(1)
    expect(snap.errorRate).toBe(100)
  })
})

describe('emitSloBreadcrumbs', () => {
  it('NO emite si count < minSampleCount aunque errorRate sea alto', () => {
    // 1 sample con error → 100% errorRate pero count=1 < default 10.
    recordRed('action.tiny', 100, true)
    const result = emitSloBreadcrumbs(snapshotMetrics())
    expect(result.violations).toBe(0)
    expect(addBreadcrumb).not.toHaveBeenCalled()
  })

  it('emite breadcrumb cuando errorRate excede el budget', () => {
    // 12 muestras, 8 errores → 66% errorRate. count >= 10 → evalúa.
    for (let i = 0; i < 4; i++) recordRed('action.flaky', 50, false)
    for (let i = 0; i < 8; i++) recordRed('action.flaky', 60, true)
    const result = emitSloBreadcrumbs(snapshotMetrics())
    expect(result.violations).toBe(1)
    expect(addBreadcrumb).toHaveBeenCalledOnce()
    const call = addBreadcrumb.mock.calls[0]?.[0] as {
      category: string
      level: string
      data: { name: string; violatedErrorRate: boolean }
    }
    expect(call.category).toBe('slo.violation')
    expect(call.level).toBe('warning')
    expect(call.data.name).toBe('action.flaky')
    expect(call.data.violatedErrorRate).toBe(true)
  })

  it('emite breadcrumb cuando p95 excede el budget de latencia', () => {
    // 15 muestras lentas (todas 2000ms). errorRate=0, p95=2000 > 1000.
    for (let i = 0; i < 15; i++) recordRed('action.slow', 2000, false)
    const result = emitSloBreadcrumbs(snapshotMetrics())
    expect(result.violations).toBe(1)
    const call = addBreadcrumb.mock.calls[0]?.[0] as {
      data: { violatedLatency: boolean; violatedErrorRate: boolean }
    }
    expect(call.data.violatedLatency).toBe(true)
    expect(call.data.violatedErrorRate).toBe(false)
  })

  it('respeta opciones custom de threshold y minSampleCount', () => {
    // 5 muestras lentas → con minSampleCount=3 y p95Ms=100, viola.
    for (let i = 0; i < 5; i++) recordRed('action.custom', 200, false)
    const result = emitSloBreadcrumbs(snapshotMetrics(), {
      p95Ms: 100,
      minSampleCount: 3,
      errorRatePct: 50,
    })
    expect(result.violations).toBe(1)
  })
})
