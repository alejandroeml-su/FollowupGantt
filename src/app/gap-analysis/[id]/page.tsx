/**
 * US-9.2 · Wave R5 — Detalle de un Gap Analysis.
 *
 * Carga el análisis con todas sus dimensiones (auto + manual) y sus
 * acciones asociadas. RBAC enforced en `getGapAnalysisById`
 * (`requireProjectAccess`). Si no existe o el usuario no tiene visibilidad,
 * el server action lanza FORBIDDEN/NOT_FOUND y Next muestra notFound().
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Scale } from 'lucide-react'

import {
  getGapAnalysisById,
  listProjectTasksForLinking,
} from '@/lib/actions/gap-analysis'
import { AUTO_METRICS } from '@/lib/gap-analysis/auto-metrics'
import GapDimensionsTable from '@/components/gap-analysis/GapDimensionsTable'
import GapRadarChart from '@/components/gap-analysis/GapRadarChart'

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>

export default async function GapAnalysisDetailPage({
  params,
}: {
  params: Params
}) {
  const { id } = await params

  let item
  try {
    item = await getGapAnalysisById(id)
  } catch (err) {
    // `requireProjectAccess` lanza [FORBIDDEN] cuando no hay visibilidad.
    // Resolvemos a notFound() para no filtrar la existencia del recurso.
    if (err instanceof Error && err.message.startsWith('[FORBIDDEN]')) {
      notFound()
    }
    throw err
  }
  if (!item) notFound()

  const projectTasks = await listProjectTasksForLinking(item.projectId)

  // Catálogo serializable de auto-metrics (sin `compute`) para el cliente.
  const autoMetricsCatalog = AUTO_METRICS.map((m) => ({
    key: m.key,
    label: m.label,
    defaultToBe: m.defaultToBe,
    unit: m.unit,
    description: m.description,
    direction: m.direction,
  }))

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <Link
          href="/gap-analysis"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Todos los análisis
        </Link>
        <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {item.status}
        </span>
      </div>

      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Scale className="h-5 w-5 text-primary" aria-hidden />
          {item.name}
        </h1>
        <p className="text-xs text-muted-foreground">
          Proyecto:{' '}
          <Link
            href={`/projects/${item.projectId}`}
            className="underline hover:text-foreground"
          >
            {item.projectName ?? item.projectId}
          </Link>
          {item.targetDate && (
            <>
              {' · '}
              <span>
                Objetivo:{' '}
                {new Date(item.targetDate).toLocaleDateString('es-MX')}
              </span>
            </>
          )}
        </p>
        {item.description && (
          <p className="text-sm">{item.description}</p>
        )}
      </header>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-lg border bg-card p-3">
          <GapDimensionsTable
            gap={item}
            autoMetricsCatalog={autoMetricsCatalog}
            projectTasks={projectTasks}
          />
        </div>
        <div className="rounded-lg border bg-card p-3">
          <h2 className="mb-2 text-sm font-semibold">
            Radar AS-IS vs TO-BE
          </h2>
          <GapRadarChart dimensions={item.dimensions} />
          {item.overallScore != null && (
            <p className="mt-3 text-xs text-muted-foreground">
              Score global:{' '}
              <span className="font-medium text-foreground">
                {item.overallScore.toFixed(1)}%
              </span>{' '}
              de dimensiones con objetivo alcanzado.
            </p>
          )}
        </div>
      </section>
    </main>
  )
}
