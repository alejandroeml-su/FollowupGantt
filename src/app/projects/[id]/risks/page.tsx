/**
 * Wave R-360 — Pantalla de Gestión 360° de Riesgos del proyecto.
 *
 * Server component. Carga:
 *   - Risks del proyecto (con probability/impact/score/tier serializados)
 *   - Insights heurísticos pendientes de promover (DELAY_RISK no
 *     dismissed y no promovidos previamente)
 *   - Catálogo de usuarios (para owners)
 *
 * Renderiza el cliente que permite: crear/editar/cerrar Risk manual,
 * promover insights heurísticos, y registrar/cerrar acciones correctivas.
 */

import Link from 'next/link'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import { getRisksForProject } from '@/lib/actions/risks'
import { ProjectRisksClient } from '@/components/risks/ProjectRisksClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function ProjectRisksPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, risks, users, insightsRaw, actionsByRisk] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    getRisksForProject(projectId),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.taskInsight.findMany({
      where: {
        kind: 'DELAY_RISK',
        dismissedAt: null,
        task: { projectId },
      },
      orderBy: { score: 'desc' },
      take: 50,
      select: {
        id: true,
        score: true,
        payload: true,
        createdAt: true,
        task: { select: { id: true, title: true, mnemonic: true } },
      },
    }),
    // Acciones correctivas agrupadas por riskId (cargadas en bulk).
    prisma.riskAction.findMany({
      where: { risk: { projectId } },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
      include: { owner: { select: { id: true, name: true } } },
    }),
  ])

  if (!project) notFound()

  // Excluir insights que ya fueron promovidos (Risk con source=HEURISTIC
  // y sourceRef=insightId existe en este proyecto).
  const promotedInsightIds = new Set(
    (
      await prisma.risk.findMany({
        where: { projectId, source: 'HEURISTIC' },
        select: { sourceRef: true },
      })
    )
      .map((r) => r.sourceRef)
      .filter((v): v is string => !!v),
  )

  const pendingInsights = insightsRaw
    .filter((i) => !promotedInsightIds.has(i.id))
    .map((i) => {
      const payload = (i.payload ?? {}) as {
        level?: 'high' | 'medium' | 'low'
        factors?: string[]
      }
      return {
        id: i.id,
        score: i.score,
        level: payload.level ?? 'medium',
        factors: Array.isArray(payload.factors) ? payload.factors : [],
        createdAt: i.createdAt.toISOString(),
        task: {
          id: i.task.id,
          title: i.task.title,
          mnemonic: i.task.mnemonic,
        },
      }
    })

  const actions = actionsByRisk.map((a) => ({
    id: a.id,
    riskId: a.riskId,
    description: a.description,
    status: a.status,
    ownerId: a.ownerId,
    ownerName: a.owner?.name ?? null,
    dueDate: a.dueDate?.toISOString() ?? null,
    doneAt: a.doneAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
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
            <ShieldAlert className="h-5 w-5 text-rose-400" />
            Gestión de Riesgos · {project.name}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Risk Register PMBOK 5×5 con plan de acciones correctivas ·
            promueve insights heurísticos · registra riesgos manuales para
            visión 360°.
          </p>
        </div>
      </header>

      <ProjectRisksClient
        project={project}
        risks={risks}
        actions={actions}
        users={users}
        pendingInsights={pendingInsights}
      />
    </div>
  )
}
