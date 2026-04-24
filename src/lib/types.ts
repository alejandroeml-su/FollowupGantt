import { Prisma } from '@prisma/client';

// ─── Prisma-derived Types ────────────────────────────────────────

/** Full task with assignee, project, subtasks, and comments */
export type TaskWithRelations = Prisma.TaskGetPayload<{
  include: {
    assignee: true;
    project: true;
    subtasks: { include: { assignee: true } };
    comments: { include: { author: true } };
  };
}>;

/** Task with assignee + project only (for Kanban/Gantt) */
export type TaskWithAssignee = Prisma.TaskGetPayload<{
  include: {
    assignee: true;
    project: true;
    comments: { include: { author: true } };
  };
}>;

/** Serialized comment for client components (Date → string) */
export interface SerializedComment {
  id: string;
  content: string;
  createdAt: string;
  author?: { id: string; name: string } | null;
}

/** Serialized task for client components (Date → string) */
export interface SerializedTask {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  type: string;
  progress: number;
  startDate?: string | null;
  endDate?: string | null;
  isMilestone?: boolean;
  assignee?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
  subtasks?: SerializedTask[];
  comments?: SerializedComment[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ─── Serialization Utility ───────────────────────────────────────

/**
 * Converts Prisma Task (with Date objects) into a plain JSON-safe object
 * for passing from Server Components to Client Components.
 */
export function serializeTask(task: Record<string, unknown>): SerializedTask {
  const t = task as Record<string, any>;
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    priority: t.priority,
    type: t.type,
    progress: t.progress ?? 0,
    isMilestone: t.isMilestone ?? false,
    startDate: t.startDate ? new Date(t.startDate).toISOString() : null,
    endDate: t.endDate ? new Date(t.endDate).toISOString() : null,
    createdAt: t.createdAt?.toISOString?.() ?? null,
    updatedAt: t.updatedAt?.toISOString?.() ?? null,
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
    project: t.project ? { id: t.project.id, name: t.project.name } : null,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map((s: Record<string, unknown>) => serializeTask(s)) : [],
    comments: Array.isArray(t.comments) ? t.comments.map((c: Record<string, any>) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt?.toISOString?.() ?? null,
      author: c.author ? { id: c.author.id, name: c.author.name } : null,
    })) : [],
  };
}
