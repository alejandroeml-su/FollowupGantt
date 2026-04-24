'use client';

import { useState, type ReactNode } from 'react';
import TaskDetailModal from './TaskDetailModal';

/**
 * Wraps any task element to make it clickable and open the TaskDetailModal.
 * Accepts serialized task data (JSON-safe) from server components.
 * 
 * Use `as="tr"` for table rows to render a <tr> instead of a <div>.
 */
interface TaskData {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  type: string;
  progress: number;
  endDate?: string | null;
  assignee?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
  subtasks?: { id: string; title: string; status: string; assignee?: { name: string } | null }[];
  comments?: {
    id: string;
    content: string;
    createdAt: string;
    author?: { id: string; name: string } | null;
  }[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface TaskClickableProps {
  task: TaskData;
  children: ReactNode;
  className?: string;
  as?: 'div' | 'tr';
}

export default function TaskClickable({ task, children, className, as = 'div' }: TaskClickableProps) {
  const [open, setOpen] = useState(false);

  const Wrapper = as;

  return (
    <>
      <Wrapper
        onClick={() => setOpen(true)}
        className={`cursor-pointer ${className || ''}`}
        role="button"
        tabIndex={0}
        onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter') setOpen(true); }}
      >
        {children}
      </Wrapper>

      {open && (
        <TaskDetailModal task={task} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
