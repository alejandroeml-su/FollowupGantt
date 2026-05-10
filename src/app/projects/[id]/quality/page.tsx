/**
 * Wave P18-A — Pantalla de Calidad del proyecto (Inspections + Defects).
 *
 * Server component: carga inspecciones, defectos y catálogo de usuarios
 * en bulk; el cliente gestiona el CRUD via server actions.
 */

import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import {
  listInspectionsForProject,
  listDefectsForProject,
} from '@/lib/actions/quality'
import { ProjectQualityClient } from '@/components/quality/ProjectQualityClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProjectQualityPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, inspections, defects, users, tasks] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    listInspectionsForProject(projectId),
    listDefectsForProject(projectId),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.task.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, title: true, mnemonic: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    }),
  ])

  if (!project) notFound()

  const inspectionsSerialized = inspections.map((i) => ({
    id: i.id,
    type: i.type,
    result: i.result,
    inspectorId: i.inspectorId,
    inspectorName: i.inspector?.name ?? null,
    taskId: i.taskId,
    taskTitle: i.task?.title ?? null,
    taskMnemonic: i.task?.mnemonic ?? null,
    scheduledAt: i.scheduledAt?.toISOString() ?? null,
    completedAt: i.completedAt?.toISOString() ?? null,
    summary: i.summary,
    checklist: i.checklist as { items: Array<{ text: string; done: boolean; notes?: string | null }> } | null,
    defectCount: i._count.defects,
    createdAt: i.createdAt.toISOString(),
  }))

  const defectsSerialized = defects.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    severity: d.severity,
    status: d.status,
    inspectionId: d.inspectionId,
    inspectionType: d.inspection?.type ?? null,
    taskId: d.taskId,
    taskTitle: d.task?.title ?? null,
    taskMnemonic: d.task?.mnemonic ?? null,
    ownerId: d.ownerId,
    ownerName: d.owner?.name ?? null,
    reporterId: d.reporterId,
    reporterName: d.reporter?.name ?? null,
    resolvedAt: d.resolvedAt?.toISOString() ?? null,
    resolution: d.resolution,
    createdAt: d.createdAt.toISOString(),
  }))

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
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            Gestión de Calidad · {project.name}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PMBOK Quality Management · inspecciones formales con checklist +
            defect tracking con workflow OPEN → IN_REVIEW → FIXED.
          </p>
        </div>
      </header>

      <ProjectQualityClient
        project={project}
        inspections={inspectionsSerialized}
        defects={defectsSerialized}
        users={users}
        tasks={tasks}
      />
    </div>
  )
}
