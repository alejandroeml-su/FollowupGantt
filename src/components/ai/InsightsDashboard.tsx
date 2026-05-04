/**
 * Ola P5 · Equipo P5-4 · AI Insights — Dashboard server-side.
 *
 * Layout:
 *   - Header con título + descripción.
 *   - Tarjetas de proyectos con summary (categorización / riesgo / next-actions)
 *     y botón "Recalcular insights".
 *   - Top 10 tareas con riesgo alto (vista global).
 *   - Lista de Next Actions globales.
 *
 * Sin "use client": renderiza data del server y delega la interacción a
 * subcomponentes client (RiskBadge, NextActionsList, InsightsRunButton).
 */

import Link from 'next/link'
import type { RiskOverviewItem } from '@/lib/actions/insights'
import { RiskBadge } from './RiskBadge'
import { InsightsRunButton } from './InsightsRunButton'
import { NextActionsList, type NextActionItem } from './NextActionsList'

export interface ProjectSummaryEntry {
  id: string
  name: string
  categorization: number
  delayRisk: number
  nextAction: number
  highRisk: number
}

interface Props {
  projects: ProjectSummaryEntry[]
  topRisks: RiskOverviewItem[]
  nextActions: NextActionItem[]
}

export function InsightsDashboard({
  projects,
  topRisks,
  nextActions,
}: Props): React.JSX.Element {
  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          Insights
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Categorización, riesgo de retraso y sugerencias accionables generadas
          por heurísticas locales (sin LLM externo).
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-lg font-medium text-gray-900 dark:text-gray-100">
          Proyectos
        </h2>
        {projects.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Sin proyectos disponibles.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <article
                key={p.id}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <header className="flex items-start justify-between gap-2">
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-medium text-gray-900 hover:underline dark:text-gray-100"
                  >
                    {p.name}
                  </Link>
                  {p.highRisk > 0 && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                      {p.highRisk} alto
                    </span>
                  )}
                </header>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Categorización</dt>
                    <dd className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {p.categorization}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Riesgo</dt>
                    <dd className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {p.delayRisk}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-500 dark:text-gray-400">Acciones</dt>
                    <dd className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {p.nextAction}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3">
                  <InsightsRunButton projectId={p.id} />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-gray-900 dark:text-gray-100">
          Top 10 tareas con riesgo de retraso
        </h2>
        {topRisks.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Sin tareas con riesgo evaluado todavía. Recalcula insights desde una
            tarjeta de proyecto.
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-900">
            {topRisks.map((r) => (
              <li
                key={r.taskId}
                className="flex items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                    {r.taskTitle}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {r.projectName}
                    {r.factors.length > 0 && (
                      <>
                        {' '}
                        · <span>{r.factors[0]}</span>
                      </>
                    )}
                  </p>
                </div>
                <RiskBadge level={r.level} score={r.score} factors={r.factors} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-gray-900 dark:text-gray-100">
          Próximas acciones recomendadas
        </h2>
        <NextActionsList items={nextActions} />
      </section>
    </div>
  )
}
