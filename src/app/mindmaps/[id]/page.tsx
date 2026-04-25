import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import { MindMapEditor } from '@/components/mindmap/MindMapEditor'

export const dynamic = 'force-dynamic'

type Params = Promise<{ id: string }>

export default async function MindMapEditorPage({ params }: { params: Params }) {
  const { id } = await params

  const [mindMap, availableTasks] = await Promise.all([
    prisma.mindMap.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        nodes: {
          include: {
            task: { select: { id: true, mnemonic: true, title: true } },
          },
        },
        edges: true,
      },
    }),
    prisma.task.findMany({
      select: { id: true, mnemonic: true, title: true, project: { select: { name: true } } },
      orderBy: [{ project: { name: 'asc' } }, { title: 'asc' }],
      take: 500,
    }),
  ])

  if (!mindMap) notFound()

  const initial = {
    id: mindMap.id,
    title: mindMap.title,
    description: mindMap.description,
    project: mindMap.project,
    owner: mindMap.owner,
    nodes: mindMap.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      note: n.note,
      x: n.x,
      y: n.y,
      color: n.color,
      isRoot: n.isRoot,
      taskId: n.taskId,
      task: n.task,
    })),
    edges: mindMap.edges.map((e) => ({
      id: e.id,
      sourceId: e.sourceId,
      targetId: e.targetId,
      label: e.label,
    })),
  }

  const tasks = availableTasks.map((t) => ({
    id: t.id,
    mnemonic: t.mnemonic,
    title: t.title,
    projectName: t.project?.name ?? null,
  }))

  return <MindMapEditor initial={initial} availableTasks={tasks} />
}
