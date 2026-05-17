'use client'

/**
 * Wave R5-Extended · US-9.3E — Badge "CI caído" para cards de tarea.
 *
 * Cuando una tarea tiene al menos un CI vinculado (`TaskCILink`) en
 * estado INCIDENT o MAINTENANCE (mapeo DOWN/DEGRADED), mostramos
 * un badge rojo en la card para alertar al asignado que su tarea
 * depende de infraestructura comprometida.
 *
 * Implementación deliberada — fetch ligero on-mount:
 *   - Evitamos modificar `buildTaskTreeInclude` / `serializeTask`
 *     (impactaría Kanban, Lista, Tabla, Gantt, Timeline, Calendar,
 *     Box View — radio ~10x más grande del scope R5E).
 *   - Un único IntersectionObserver-friendly fetch por tarea es
 *     barato porque el componente sólo se monta cuando la card
 *     está en el viewport (Kanban renderiza columnas verticales).
 *   - El server action está protegido por `requireUser`.
 *
 * Si la lista crece a >100 cards visibles, considerar agrupar los
 * fetch en un contexto compartido (provider que batchea por board).
 */

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { getTasksWithImpactedCI } from '@/lib/actions/cmdb'

type Props = {
  taskId: string
  /** Variante visual compacta para cards densas. */
  compact?: boolean
}

export function TaskCiDownBadge({ taskId, compact = true }: Props) {
  const [hasDown, setHasDown] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const ids = await getTasksWithImpactedCI([taskId])
        if (!cancelled) setHasDown(ids.includes(taskId))
      } catch {
        if (!cancelled) setHasDown(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [taskId])

  if (!hasDown) return null

  return (
    <span
      className={
        compact
          ? 'inline-flex items-center gap-0.5 rounded border border-rose-500/40 bg-rose-500/15 px-1 py-0.5 text-[10px] font-medium text-rose-200'
          : 'inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-xs font-medium text-rose-200'
      }
      title="Esta tarea está vinculada a un CI con incidente o en mantenimiento"
      aria-label="Tarea vinculada a CI caído"
      data-testid="task-ci-down-badge"
    >
      <AlertTriangle
        className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'}
        aria-hidden="true"
      />
      CI caído
    </span>
  )
}
