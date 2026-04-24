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

/** Serialized history entry */
export interface SerializedHistoryEntry {
  id: string;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
  createdAt: string;
  user?: { id: string; name: string } | null;
}

/** Serialized attachment */
export interface SerializedAttachment {
  id: string;
  filename: string;
  url: string;
  size?: number | null;
  createdAt: string;
  user?: { id: string; name: string } | null;
}

/** Serialized comment for client components (Date → string) */
export interface SerializedComment {
  id: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
  author?: { id: string; name: string } | null;
}

/** Serialized task for client components (Date → string) */
export interface SerializedTask {
  id: string;
  mnemonic?: string | null;
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
  history?: SerializedHistoryEntry[];
  attachments?: SerializedAttachment[];
  createdAt?: string | null;
  updatedAt?: string | null;
  parentId?: string | null;
  plannedValue?: number | null;
  actualCost?: number | null;
  tags?: string[];
  predecessors?: any[];
  successors?: any[];
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
  mnemonic?: string | null;
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
    isInternal?: boolean;
    createdAt?: DateLike;
    author?: RawPerson | null;
  }>;
  history?: Array<{
    id: string;
    field: string;
    oldValue?: string | null;
    newValue?: string | null;
    createdAt?: DateLike;
    user?: RawPerson | null;
  }>;
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
    size?: number | null;
    createdAt?: DateLike;
    user?: RawPerson | null;
  }>;
  parentId?: string | null;
  plannedValue?: number | null;
  actualCost?: number | null;
  tags?: string[];
  predecessors?: any[];
  successors?: any[];
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
    mnemonic: t.mnemonic ?? null,
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
      isInternal: !!c.isInternal,
      createdAt: toISO(c.createdAt) ?? '',
      author: c.author ? { id: c.author.id, name: c.author.name } : null,
    })) : [],
    history: Array.isArray(t.history) ? t.history.map((h) => ({
      id: h.id,
      field: h.field,
      oldValue: h.oldValue,
      newValue: h.newValue,
      createdAt: toISO(h.createdAt) ?? '',
      user: h.user ? { id: h.user.id, name: h.user.name } : null,
    })) : [],
    attachments: Array.isArray(t.attachments) ? t.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      url: a.url,
      size: a.size,
      createdAt: toISO(a.createdAt) ?? '',
      user: a.user ? { id: a.user.id, name: a.user.name } : null,
    })) : [],
    predecessors: Array.isArray(t.predecessors) ? t.predecessors : [],
    successors: Array.isArray(t.successors) ? t.successors : [],
  };
}
