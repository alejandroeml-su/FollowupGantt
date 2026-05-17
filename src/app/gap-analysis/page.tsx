/**
 * US-9.2 · Wave R5 — Página /gap-analysis · listado de análisis Gap
 * visibles para el usuario actual.
 *
 * Server component:
 *   1. Carga la lista filtrada por RBAC (`listGapAnalyses`).
 *   2. Carga proyectos visibles para llenar el dropdown "Nuevo análisis".
 *   3. Delega la UI a `<GapAnalysisClient />` que maneja filtros locales
 *      + modal de creación + navegación al detalle.
 */

import { Scale } from 'lucide-react'
import {
  listGapAnalyses,
  listVisibleProjectsForGap,
} from '@/lib/actions/gap-analysis'
import GapAnalysisClient from '@/components/gap-analysis/GapAnalysisClient'

export const dynamic = 'force-dynamic'

type SP = Promise<{ projectId?: string }>

export default async function GapAnalysisPage({
  searchParams,
}: {
  searchParams: SP
}) {
  const sp = await searchParams
  const projectId = sp.projectId ?? null

  const [items, projects] = await Promise.all([
    listGapAnalyses({ projectId }),
    listVisibleProjectsForGap(),
  ])

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6">
      <header className="flex items-center gap-2">
        <Scale className="h-5 w-5 text-primary" aria-hidden />
        <h1 className="text-lg font-semibold">Gap Analysis · AS-IS vs TO-BE</h1>
      </header>
      <p className="text-xs text-muted-foreground">
        Compara el estado actual del proyecto (AS-IS) con el estado
        deseado (TO-BE) a través de dimensiones automáticas (DoD, RACI,
        velocity, cycle time…) y manuales (encuestas, evaluaciones de
        madurez). Cada dimensión muestra el gap, su color cualitativo y
        las tareas asociadas para cerrarlo.
      </p>

      <GapAnalysisClient
        items={items}
        projects={projects}
        initialProjectId={projectId}
      />
    </main>
  )
}
