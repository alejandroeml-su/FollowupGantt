/**
 * Wave P18-D · Performance Reports PMI — Hub de descargas por proyecto.
 *
 * Server component. Lista los 3 reportes ejecutivos disponibles con
 * enlaces de descarga directos a las APIs.
 */

import Link from 'next/link'
import { ArrowLeft, FileBarChart, FileSpreadsheet, BookOpen } from 'lucide-react'
import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProjectReportsPage({ params }: PageProps) {
  const { id: projectId } = await params

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  })
  if (!project) notFound()

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <Link
            href={`/projects/${projectId}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> Proyecto
          </Link>
          <h1 className="mt-1 inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <FileBarChart className="h-5 w-5 text-indigo-400" />
            Performance Reports · {project.name}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Reportes ejecutivos PMI con KPIs · EVM · riesgos · calidad · lecciones aprendidas.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <ReportCard
            icon={FileBarChart}
            title="Status Report"
            description="Vista de una página con KPIs principales, EVM, top 10 riesgos, calidad y velocidad de sprints. Formato HTML print-friendly · descargable como PDF desde el navegador (Cmd/Ctrl+P → Guardar como PDF)."
            cta="Abrir Status Report"
            href={`/api/reports/pmi/status/${projectId}`}
            target="_blank"
            tone="indigo"
          />

          <ReportCard
            icon={FileSpreadsheet}
            title="Final Project Report"
            description="Reporte completo de cierre PMI con 4 hojas: Resumen ejecutivo · Top riesgos · Sprints + velocity · Lecciones aprendidas. Formato XLSX para archivo histórico (PMI close phase) y entregables a stakeholders."
            cta="Descargar XLSX"
            href={`/api/reports/pmi/final/${projectId}`}
            tone="emerald"
            download
          />

          <ReportCard
            icon={BookOpen}
            title="Lessons Learned Summary"
            description="Las últimas 50 lecciones aprendidas del proyecto en XLSX con todas las categorías · contexto · qué pasó · recomendación. Está incluido dentro del Final Project Report como hoja Lecciones — descárgalo desde ahí si necesitas todo el snapshot."
            cta="Ir a Lecciones (UI)"
            href={`/projects/${projectId}/lessons-learned`}
            tone="amber"
          />

          <div className="rounded-lg border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">📋 Tip</p>
            <p className="mt-1">
              Los reportes se generan dinámicamente con los datos del proyecto al momento
              de la descarga. Para snapshots históricos congelados, captura un EVM Snapshot
              en{' '}
              <Link
                href={`/projects/${projectId}/evm`}
                className="text-primary underline"
              >
                EVM
              </Link>{' '}
              antes de generar el reporte final.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReportCard({
  icon: Icon,
  title,
  description,
  cta,
  href,
  target,
  download,
  tone,
}: {
  icon: typeof FileBarChart
  title: string
  description: string
  cta: string
  href: string
  target?: '_blank'
  download?: boolean
  tone: 'indigo' | 'emerald' | 'amber'
}) {
  const toneClasses = {
    indigo: 'border-indigo-500/40 bg-indigo-500/5',
    emerald: 'border-emerald-500/40 bg-emerald-500/5',
    amber: 'border-amber-500/40 bg-amber-500/5',
  }[tone]
  const buttonClasses = {
    indigo: 'bg-indigo-500 hover:bg-indigo-600',
    emerald: 'bg-emerald-500 hover:bg-emerald-600',
    amber: 'bg-amber-500 hover:bg-amber-600 text-amber-950',
  }[tone]

  return (
    <article className={`rounded-xl border p-5 ${toneClasses}`}>
      <header className="flex items-center gap-3">
        <Icon className="h-6 w-6" />
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
      </header>
      <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{description}</p>
      <div className="mt-3">
        <a
          href={href}
          target={target}
          download={download}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold text-white ${buttonClasses}`}
        >
          {cta}
        </a>
      </div>
    </article>
  )
}
