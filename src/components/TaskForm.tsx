'use client';

import { useState } from 'react';
import { Plus, ChevronUp } from 'lucide-react';
import { createTask } from '@/lib/actions';

interface TaskFormProps {
  projects: { id: string; name: string }[];
  users: { id: string; name: string }[];
}

export default function TaskForm({ projects, users }: TaskFormProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="px-6 pt-4 pb-2">
      <button 
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 transition-colors mb-3"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {open ? 'Cerrar Formulario' : 'Nueva Tarea'}
      </button>

      {open && (
        <form 
          action={createTask}
          className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-900 border border-slate-800 rounded-xl p-5 mb-4"
        >
          {/* Título */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1">Título *</label>
            <input 
              name="title" 
              required 
              placeholder="Ej: Implementar login con Supabase Auth"
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Proyecto */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Proyecto *</label>
            <select 
              name="projectId" 
              required
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Seleccionar...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Prioridad */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Prioridad</label>
            <select 
              name="priority"
              defaultValue="MEDIUM"
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Tipo</label>
            <select 
              name="type"
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="AGILE_STORY">Agile Story</option>
              <option value="PMI_TASK">PMI Task</option>
              <option value="ITIL_TICKET">ITIL Ticket</option>
            </select>
          </div>

          {/* Asignado */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Asignado</label>
            <select 
              name="assigneeId"
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Sin Asignar</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Fecha Límite */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Fecha Límite</label>
            <input 
              name="endDate" 
              type="date"
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Descripción */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-400 mb-1">Descripción</label>
            <input 
              name="description" 
              placeholder="Descripción opcional..."
              className="w-full rounded-md border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Submit */}
          <div className="flex items-end">
            <button 
              type="submit"
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
            >
              Crear Tarea
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
