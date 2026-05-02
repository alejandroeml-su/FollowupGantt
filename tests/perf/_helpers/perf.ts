/**
 * HU-4.6 · Helper de medición de performance.
 *
 * Centraliza el patrón measure/assert/log que usan los tests perf de Sprint 8.
 * No lo importes desde tests unitarios normales — está pensado para
 * `tests/perf/**` que sólo corren bajo demanda (`RUN_PERF=1`).
 *
 * Uso:
 *   import { measure, assertSLO, logPerfTable } from './_helpers/perf'
 *
 *   const { result, perf } = await measure('build workbook', () => buildExcel(tasks))
 *   assertSLO(perf, 2000)
 *   logPerfTable([perf])
 *
 * SLOs aprobados (D17, Sprint 8):
 *   - Excel build  5000 tareas  < 2000 ms
 *   - Excel parse  ~5 MB        < 2000 ms
 *   - Excel round-trip          < 4000 ms
 *   - MSP   build  5000 tareas  < 2000 ms (HU-4.3 pendiente)
 *   - MSP   parse  ~5 MB        < 2000 ms (HU-4.1 pendiente)
 */
import { performance } from 'node:perf_hooks'

export interface PerfResult {
  label: string
  durationMs: number
  bytes?: number
  taskCount?: number
}

/**
 * Mide la duración de una operación (sync o async). Devuelve el resultado de la
 * función junto con el `PerfResult` para encadenar `assertSLO`/`logPerfTable`.
 */
export async function measure<T>(
  label: string,
  fn: () => Promise<T> | T,
): Promise<{ result: T; perf: PerfResult }> {
  const t0 = performance.now()
  const result = await fn()
  const t1 = performance.now()
  return {
    result,
    perf: {
      label,
      durationMs: +(t1 - t0).toFixed(2),
    },
  }
}

/**
 * Falla el test si la duración excede el SLO. Usa `expect` de vitest si está
 * disponible (el caso normal en tests); fallback a throw para uso fuera de
 * vitest (ej. scripts ad-hoc).
 */
export function assertSLO(perf: PerfResult, maxMs: number): void {
  // Mensaje rico para diagnóstico en CI cuando el SLO falla.
  const msg = `[SLO] "${perf.label}": ${perf.durationMs}ms excede el límite de ${maxMs}ms`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expectFn = (globalThis as any).expect as
    | ((actual: unknown) => { toBeLessThanOrEqual: (n: number) => void })
    | undefined
  if (typeof expectFn === 'function') {
    const assertion = expectFn(perf.durationMs)
    // toBeLessThanOrEqual(maxMs)
    assertion.toBeLessThanOrEqual(maxMs)
    return
  }
  if (perf.durationMs > maxMs) {
    throw new Error(msg)
  }
}

/**
 * Imprime una tabla simple por consola con los resultados. Útil para reportar
 * en el log de CI cuando RUN_PERF=1 está activo.
 */
export function logPerfTable(results: PerfResult[]): void {
  if (results.length === 0) return
  const rows = results.map((r) => ({
    label: r.label,
    'durationMs': r.durationMs,
    bytes: r.bytes ?? '',
    taskCount: r.taskCount ?? '',
  }))
  // eslint-disable-next-line no-console
  console.table(rows)
}

/**
 * Helper de tamaño humano-legible para logs.
 */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
