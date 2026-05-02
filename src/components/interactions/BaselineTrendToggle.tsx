'use client'

import { LineChart } from 'lucide-react'
import { clsx } from 'clsx'
import { useUIStore } from '@/lib/stores/ui'

/**
 * HU-3.4 · Toggle "Ver SV/SPI" en la toolbar del Gantt.
 *
 * Habilitado solo cuando hay una línea base activa para el proyecto
 * filtrado: sin baseline el panel mostraría placeholder, así que es más
 * útil deshabilitar el control y orientar al usuario via tooltip.
 *
 * Estilo idéntico al resto de los chips de la toolbar (CaptureBaselineButton,
 * BaselineSelector) para consistencia visual.
 */

type Props = {
  projectId: string | null
  /** True si hay alguna baseline activa (zustand) para el proyecto. */
  hasActiveBaseline: boolean
  className?: string
}

export function BaselineTrendToggle({
  projectId,
  hasActiveBaseline,
  className,
}: Props) {
  const open = useUIStore((s) => s.baselineTrendOpen)
  const toggle = useUIStore((s) => s.toggleBaselineTrend)

  const disabled = !projectId || !hasActiveBaseline
  const title = !projectId
    ? 'Selecciona un proyecto'
    : !hasActiveBaseline
      ? 'Activa una línea base para ver SV/SPI'
      : open
        ? 'Cerrar panel de evolución SV/SPI'
        : 'Ver evolución SV/SPI'

  return (
    <button
      type="button"
      data-testid="baseline-trend-toggle"
      aria-pressed={open}
      aria-label={open ? 'Cerrar panel SV/SPI' : 'Abrir panel SV/SPI'}
      title={title}
      disabled={disabled}
      onClick={() => toggle()}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
        open
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-border bg-background text-foreground hover:bg-secondary',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-background',
        className,
      )}
    >
      <LineChart className="h-3.5 w-3.5" />
      Ver SV/SPI
    </button>
  )
}
