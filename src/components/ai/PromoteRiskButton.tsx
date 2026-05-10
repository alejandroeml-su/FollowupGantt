'use client'

/**
 * Wave R-360 — Botón "Promover a Risk Register" usado en `/insights`.
 *
 * Toma un `taskInsightId` (DELAY_RISK heurístico) y lo convierte en un
 * Risk formal del Risk Register, redirigiendo a `/projects/{id}/risks`
 * tras la promoción.
 */

import { useState, useTransition } from 'react'
import { ShieldAlert, ExternalLink } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { promoteHeuristicInsightToRisk } from '@/lib/actions/risk-actions'

type Props = {
  insightId: string
  projectId: string
  variant?: 'compact' | 'default'
}

export function PromoteRiskButton({
  insightId,
  projectId,
  variant = 'compact',
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const handleClick = () => {
    setError(null)
    startTransition(async () => {
      try {
        await promoteHeuristicInsightToRisk({ taskInsightId: insightId })
        router.push(`/projects/${projectId}/risks`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error al promover')
      }
    })
  }

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        title={error ?? 'Promover este insight al Risk Register del proyecto'}
        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
      >
        <ShieldAlert className="h-3 w-3" />
        {isPending ? 'Promoviendo…' : 'Promover'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-2 rounded-md bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/25 disabled:opacity-50"
    >
      <ShieldAlert className="h-3.5 w-3.5" />
      {isPending ? 'Promoviendo…' : 'Promover a Risk Register'}
      <ExternalLink className="h-3 w-3" />
    </button>
  )
}
