'use client';

import { updateTaskStatus } from '@/lib/actions';

const statuses = [
  { value: 'TODO', label: 'To Do', color: 'bg-slate-400' },
  { value: 'IN_PROGRESS', label: 'In Progress', color: 'bg-indigo-500' },
  { value: 'REVIEW', label: 'Review', color: 'bg-amber-500' },
  { value: 'DONE', label: 'Done', color: 'bg-emerald-500' },
];

export default function StatusSelector({ taskId, currentStatus }: { taskId: string; currentStatus: string }) {
  const current = statuses.find(s => s.value === currentStatus) || statuses[0];

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    await updateTaskStatus(taskId, e.target.value);
  };

  return (
    <div className="flex items-center gap-1.5">
      <div className={`h-2 w-2 rounded-full ${current.color}`} />
      <select
        defaultValue={currentStatus}
        onChange={handleChange}
        className="bg-transparent text-xs font-medium cursor-pointer text-foreground/90 focus:outline-none hover:text-white"
      >
        {statuses.map(s => (
          <option key={s.value} value={s.value} className="bg-card text-foreground">
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
