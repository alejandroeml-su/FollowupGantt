'use client';

import { useState } from 'react';
import {
  ChevronDown,
  Calendar,
  Flag,
  UserCircle2,
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import DeleteButton from '@/components/DeleteButton';
import StatusSelector from '@/components/StatusSelector';
import TaskDetailModal from '@/components/TaskDetailModal';

const statusConfig: Record<string, { color: string; label: string }> = {
  TODO: { color: 'text-slate-400', label: 'To Do' },
  IN_PROGRESS: { color: 'text-indigo-400', label: 'In Progress' },
  DONE: { color: 'text-emerald-400', label: 'Done' },
  REVIEW: { color: 'text-amber-400', label: 'Review' },
};

const priorityConfig: Record<string, { color: string }> = {
  LOW: { color: 'text-slate-400' },
  MEDIUM: { color: 'text-blue-400' },
  HIGH: { color: 'text-amber-400' },
  CRITICAL: { color: 'text-red-400' },
};
import type { SerializedTask } from '@/lib/types';

export default function ListTaskRow({ task, level }: { task: SerializedTask; level: number }) {
  const [modalOpen, setModalOpen] = useState(false);

  const assigneeName = task.assignee?.name || 'Sin Asignar';
  const priorityColor = priorityConfig[task.priority]?.color || 'text-slate-400';
  const statusColor = statusConfig[task.status]?.color || 'text-slate-400';
  const commentCount = task.comments?.length || 0;

  let dateStr = 'Sin fecha';
  if (task.endDate) {
    try { dateStr = new Date(task.endDate).toLocaleDateString(); } catch {}
  }

  return (
    <>
      <div
        onClick={() => setModalOpen(true)}
        className="grid grid-cols-12 gap-4 items-center px-4 py-2.5 text-sm border-l-2 border-transparent hover:border-indigo-500 hover:bg-slate-800/50 transition-all group cursor-pointer"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') setModalOpen(true); }}
      >
        {/* Title */}
        <div className="col-span-4 flex items-center" style={{ paddingLeft: `${level * 1.5}rem` }}>
          {(task.subtasks?.length ?? 0) > 0 ? (
            <ChevronDown className="h-4 w-4 text-slate-500 mr-2" />
          ) : (
            <div className="w-6" />
          )}
          <span className={`h-4 w-4 mr-2 ${statusColor}`}>
            {task.status === 'DONE' ? <CheckCircle2 className="h-4 w-4" /> : 
             task.status === 'IN_PROGRESS' ? <Clock className="h-4 w-4" /> : 
             <Circle className="h-4 w-4" />}
          </span>
          <span className="text-slate-200 truncate font-medium group-hover:text-indigo-300 transition-colors">
            {task.title}
          </span>
          {commentCount > 0 && (
            <span className="ml-2 flex items-center gap-0.5 text-[10px] text-slate-500">
              <MessageSquare className="h-3 w-3" /> {commentCount}
            </span>
          )}
        </div>

        {/* Assignee */}
        <div className="col-span-2 flex items-center">
          <UserCircle2 className="h-4 w-4 text-slate-400 mr-2" />
          <span className="text-xs text-slate-300 truncate">{assigneeName}</span>
        </div>

        {/* Status */}
        <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
          <StatusSelector taskId={task.id} currentStatus={task.status} />
        </div>

        {/* Due Date */}
        <div className="col-span-2 flex items-center text-xs text-slate-400">
          <Calendar className="h-3.5 w-3.5 mr-2" />
          {dateStr}
        </div>

        {/* Priority */}
        <div className="col-span-1 flex justify-center">
          {task.priority === 'CRITICAL' ? (
            <AlertCircle className={`h-4 w-4 ${priorityColor}`} />
          ) : (
            <Flag className={`h-4 w-4 ${priorityColor}`} />
          )}
        </div>

        {/* Actions */}
        <div className="col-span-1 flex justify-center" onClick={(e) => e.stopPropagation()}>
          <DeleteButton taskId={task.id} />
        </div>
      </div>

      {modalOpen && (
        <TaskDetailModal task={task} onClose={() => setModalOpen(false)} />
      )}
    </>
  );
}
