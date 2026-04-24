import prisma from "@/lib/prisma";
import { serializeTask } from "@/lib/types";
import { TableBoardClient } from "@/components/interactions/TableBoardClient";

export const dynamic = "force-dynamic";

export default async function TableDBPage() {
  const [dbTasks, projects, users, allTasksRaw, gerencias, areas] = await Promise.all([
    prisma.task.findMany({
      include: {
        project: { include: { area: { include: { gerencia: true } } } },
        assignee: true,
        comments: { include: { author: true }, orderBy: { createdAt: 'desc' } },
        history: { include: { user: true }, orderBy: { createdAt: 'desc' } },
        attachments: { include: { user: true }, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { createdAt: 'desc' }
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
  ]);

  const tasks = dbTasks.map(t => ({
    ...serializeTask(t),
    commentCount: t.comments.length
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
      />
    </div>
  );
}
