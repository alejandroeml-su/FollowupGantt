'use client'

import { useMemo } from 'react'
import { GitBranch } from 'lucide-react'
import { clsx } from 'clsx'
import { useUIStore } from '@/lib/stores/ui'

/**
 * HU-3.2 · Selector de línea base activa por proyecto.
 *
 * Dropdown nativo (`<select>`) — preferimos nativo a Radix Menu por:
 *  1. accesibilidad gratuita (lector de pantallas, teclado, longpress móvil),
 *  2. cierra automáticamente al elegir,
 *  3. tamaño de bundle.
 *
 * El control NO renderiza el overlay — eso es HU-3.3 (`<GanttBaselineLayer/>`).
 * Aquí solo persistimos el id seleccionado en `useUIStore.activeBaselineId`
 * con clave por `projectId` (mitiga R2: cross-project leak).
 *
 * Cuando no hay baselines disponibles para el proyecto activo, el selector
 * queda deshabilitado mostrando "Sin líneas base".
 */

export type BaselineOption = {
  id: string
  version: number
  /** Etiqueta opcional capturada por el usuario (≤80 chars). */
  label: string | null
  /** ISO datetime del momento de la captura. */
  capturedAt: string
  taskCount: number
}

type Props = {
  projectId: string | null
  baselines: readonly BaselineOption[]
  className?: string
}

function announce(msg: string) {
  if (typeof document === 'undefined') return
  const region = document.getElementById('a11y-live')
  if (!region) return
  region.textContent = ''
  setTimeout(() => (region.textContent = msg), 20)
}

/** Formato corto: "2 may 2026" — coincide con el ejemplo del spec HU-3.2. */
function formatCapturedAt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function BaselineSelector({ projectId, baselines, className }: Props) {
  // Suscripción granular: solo nos interesa el id del proyecto activo, no
  // todo el record. Selector con `useShallow` no es necesario porque el
  // valor primitivo se compara con `===`.
  const activeId = useUIStore((s) =>
    projectId ? s.activeBaselineId[projectId] ?? null : null,
  )
  const setActive = useUIStore((s) => s.setActiveBaseline)
  const clearActive = useUIStore((s) => s.clearActiveBaseline)

  const sorted = useMemo(
    () => [...baselines].sort((a, b) => b.version - a.version),
    [baselines],
  )

  const disabled = !projectId || sorted.length === 0
  const placeholderTitle = !projectId
    ? 'Selecciona un proyecto para ver sus líneas base'
    : sorted.length === 0
      ? 'Sin líneas base capturadas'
      : 'Comparar contra una línea base'

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!projectId) return
    const value = e.target.value
    if (!value) {
      clearActive(projectId)
      announce('Línea base desactivada')
      return
    }
    const opt = sorted.find((b) => b.id === value)
    setActive(projectId, value)
    if (opt) {
      announce(
        `Línea base v.${opt.version} activada${opt.label ? `: ${opt.label}` : ''}`,
      )
    }
  }

  return (
    <label
      className={clsx(
        'inline-flex items-center gap-1.5 text-xs',
        disabled && 'opacity-60',
        className,
      )}
      title={placeholderTitle}
    >
      <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
      <span className="sr-only">Línea base activa</span>
      <select
        data-testid="baseline-selector"
        aria-label="Línea base activa"
        disabled={disabled}
        value={activeId ?? ''}
        onChange={handleChange}
        className={clsx(
          'rounded-md border border-border bg-background py-1.5 px-2 text-xs text-foreground',
          'focus:border-primary focus:outline-none',
          'disabled:cursor-not-allowed',
        )}
      >
        {sorted.length === 0 ? (
          <option value="">Sin líneas base</option>
        ) : (
          <>
            <option value="">Ninguna</option>
            {sorted.map((b) => {
              const date = formatCapturedAt(b.capturedAt)
              const labelText = b.label?.trim() || 'sin etiqueta'
              return (
                <option key={b.id} value={b.id}>
                  v.{b.version} · {date} · {labelText}
                </option>
              )
            })}
          </>
        )}
      </select>
    </label>
  )
}
