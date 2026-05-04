'use client'

/**
 * Equipo D3 · AINextActionsCard — sugerencias del proyecto activo.
 *
 * Client component porque exponemos un botón "Marcar resuelto" que
 * llama `dismissInsight` (server action) y oculta el ítem optimistically.
 *
 * Decisiones D3:
 *   - D3-AI-1 · Sin `useEffect → setState` para sync (regla
 *     react-hooks/set-state-in-effect): el estado inicial se deriva de
 *     `useState(() => initial)` y los dismissed se persisten solo en
 *     memoria local del componente. Cuando el dashboard re-renderice
 *     (revalidatePath), los datos vuelven frescos.
 *   - D3-AI-2 · Tras un dismiss exitoso llamamos `router.refresh()` para
 *     que el server component padre traiga datos al día sin recargar.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { dismissInsight } from '@/lib/actions/insights'

export type AINextActionItem = {
  id: string
  message: string
  count: number
  projectId: string | null
  projectName: string | null
  severity: number
}

type Props = {
  items: AINextActionItem[]
  /** Inyectable para tests (mockear server action). */
  onDismiss?: (id: string) => Promise<void>
}

export function AINextActionsCard({ items, onDismiss }: Props) {
  const router = useRouter()
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const visible = items.filter((it) => !hidden.has(it.id)).slice(0, 5)

  const handleDismiss = async (id: string) => {
    setPendingId(id)
    try {
      if (onDismiss) {
        await onDismiss(id)
      } else {
        await dismissInsight(id)
      }
      setHidden((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      startTransition(() => {
        router.refresh()
      })
    } catch {
      // Mantener visible si la BD falla; UX se degrada con noop.
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section
      data-testid="ai-next-actions-card"
      className="rounded-2xl bg-card border border-border p-6 space-y-4"
    >
      <header>
        <h2 className="text-lg font-bold text-foreground">Próximas acciones IA</h2>
        <p className="text-xs text-muted-foreground">
          Sugerencias heurísticas listas para ejecutar
        </p>
      </header>

      <ul className="space-y-3">
        {visible.length === 0 && (
          <li className="text-sm text-muted-foreground">
            Nada por hacer. Las heurísticas no detectaron oportunidades.
          </li>
        )}
        {visible.map((it) => (
          <li
            key={it.id}
            data-testid={`ai-next-action-${it.id}`}
            className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{it.message}</p>
              {it.projectName && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {it.projectName}
                  {it.count > 0 ? ` · ${it.count} elementos` : ''}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleDismiss(it.id)}
              disabled={pendingId === it.id}
              className="shrink-0 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
              data-testid={`ai-next-action-dismiss-${it.id}`}
            >
              {pendingId === it.id ? 'Procesando…' : 'Marcar resuelto'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
