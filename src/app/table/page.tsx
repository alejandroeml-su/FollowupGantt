import prisma from "@/lib/prisma";
import { serializeTask } from "@/lib/types";
import { TableBoardClient } from "@/components/interactions/TableBoardClient";

export const dynamic = "force-dynamic";

export default async function TableDBPage() {
  const [dbTasks, projects, users] = await Promise.all([
    prisma.task.findMany({
      include: {
        project: true,
        assignee: true,
        comments: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.project.findMany({ orderBy: { name: 'asc' } }),
    prisma.user.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const tasks = dbTasks.map(t => ({
    ...serializeTask(t),
    commentCount: t.comments.length
  }));

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <TableBoardClient tasks={tasks} projects={projects} users={users} />
    </div>
  );
}
