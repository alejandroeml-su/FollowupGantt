'use client'

/**
 * Wave P17-D · Dashboard SLO Client.
 *
 * Polea el endpoint `/api/internal/metrics` cada 30s, ordena por p95
 * descendente y aplica colorimetría a las violaciones de SLO.
 *
 * Decisiones:
 *  - `useEffect` + `setInterval` (no SWR/React Query) — la dep es ya
 *    bastante grande en el repo y para 1 endpoint trivial no compensa.
 *  - Cleanup en cleanup-fn: cancela el interval y aborta el fetch en
 *    vuelo si el componente se desmonta.
 *  - Sin `any`: tipamos la respuesta del endpoint con interfaces.
 */
import { useCallback, useEffect, useState } from 'react'

interface RedMetricSnapshot {
  count: number
  errors: number
  errorRate: number
  p50: number
  p95: number
  p99: number
  lastSampleAt: number | null
}

interface MetricsResponse {
  ok: true
  via: 'super-admin' | 'internal-token'
  capturedAt: string
  metricsCount: number
  metrics: Record<string, RedMetricSnapshot>
  sloViolations: number | null
}

const REFRESH_INTERVAL_MS = 30_000
const ERROR_RATE_THRESHOLD_PCT = 1
const P95_AMBER_THRESHOLD_MS = 500

/**
 * Devuelve la clase Tailwind a aplicar a una celda según el threshold.
 * Mantenemos los thresholds aquí (no en server) para que el dashboard
 * sea autosuficiente y se pueda probar visualmente sin refrescar
 * configuración global.
 */
function errorRateClass(rate: number): string {
  if (rate > ERROR_RATE_THRESHOLD_PCT) return 'text-red-600 font-semibold'
  return 'text-foreground'
}

function p95Class(p95: number): string {
  if (p95 > P95_AMBER_THRESHOLD_MS) return 'text-amber-600 font-semibold'
  return 'text-foreground'
}

function formatLast(ts: number | null): string {
  if (ts == null) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (seconds < 60) return `hace ${seconds}s`
  const minutes = Math.round(seconds / 60)
  return `hace ${minutes}m`
}

export function ObservabilityDashboard() {
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)

  const fetchSnapshot = useCallback(async (signal?: AbortSignal): Promise<void> => {
    try {
      const res = await fetch('/api/internal/metrics', {
        cache: 'no-store',
        signal,
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = (await res.json()) as MetricsResponse
      setData(json)
      setError(null)
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'fetch failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    // Diferir el primer fetch a un microtask hace que React no contabilice
    // su setState como "sincrónico dentro del effect" (regla
    // `react-hooks/set-state-in-effect`). El resultado funcional es el
    // mismo: una request en cuanto monta + una cada 30s.
    const t = setTimeout(() => {
      void fetchSnapshot(controller.signal)
    }, 0)
    const id = setInterval(() => {
      void fetchSnapshot()
    }, REFRESH_INTERVAL_MS)
    return () => {
      clearTimeout(t)
      clearInterval(id)
      controller.abort()
    }
  }, [fetchSnapshot])

  const handleReset = useCallback(async () => {
    if (!window.confirm('¿Resetear todas las métricas RED de esta instancia?')) {
      return
    }
    setResetBusy(true)
    try {
      const res = await fetch('/api/internal/metrics/reset', {
        method: 'POST',
      })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      await fetchSnapshot()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'reset failed')
    } finally {
      setResetBusy(false)
    }
  }, [fetchSnapshot])

  // Ordenar por p95 desc para que las acciones más lentas queden arriba.
  const rows = data
    ? Object.entries(data.metrics)
        .map(([name, snap]) => ({ name, ...snap }))
        .sort((a, b) => b.p95 - a.p95)
    : []

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {data ? (
            <>
              Última captura:{' '}
              <span className="font-mono">{new Date(data.capturedAt).toLocaleTimeString()}</span>{' '}
              · {data.metricsCount} métricas · vía {data.via}
            </>
          ) : loading ? (
            'Cargando…'
          ) : (
            '—'
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void fetchSnapshot()}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            Refrescar
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={resetBusy}
            className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            {resetBusy ? 'Reseteando…' : 'Reset metrics'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Acción</th>
              <th className="px-4 py-2 text-right">Count</th>
              <th className="px-4 py-2 text-right">Errors</th>
              <th className="px-4 py-2 text-right">Error %</th>
              <th className="px-4 py-2 text-right">p50 (ms)</th>
              <th className="px-4 py-2 text-right">p95 (ms)</th>
              <th className="px-4 py-2 text-right">p99 (ms)</th>
              <th className="px-4 py-2 text-right">Última</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                  Sin datos. Las métricas se acumulan a medida que las server
                  actions instrumentadas se ejecutan.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.name} className="hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs">{row.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.count}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.errors}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${errorRateClass(row.errorRate)}`}>
                  {row.errorRate.toFixed(2)}%
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{row.p50}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${p95Class(row.p95)}`}>
                  {row.p95}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{row.p99}</td>
                <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                  {formatLast(row.lastSampleAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-red-500 align-middle" />{' '}
          errorRate &gt; {ERROR_RATE_THRESHOLD_PCT}%
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-full bg-amber-500 align-middle" />{' '}
          p95 &gt; {P95_AMBER_THRESHOLD_MS}ms
        </span>
        <span>Auto-refresh cada {REFRESH_INTERVAL_MS / 1000}s</span>
      </div>
    </section>
  )
}
