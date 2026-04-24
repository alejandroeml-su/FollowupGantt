'use client';

import { useState, useTransition } from 'react';
import {
  X, MessageSquare, Calendar, UserCircle2, Flag, Clock,
  CheckCircle2, Circle, AlertCircle, Send, Layers, Tag,
  ChevronRight, FileText
} from 'lucide-react';
import { createComment, getTaskWithDetails } from '@/lib/actions';

// ─── Types ───────────────────────────────────────────────────────

interface TaskBasic {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  type: string;
  progress: number;
  endDate?: string | Date | null;
  assignee?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
}

interface CommentData {
  id: string;
  content: string;
  createdAt: string;
  author?: { id: string; name: string } | null;
}

interface TaskFull extends TaskBasic {
  subtasks?: { id: string; title: string; status: string; assignee?: { name: string } | null }[];
  comments?: CommentData[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

// ─── Configs ─────────────────────────────────────────────────────

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  TODO:        { color: 'text-muted-foreground', bg: 'bg-slate-500/10 border-slate-500/20', label: 'To Do' },
  IN_PROGRESS: { color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/20', label: 'In Progress' },
  REVIEW:      { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', label: 'Review' },
  DONE:        { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Done' },
};

const priorityConfig: Record<string, { color: string; bg: string }> = {
  LOW:      { color: 'text-muted-foreground', bg: 'bg-secondary border-border' },
  MEDIUM:   { color: 'text-blue-300', bg: 'bg-blue-500/15 border-blue-500/40' },
  HIGH:     { color: 'text-amber-300', bg: 'bg-amber-500/15 border-amber-500/40' },
  CRITICAL: { color: 'text-red-300', bg: 'bg-red-500/15 border-red-500/40' },
};

const typeLabels: Record<string, string> = {
  AGILE_STORY: 'Agile Story',
  PMI_TASK: 'PMI Task',
  ITIL_TICKET: 'ITIL Ticket',
};

// ─── Helper ──────────────────────────────────────────────────────

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return 'Sin fecha';
  try {
    return new Date(d).toLocaleDateString('es-GT', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch { return 'Sin fecha'; }
}

function timeAgo(d: string | Date): string {
  const now = new Date();
  const date = new Date(d);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Ahora mismo';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `Hace ${diffHrs}h`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `Hace ${diffDays}d`;
  return formatDate(d);
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// ─── TaskDetailModal ─────────────────────────────────────────────

export default function TaskDetailModal({
  task,
  onClose,
}: {
  task: TaskFull;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<CommentData[]>(task.comments || []);
  const [commentText, setCommentText] = useState('');
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<'detail' | 'comments'>('comments');

  const status = statusConfig[task.status] || statusConfig.TODO;
  const priority = priorityConfig[task.priority] || priorityConfig.MEDIUM;

  const handleSubmitComment = () => {
    if (!commentText.trim()) return;

    startTransition(async () => {
      const fd = new FormData();
      fd.set('content', commentText.trim());
      fd.set('taskId', task.id);
      await createComment(fd);

      // Refresh comments
      const updated = await getTaskWithDetails(task.id);
      if (updated?.comments) {
        setComments(updated.comments.map((c: { id: string; content: string; createdAt: Date; author?: { id: string; name: string } | null }) => ({
          id: c.id,
          content: c.content,
          createdAt: c.createdAt.toISOString(),
          author: c.author,
        })));
      }
      setCommentText('');
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-border/80 rounded-2xl w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────── */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-border">
          <div className="flex-1 min-w-0 pr-4">
            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-2">
              {task.project && (
                <>
                  <Layers className="h-3 w-3" />
                  <span>{task.project.name}</span>
                  <ChevronRight className="h-3 w-3" />
                </>
              )}
              <span className={`${status.color}`}>{status.label}</span>
            </div>
            {/* Title */}
            <h2 className="text-xl font-bold text-white leading-tight">{task.title}</h2>
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${status.bg} ${status.color}`}>
                {task.status === 'DONE' ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                {status.label}
              </span>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${priority.bg} ${priority.color}`}>
                {task.priority === 'CRITICAL' ? <AlertCircle className="h-3 w-3" /> : <Flag className="h-3 w-3" />}
                {task.priority}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-secondary border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Tag className="h-3 w-3" />
                {typeLabels[task.type] || task.type}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-white transition-colors flex-shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Tab bar ─────────────────────────────────────── */}
        <div className="flex border-b border-border px-6">
          <button
            onClick={() => setActiveTab('detail')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'detail'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-muted-foreground hover:text-foreground/90'
            }`}
          >
            <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Detalle</span>
          </button>
          <button
            onClick={() => setActiveTab('comments')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'comments'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-muted-foreground hover:text-foreground/90'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Seguimiento
              {comments.length > 0 && (
                <span className="ml-1 bg-indigo-500/20 text-indigo-400 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                  {comments.length}
                </span>
              )}
            </span>
          </button>
        </div>

        {/* ── Content ─────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'detail' ? (
            <div className="p-6 space-y-5">
              {/* Description */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Descripción</h4>
                <p className="text-sm text-foreground/90 leading-relaxed">
                  {task.description || 'Sin descripción.'}
                </p>
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-secondary/40 rounded-xl p-3.5 border border-border/50">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                    <UserCircle2 className="h-3.5 w-3.5" /> Asignado
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    {task.assignee?.name || 'Sin asignar'}
                  </p>
                </div>
                <div className="bg-secondary/40 rounded-xl p-3.5 border border-border/50">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                    <Calendar className="h-3.5 w-3.5" /> Fecha Límite
                  </div>
                  <p className="text-sm font-medium text-foreground">{formatDate(task.endDate)}</p>
                </div>
              </div>

              {/* Progress */}
              <div className="bg-secondary/40 rounded-xl p-3.5 border border-border/50">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-muted-foreground flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Progreso</span>
                  <span className="font-bold text-foreground">{task.progress}%</span>
                </div>
                <div className="w-full bg-background rounded-full h-2 border border-border/50">
                  <div
                    className="bg-indigo-500 h-2 rounded-full transition-all"
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
              </div>

              {/* Subtasks */}
              {task.subtasks && task.subtasks.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Subtareas ({task.subtasks.length})
                  </h4>
                  <div className="space-y-1.5">
                    {task.subtasks.map(sub => (
                      <div key={sub.id} className="flex items-center gap-2 bg-secondary/30 rounded-lg px-3 py-2 text-sm">
                        <span className={statusConfig[sub.status]?.color || 'text-muted-foreground'}>
                          {sub.status === 'DONE' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                        </span>
                        <span className="text-foreground/90 flex-1 truncate">{sub.title}</span>
                        <span className="text-[11px] text-muted-foreground">{sub.assignee?.name || ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ── Comments / Seguimiento tab ─────────────── */
            <div className="p-6">
              {comments.length === 0 ? (
                <div className="text-center py-10">
                  <MessageSquare className="h-10 w-10 text-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground font-medium">Sin comentarios aún</p>
                  <p className="text-xs text-muted-foreground mt-1">Agrega el primer seguimiento a esta tarea.</p>
                </div>
              ) : (
                <div className="space-y-4 mb-4">
                  {comments.map(comment => (
                    <div key={comment.id} className="flex gap-3">
                      <div className="h-8 w-8 rounded-full bg-indigo-600/80 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 mt-0.5">
                        {comment.author ? getInitials(comment.author.name) : '??'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-foreground">
                            {comment.author?.name || 'Anónimo'}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {timeAgo(comment.createdAt)}
                          </span>
                        </div>
                        <div className="bg-secondary/60 rounded-xl px-4 py-3 border border-border/50">
                          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
                            {comment.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Comment input (always visible) ──────────────── */}
        <div className="border-t border-border p-4 bg-background/95">
          <div className="flex gap-3 items-end">
            <div className="h-8 w-8 rounded-full bg-border flex items-center justify-center text-[10px] font-bold text-muted-foreground flex-shrink-0">
              EM
            </div>
            <div className="flex-1 relative">
              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Escribe un comentario o actualización de seguimiento..."
                rows={2}
                className="w-full rounded-xl border border-border bg-card py-2.5 px-4 pr-12 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-ring/30 transition-all resize-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmitComment();
                  }
                }}
              />
              <button
                onClick={handleSubmitComment}
                disabled={!commentText.trim() || isPending}
                className="absolute right-2.5 bottom-2.5 p-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 ml-11">
            Presiona Enter para enviar, Shift+Enter para nueva línea
          </p>
        </div>
      </div>
    </div>
  );
}
