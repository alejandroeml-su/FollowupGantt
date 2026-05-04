'use client'

/**
 * Ola P5 · Equipo P5-4 · AI Insights — Botón "Recalcular insights".
 *
 * Dispara `runProjectInsights` para un proyecto y refresca la página.
 * Maneja estado pending + error básico. Sin toast (para no atar a una
 * librería de UI específica): error en consola y comportamiento no
 * intrusivo.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { runProjectInsights } from '@/lib/actions/insights'

interface Props {
  projectId: string
  label?: string
}

export function InsightsRunButton({
  projectId,
  label = 'Recalcular insights',
}: Props): React.JSX.Element {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick(): void {
    setError(null)
    startTransition(async () => {
      try {
        await runProjectInsights(projectId)
        router.refresh()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error inesperado'
        setError(msg)
        console.error('[InsightsRunButton]', err)
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        {pending ? 'Calculando…' : label}
      </button>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  )
}
