'use client'

/**
 * Ola P7 · Equipo P7-3 · Narrativa generada por IA / heurística.
 *
 * Card visual con ícono ✨, badge cuando es heurístico, y botón Regenerar
 * (cliente). Renderiza markdown vía `renderMarkdown` (P2-5).
 *
 * Notas:
 *   - El componente recibe la narrativa ya generada por server. El botón
 *     "Regenerar" llama una server action provista por el padre con
 *     `bypassCache: true` y refresca el árbol con `router.refresh()`.
 *   - No hace streaming (decisión consciente: P7-3 entrega narrativa
 *     completa post-render). Si en el futuro se quiere streaming, se
 *     migra a Server Components con `Suspense` boundary.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { renderMarkdown } from '@/lib/markdown'
import type { Narrative } from '@/lib/ai/summaries/prompts'

export type AINarrativeSectionProps = {
  narrative: Narrative
  /**
   * Server action que regenera la narrativa con `bypassCache: true`.
   * Devuelve la nueva narrativa o lanza. El componente la usa solo para
   * forzar revalidación del cache (no muta state local — confía en que
   * router.refresh() recargará el árbol).
   */
  regenerate?: () => Promise<Narrative>
  /** Título visual de la card. Default "Resumen ejecutivo IA". */
  title?: string
}

export function AINarrativeSection({
  narrative,
  regenerate,
  title = 'Resumen ejecutivo IA',
}: AINarrativeSectionProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const html = renderMarkdown(narrative.markdown)
  const isHeuristic = narrative.source === 'heuristic'

  const handleRegenerate = () => {
    if (!regenerate) return
    setError(null)
    startTransition(async () => {
      try {
        await regenerate()
        router.refresh()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al regenerar'
        setError(msg)
      }
    })
  }

  return (
    <section
      className="ai-narrative-card report-section"
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: '1.25rem',
        background: '#f9fafb',
        marginBottom: '1.5rem',
      }}
      aria-label={title}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: '1.25rem' }}>
          ✨
        </span>
        <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{title}</h2>
        {isHeuristic ? (
          <span
            className="badge-heuristic"
            style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.5rem',
              borderRadius: 12,
              background: '#fef3c7',
              color: '#92400e',
              fontWeight: 600,
            }}
            data-testid="badge-heuristic"
          >
            Generado sin IA
          </span>
        ) : (
          <span
            style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.5rem',
              borderRadius: 12,
              background: '#dbeafe',
              color: '#1e40af',
              fontWeight: 600,
            }}
            data-testid="badge-llm"
          >
            IA
          </span>
        )}
        {regenerate ? (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={isPending}
            className="ai-narrative-regenerate no-print"
            data-print-hide="true"
            style={{
              marginLeft: 'auto',
              fontSize: '0.8rem',
              padding: '0.3rem 0.7rem',
              borderRadius: 6,
              border: '1px solid #d1d5db',
              background: isPending ? '#e5e7eb' : '#fff',
              cursor: isPending ? 'wait' : 'pointer',
            }}
          >
            {isPending ? 'Regenerando…' : 'Regenerar'}
          </button>
        ) : null}
      </header>

      {error ? (
        <p
          role="alert"
          style={{
            color: '#991b1b',
            fontSize: '0.85rem',
            background: '#fee2e2',
            padding: '0.5rem 0.75rem',
            borderRadius: 6,
            marginBottom: '0.75rem',
          }}
        >
          {error}
        </p>
      ) : null}

      <div
        className="ai-narrative-body"
        // El HTML es generado por `renderMarkdown` (escapa todo input antes
        // de aplicar marcadores). Es seguro inyectar.
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <footer
        style={{
          marginTop: '0.75rem',
          fontSize: '0.75rem',
          color: '#6b7280',
        }}
      >
        Generado el{' '}
        {new Date(narrative.generatedAt).toLocaleString('es-MX', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
        {isHeuristic
          ? ' · modo heurístico (sin LLM activado).'
          : ' · resumen con IA — verifica datos antes de decisiones críticas.'}
      </footer>
    </section>
  )
}
