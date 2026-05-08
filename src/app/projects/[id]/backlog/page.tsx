import prisma from '@/lib/prisma'
import BacklogClient, {
  type ProductBacklogTreeData,
  type ProductBacklogTreeTask,
  type SprintBacklogGroup,
} from '@/components/backlog/BacklogClient'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ id: string }>
}

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

type RawTask = {
  id: string
  mnemonic: string | null
  title: string
  description: string | null
  status: string
  priority: string
  type: string
  storyPoints: number | null
  position: number
  parentId: string | null
  sprintId: string | null
  epicId: string | null
  assignee: { id: string; name: string } | null
}

/**
 * Construye el árbol de tasks (raíces parentId=null + recursión de subtasks)
 * a partir de una lista plana ya filtrada.
 */
function buildTree(rows: RawTask[]): ProductBacklogTreeTask[] {
  const byParent = new Map<string | null, RawTask[]>()
  for (const r of rows) {
    const list = byParent.get(r.parentId) ?? []
    list.push(r)
    byParent.set(r.parentId, list)
  }

  function makeNode(t: RawTask): ProductBacklogTreeTask {
    const children = (byParent.get(t.id) ?? [])
      .map(makeNode)
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 99
        const pb = PRIORITY_ORDER[b.priority] ?? 99
        if (pa !== pb) return pa - pb
        return a.position - b.position
      })
    return {
      id: t.id,
      mnemonic: t.mnemonic,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      storyPoints: t.storyPoints,
      position: t.position,
      parentId: t.parentId,
      assignee: t.assignee,
      children,
    }
  }

  return (byParent.get(null) ?? [])
    .map(makeNode)
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99
      const pb = PRIORITY_ORDER[b.priority] ?? 99
      if (pa !== pb) return pa - pb
      return a.position - b.position
    })
}

export default async function ProjectBacklogPage({ params }: PageProps) {
  const { id: projectId } = await params

  const [project, allTasks, sprints, epics] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    // Cargamos TODAS las tasks no-archivadas no-DONE del proyecto en una
    // sola query plana. En cliente reconstruimos el árbol según contexto
    // (Product Backlog vs Sprint Backlog X).
    prisma.task.findMany({
      where: {
        projectId,
        archivedAt: null,
        status: { not: 'DONE' },
      },
      select: {
        id: true,
        mnemonic: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        type: true,
        storyPoints: true,
        position: true,
        parentId: true,
        sprintId: true,
        epicId: true,
        assignee: { select: { id: true, name: true } },
      },
    }),
    prisma.sprint.findMany({
      where: { projectId, endedAt: null },
      select: {
        id: true,
        name: true,
        goal: true,
        startDate: true,
        endDate: true,
        capacity: true,
      },
      orderBy: { startDate: 'asc' },
    }),
    prisma.epic.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, name: true, color: true },
      orderBy: { position: 'asc' },
    }),
  ])

  if (!project) notFound()

  // ─── Product Backlog tree (sprintId=null) ───────────────────────
  // Para que las subtasks aparezcan dentro del árbol, incluimos:
  //  · raíces sin sprint (parentId=null AND sprintId=null), y
  //  · cualquier task descendiente de esas raíces (independiente de su
  //    propio sprintId — por simplicidad asumimos que las subtasks
  //    siguen al padre).
  // Para Wave demo limitamos a tasks con sprintId=null en la raíz; las
  // subtasks se incluyen sí o sí porque la query trae todas las del
  // proyecto.
  const productRoots = allTasks.filter(
    (t) => t.parentId === null && t.sprintId === null,
  )
  const productSubtreeIds = new Set<string>(productRoots.map((r) => r.id))
  // BFS para incluir todos los descendientes de las raíces.
  let frontier = productRoots.map((r) => r.id)
  while (frontier.length) {
    const next: string[] = []
    for (const t of allTasks) {
      if (t.parentId && frontier.includes(t.parentId) && !productSubtreeIds.has(t.id)) {
        productSubtreeIds.add(t.id)
        next.push(t.id)
      }
    }
    frontier = next
  }
  const productSubset = allTasks.filter((t) => productSubtreeIds.has(t.id))
  const productTree = buildTree(productSubset)

  // Agrupa el Product Tree por Epic (incluye bucket "Sin Epic").
  const productByEpic: ProductBacklogTreeData = epics.map((e) => ({
    epicId: e.id,
    epicName: e.name,
    epicColor: e.color,
    tasks: productTree.filter((t) =>
      productSubset.find((p) => p.id === t.id)?.epicId === e.id,
    ),
  }))
  // Bucket "Sin Epic"
  const sinEpicTasks = productTree.filter((t) =>
    productSubset.find((p) => p.id === t.id && p.epicId === null),
  )
  if (sinEpicTasks.length > 0) {
    productByEpic.push({
      epicId: null,
      epicName: 'Sin Epic',
      epicColor: '#64748b',
      tasks: sinEpicTasks,
    })
  }

  // ─── Sprint Backlogs (un grupo por sprint activo, lista plana raíces) ────
  const sprintBacklogs: SprintBacklogGroup[] = sprints.map((s) => {
    const tasksOfSprint = allTasks.filter(
      (t) => t.sprintId === s.id && t.parentId === null,
    )
    return {
      sprintId: s.id,
      sprintName: s.name,
      sprintGoal: s.goal,
      capacity: s.capacity ?? null,
      startDate: s.startDate?.toISOString() ?? null,
      endDate: s.endDate?.toISOString() ?? null,
      tasks: tasksOfSprint
        .map((t) => ({
          id: t.id,
          mnemonic: t.mnemonic,
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          type: t.type,
          storyPoints: t.storyPoints,
          position: t.position,
          assignee: t.assignee,
          epic: t.epicId
            ? epics.find((e) => e.id === t.epicId)
              ? {
                  id: t.epicId,
                  name: epics.find((e) => e.id === t.epicId)!.name,
                  color: epics.find((e) => e.id === t.epicId)!.color,
                }
              : null
            : null,
        }))
        .sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority] ?? 99
          const pb = PRIORITY_ORDER[b.priority] ?? 99
          if (pa !== pb) return pa - pb
          return a.position - b.position
        }),
    }
  })

  // Backlog plano legado (Product Backlog raíces sin sprint, sin descendientes)
  // se conserva para el toolbar bulk-assign + drag-drop reorder.
  const flatProductBacklog = productRoots
    .map((t) => ({
      id: t.id,
      mnemonic: t.mnemonic,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      type: t.type,
      storyPoints: t.storyPoints,
      position: t.position,
      assignee: t.assignee,
      epic: t.epicId
        ? epics.find((e) => e.id === t.epicId)
          ? {
              id: t.epicId,
              name: epics.find((e) => e.id === t.epicId)!.name,
              color: epics.find((e) => e.id === t.epicId)!.color,
            }
          : null
        : null,
    }))
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99
      const pb = PRIORITY_ORDER[b.priority] ?? 99
      if (pa !== pb) return pa - pb
      return a.position - b.position
    })

  const serializedSprints = sprints.map((s) => ({
    id: s.id,
    name: s.name,
    startDate: s.startDate?.toISOString() ?? null,
    endDate: s.endDate?.toISOString() ?? null,
    capacity: s.capacity ?? null,
  }))

  return (
    <div className="flex h-full flex-col bg-background">
      <BacklogClient
        project={project}
        initialBacklog={flatProductBacklog}
        sprints={serializedSprints}
        epics={epics}
        sprintBacklogs={sprintBacklogs}
        productTreeByEpic={productByEpic}
      />
    </div>
  )
}
