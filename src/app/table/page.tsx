import prisma from "@/lib/prisma";
import { serializeTask, type SerializedTask } from "@/lib/types";
import { TableBoardClient } from "@/components/interactions/TableBoardClient";
import { getCurrentUserPresence } from "@/lib/auth/get-current-user-presence";
import {
  buildTaskTreeInclude,
  DEFAULT_TREE_DEPTH,
  flattenTaskTree,
} from "@/lib/tasks/load-tree";

export const dynamic = "force-dynamic";

export default async function TableDBPage() {
  // Wave P7 · C-DEBT-2 — Identidad del usuario activo para drillarla al
  // drawer (presence + edit locks).
  const currentUser = await getCurrentUserPresence();

  // Carga el árbol desde raíces (parentId=null) con N niveles. Tabla
  // muestra todo flat con indentación por `depth`, así que aplanamos
  // en DFS preservando el orden jerárquico (padre, hijos, nietos...).
  const [dbRoots, projects, users, allTasksRaw, gerencias, areas, epics] = await Promise.all([
    prisma.task.findMany({
      where: { parentId: null, archivedAt: null },
      include: buildTaskTreeInclude({ depth: DEFAULT_TREE_DEPTH }),
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.project.findMany({ select: { id: true, name: true, areaId: true }, orderBy: { name: 'asc' } }),
    prisma.user.findMany({ orderBy: { name: 'asc' } }),
    prisma.task.findMany({
      where: { archivedAt: null },
      select: { id: true, title: true, mnemonic: true, projectId: true, project: { select: { id: true, name: true } } },
      orderBy: [{ project: { name: 'asc' } }, { title: 'asc' }],
    }),
    prisma.gerencia.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    prisma.area.findMany({ select: { id: true, name: true, gerenciaId: true }, orderBy: { name: 'asc' } }),
    // Wave P9 — Epics activas para selector + filtro.
    prisma.epic.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true, color: true, projectId: true },
      orderBy: [{ projectId: 'asc' }, { position: 'asc' }],
    }),
  ]);

  // Serializa cada raíz (recursa por subtasks) y luego aplana en DFS
  // para que el orden de filas sea: raíz1, hijo1, nieto1, hijo2, raíz2...
  const serializedRoots: SerializedTask[] = dbRoots.map((r) =>
    serializeTask(r as unknown as Record<string, unknown>),
  )
  const flat = flattenTaskTree(serializedRoots);

  const tasks = flat.map((t) => ({
    ...t,
    commentCount: t.comments?.length ?? 0,
  }));

  return (
    <div className="flex h-full flex-col bg-background transition-colors duration-300">
      <TableBoardClient
        tasks={tasks}
        projects={projects}
        users={users}
        allTasks={allTasksRaw}
        gerencias={gerencias}
        areas={areas}
        epics={epics}
        currentUser={currentUser}
      />
    </div>
  );
}
