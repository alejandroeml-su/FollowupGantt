'use client'

import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { LineChart, X as CloseIcon } from 'lucide-react'
import { useUIStore } from '@/lib/stores/ui'
import { getBaselineSnapshot } from '@/lib/actions/baselines'
import {
  computeBaselineTrend,
  type MonthlyPoint,
} from '@/lib/scheduling/baseline-trend'
import type { BaselineSnapshot } from '@/lib/scheduling/baseline-snapshot'
import type { SerializedTask } from '@/lib/types'
import { BaselineTrendChart } from './BaselineTrendChart'
import { BaselineTrendTable } from './BaselineTrendTable'

/**
 * HU-3.4 · Panel lateral derecho con la evolución SV/SPI del proyecto
 * activo contra la línea base activa. Open/close persistido en zustand
 * (`baselineTrendOpen`).
 *
 * Carga lazy del snapshot al abrir el panel. Si el panel está cerrado,
 * NO hace fetch — el costo del JSON queda confinado a usuarios que de
 * verdad consultan la curva.
 *
 * Layout responsable: el panel se ancla absoluta a la derecha del
 * área de trabajo Gantt. El padre (`/gantt/page.tsx`) reserva
 * `padding-right` cuando esté abierto para evitar solapamiento con
 * el board.
 *
 * A11y:
 *  - role="complementary" + aria-label.
 *  - Botón de cierre con aria-label y atajo Escape.
 *  - Anuncio vivo en aperturas.
 */

type Props = {
  /** Proyecto activo (filtro). Si es null, el panel muestra placeholder. */
  projectId: string | null
  /** Tareas reales actuales del proyecto activo. */
  tasks: readonly SerializedTask[]
  className?: string
}

function announce(msg: string) {
  if (typeof document === 'undefined') return
  const region = document.getElementById('a11y-live')
  if (!region) return
  region.textContent = ''
  setTimeout(() => (region.textContent = msg), 20)
}

function parseActionError(err: unknown): { code: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/^\[([A-Z_]+)\]\s*(.+)$/)
  return m ? { code: m[1], detail: m[2] } : { code: 'UNKNOWN', detail: msg }
}

export function BaselineTrendPanel({ projectId, tasks, className }: Props) {
  const open = useUIStore((s) => s.baselineTrendOpen)
  const toggleOpen = useUIStore((s) => s.toggleBaselineTrend)
  const activeBaselineId = useUIStore((s) =>
    projectId ? s.activeBaselineId[projectId] ?? null : null,
  )

  const [snapshot, setSnapshot] = useState<{
    id: string
    version: number
    snapshot: BaselineSnapshot
  } | null>(null)
  const [loading, setLoading] = useState(false)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Solo cargamos cuando el panel está abierto Y hay baseline activa.
    if (!open || !projectId || !activeBaselineId) {
      setSnapshot(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const run = async () => {
      try {
        const result = await getBaselineSnapshot(activeBaselineId)
        if (cancelled) return
        if (!result || result.projectId !== projectId) {
          setSnapshot(null)
          return
        }
        setSnapshot({
          id: result.id,
          version: result.version,
          snapshot: result.snapshot,
        })
      } catch (err) {
        if (cancelled) return
        const { code, detail } = parseActionError(err)
        // No spammeamos toast aquí — el GanttBoardClient ya lo hace en
        // su lazy load. Logueamos en consola y degradamos a placeholder.
        if (typeof console !== 'undefined') {
          console.warn(`[BaselineTrendPanel] ${code}: ${detail}`)
        }
        setSnapshot(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [open, projectId, activeBaselineId])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Anuncio vivo al cambio de estado open.
  useEffect(() => {
    announce(open ? 'Panel de evolución SV/SPI abierto' : 'Panel de evolución SV/SPI cerrado')
  }, [open])

  // Cierre con Escape — solo cuando esté abierto.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, toggleOpen])

  const points = useMemo<MonthlyPoint[]>(() => {
    if (!snapshot) return []
    return computeBaselineTrend(
      snapshot.snapshot,
      tasks.map((t) => ({
        id: t.id,
        startDate: t.startDate ?? null,
        endDate: t.endDate ?? null,
        plannedValue: t.plannedValue ?? null,
        earnedValue: null,
        progress: t.progress ?? null,
      })),
    )
  }, [snapshot, tasks])

  return (
    <aside
      role="complementary"
      aria-label="Evolución SV/SPI"
      data-testid="baseline-trend-panel"
      data-open={open}
      className={clsx(
        'shrink-0 overflow-hidden border-l border-border bg-card/40 transition-[width] duration-200 ease-out',
        open ? 'w-[360px]' : 'w-8',
        className,
      )}
    >
      {open ? (
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-foreground">
                Evolución SV/SPI
              </h3>
              {snapshot ? (
                <p className="truncate text-[10px] text-muted-foreground">
                  Línea base v.{snapshot.version}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Cerrar panel de evolución"
              onClick={() => toggleOpen(false)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-3">
            {!projectId ? (
              <p className="text-[11px] text-muted-foreground">
                Selecciona un proyecto en los filtros para ver la evolución.
              </p>
            ) : !activeBaselineId ? (
              <p className="text-[11px] text-muted-foreground">
                Selecciona una línea base para ver evolución.
              </p>
            ) : loading ? (
              <p className="text-[11px] text-muted-foreground">Cargando…</p>
            ) : !snapshot ? (
              <p className="text-[11px] text-muted-foreground">
                No se pudo cargar la línea base.
              </p>
            ) : points.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Sin datos suficientes para graficar.
              </p>
            ) : (
              <div className="space-y-3">
                <BaselineTrendChart points={points} className="text-foreground" />
                <BaselineTrendTable points={points} />
              </div>
            )}
          </div>
        </div>
      ) : (
        // Banda colapsada — botón vertical para reabrir desde el costado.
        <button
          type="button"
          aria-label="Abrir panel de evolución SV/SPI"
          onClick={() => toggleOpen(true)}
          className="flex h-full w-full items-start justify-center pt-3 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        >
          <LineChart className="h-4 w-4" aria-hidden />
        </button>
      )}
    </aside>
  )
}
