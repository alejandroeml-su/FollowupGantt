'use client';

import { Trash2 } from 'lucide-react';
import { deleteTask } from '@/lib/actions';

export default function DeleteButton({ taskId }: { taskId: string }) {
  return (
    <form action={deleteTask}>
      <input type="hidden" name="id" value={taskId} />
      <button 
        type="submit"
        className="p-1 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
        title="Eliminar tarea"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </form>
  );
}
