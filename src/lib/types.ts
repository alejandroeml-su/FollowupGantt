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
  parentId?: string | null;
  plannedValue?: number | null;
  actualCost?: number | null;
  tags?: string[];
}

// ─── Serialization Utility ───────────────────────────────────────

/**
 * Converts Prisma Task (with Date objects) into a plain JSON-safe object
 * for passing from Server Components to Client Components.
 */
type DateLike = { toISOString?: () => string } | string | number | Date | null | undefined

type RawPerson = { id: string; name: string }
type RawTask = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  type: string;
  progress?: number;
  isMilestone?: boolean;
  startDate?: DateLike;
  endDate?: DateLike;
  createdAt?: DateLike;
  updatedAt?: DateLike;
  assignee?: RawPerson | null;
  project?: { id: string; name: string } | null;
  subtasks?: unknown[];
  comments?: Array<{
    id: string;
    content: string;
    createdAt?: DateLike;
    author?: RawPerson | null;
  }>;
  parentId?: string | null;
  plannedValue?: number | null;
  actualCost?: number | null;
  tags?: string[];
}

function toISO(d: DateLike): string | null {
  if (!d) return null;
  if (typeof d === 'object' && 'toISOString' in d && typeof d.toISOString === 'function') {
    return d.toISOString();
  }
  try {
    return new Date(d as string | number | Date).toISOString();
  } catch {
    return null;
  }
}

export function serializeTask(task: Record<string, unknown>): SerializedTask {
  const t = task as unknown as RawTask;
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    status: t.status,
    priority: t.priority,
    type: t.type,
    progress: t.progress ?? 0,
    isMilestone: t.isMilestone ?? false,
    startDate: t.startDate ? toISO(t.startDate) : null,
    endDate: t.endDate ? toISO(t.endDate) : null,
    createdAt: toISO(t.createdAt),
    updatedAt: toISO(t.updatedAt),
    parentId: t.parentId ?? null,
    plannedValue: t.plannedValue ?? null,
    actualCost: t.actualCost ?? null,
    tags: Array.isArray(t.tags) ? (t.tags as string[]) : [],
    assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
    project: t.project ? { id: t.project.id, name: t.project.name } : null,
    subtasks: Array.isArray(t.subtasks) ? t.subtasks.map((s) => serializeTask(s as Record<string, unknown>)) : [],
    comments: Array.isArray(t.comments) ? t.comments.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: toISO(c.createdAt) ?? '',
      author: c.author ? { id: c.author.id, name: c.author.name } : null,
    })) : [],
  };
}
