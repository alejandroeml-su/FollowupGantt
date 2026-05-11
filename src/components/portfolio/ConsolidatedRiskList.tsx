'use client'

/**
 * Wave P10 (HU-10.5 · ALPHA-2.3) — Lista detallada de riesgos consolidados.
 *
 * Muestra cada riesgo con drill-down al proyecto, severity y status.
 * Botón "Imprimir / PDF" usa window.print() — el `@media print` CSS oculta
 * navegación y renderiza páginas en formato carta.
 */

import Link from 'next/link'
import { Printer } from 'lucide-react'
import type { ConsolidatedRiskItem } from '@/lib/portfolio/risks'
import { useTranslation } from '@/lib/i18n/use-translation'

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function ConsolidatedRiskList({
  items,
}: {
  items: ConsolidatedRiskItem[]
}) {
  const { t, locale } = useTranslation()

  const SEV_TAG: Record<
    ConsolidatedRiskItem['severity'],
    { label: string; classes: string }
  > = {
    HIGH: {
      label: t('pages.portfolioRisks.severityHigh'),
      classes: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    },
    MEDIUM: {
      label: t('pages.portfolioRisks.severityMedium'),
      classes: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    },
    LOW: {
      label: t('pages.portfolioRisks.severityLow'),
      classes: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    },
  }

  const STATUS_LABEL: Record<ConsolidatedRiskItem['status'], string> = {
    OPEN: t('pages.portfolioRisks.statusOpen'),
    MITIGATING: t('pages.portfolioRisks.statusMitigating'),
    ACCEPTED: t('pages.portfolioRisks.statusAccepted'),
    CLOSED: t('pages.portfolioRisks.statusClosed'),
  }

  const STATUS_TAG: Record<ConsolidatedRiskItem['status'], string> = {
    OPEN: 'bg-rose-500/15 text-rose-300',
    MITIGATING: 'bg-sky-500/15 text-sky-300',
    ACCEPTED: 'bg-amber-500/15 text-amber-300',
    CLOSED: 'bg-slate-500/15 text-slate-300',
  }

  if (items.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <p className="text-sm text-muted-foreground">
          {t('pages.portfolioRisks.emptyPortfolio')}
        </p>
      </section>
    )
  }

  // Orden de salida: HIGH primero, luego MEDIUM, luego LOW; dentro, por
  // detectedAt descendente (más recientes primero).
  const SEV_ORDER: Record<ConsolidatedRiskItem['severity'], number> = {
    HIGH: 0,
    MEDIUM: 1,
    LOW: 2,
  }
  const sorted = [...items].sort((a, b) => {
    const sevDiff = SEV_ORDER[a.severity] - SEV_ORDER[b.severity]
    if (sevDiff !== 0) return sevDiff
    return b.detectedAt.localeCompare(a.detectedAt)
  })

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between print:hidden">
        <h3 className="text-sm font-semibold text-foreground">
          {t('pages.portfolioRisks.detail')} ({items.length})
        </h3>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-input/70"
        >
          <Printer className="h-3.5 w-3.5" /> {t('pages.portfolioRisks.print')}
        </button>
      </div>

      <ul className="mt-3 space-y-2">
        {sorted.map((r) => (
          <li
            key={r.id}
            className="rounded-md border border-border bg-input/40 p-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <Link
                  href={`/projects/${r.projectId}`}
                  className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300 hover:text-indigo-200"
                >
                  {r.projectName}
                </Link>
                <span className="text-sm font-semibold text-foreground">
                  {r.title}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${SEV_TAG[r.severity].classes}`}
                >
                  {SEV_TAG[r.severity].label} · P{r.probability}×I{r.impact}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_TAG[r.status]}`}
                >
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
            </div>

            {r.description && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {r.description}
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <span>{t('pages.portfolioRisks.detectedOn', { date: formatDate(r.detectedAt, locale) })}</span>
              {r.ownerName && <span>· {t('pages.portfolioRisks.ownerLabel', { name: r.ownerName })}</span>}
              {/* Wave P14c — task asociada (origen Brain AI o manual) */}
              {r.taskId && (r.taskMnemonic || r.taskTitle) && (
                <span>
                  ·{' '}
                  <Link
                    href={`/projects/${r.projectId}#task-${r.taskId}`}
                    className="inline-flex items-center gap-1 rounded bg-indigo-500/15 px-1.5 py-0.5 text-indigo-300 hover:bg-indigo-500/25"
                    title={r.taskTitle ?? undefined}
                  >
                    {r.taskMnemonic ? `[${r.taskMnemonic}]` : 'task'}
                    {r.taskTitle && (
                      <span className="hidden sm:inline">{r.taskTitle.slice(0, 40)}</span>
                    )}
                  </Link>
                </span>
              )}
              {r.mitigation && (
                <span className="italic">· {t('pages.portfolioRisks.mitigationLabel', { value: r.mitigation })}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
