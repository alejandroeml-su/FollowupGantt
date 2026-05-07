import Link from 'next/link'
import { ArrowLeft, GitBranch } from 'lucide-react'
import { listAllCrossDependencies } from '@/lib/actions/cross-dependencies'
import { CrossDependencyList } from '@/components/portfolio/CrossDependencyList'

export const dynamic = 'force-dynamic'

export default async function PortfolioDependenciesPage() {
  const deps = await listAllCrossDependencies()

  // Agrupamos por proyecto fuente para visualización jerárquica.
  type Item = (typeof deps)[number]
  const byProject = new Map<
    string,
    { projectName: string; outbound: Item[]; inbound: Item[] }
  >()

  for (const d of deps) {
    const sp = d.sourceTask.project
    const tp = d.targetTask.project
    if (!byProject.has(sp.id)) {
      byProject.set(sp.id, {
        projectName: sp.name,
        outbound: [],
        inbound: [],
      })
    }
    if (!byProject.has(tp.id)) {
      byProject.set(tp.id, {
        projectName: tp.name,
        outbound: [],
        inbound: [],
      })
    }
    byProject.get(sp.id)!.outbound.push(d)
    byProject.get(tp.id)!.inbound.push(d)
  }

  const sections = Array.from(byProject.entries())
    .map(([id, info]) => ({ id, ...info }))
    .sort((a, b) => a.projectName.localeCompare(b.projectName, 'es-MX'))

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href="/portfolio"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Portfolio
          </Link>
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <GitBranch className="h-5 w-5 text-indigo-400" />
            Dependencias cross-project
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Programa: dependencias entre tareas de proyectos distintos.{' '}
            {deps.length} dependencia{deps.length === 1 ? '' : 's'} registrada
            {deps.length === 1 ? '' : 's'}.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <CrossDependencyList sections={sections} />
      </div>
    </div>
  )
}
