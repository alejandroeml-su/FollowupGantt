'use client'

/**
 * Ola P5 · Equipo P5-4 · AI Insights — Lista de "next actions" sugeridas.
 *
 * Muestra los insights NEXT_ACTION agrupados por proyecto. Cada entrada
 * tiene un botón "Descartar" (soft-delete vía `dismissInsight`).
 */

import { useState, useTransition } from 'react'
import { ListChecks, X } from 'lucide-react'
import { dismissInsight } from '@/lib/actions/insights'

export interface NextActionItem {
  insightId: string
  projectId: string
  projectName: string
  message: string
  severity: number
}

interface Props {
  items: NextActionItem[]
}

export function NextActionsList({ items }: Props): React.JSX.Element {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  function handleDismiss(id: string): void {
    startTransition(async () => {
      try {
        await dismissInsight(id)
        setDismissed((prev) => {
          const next = new Set(prev)
          next.add(id)
          return next
        })
      } catch (err) {
        console.error('[NextActionsList] dismiss', err)
      }
    })
  }

  const visible = items.filter((i) => !dismissed.has(i.insightId))

  if (visible.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Sin acciones recomendadas — todo en orden.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {visible.map((item) => (
        <li
          key={item.insightId}
          className="flex items-start justify-between gap-3 rounded-md border border-gray-200 bg-white p-3 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="flex items-start gap-2">
            <ListChecks
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
              aria-hidden
            />
            <div>
              <p className="text-gray-900 dark:text-gray-100">{item.message}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Proyecto: {item.projectName} · severidad{' '}
                {Math.round(item.severity * 100)}%
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => handleDismiss(item.insightId)}
            aria-label="Descartar sugerencia"
            className="inline-flex items-center gap-1 rounded-md p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-800"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
