'use client';

import { useState } from 'react';
import { Plus, ChevronUp } from 'lucide-react';
import { createTask } from '@/lib/actions';
import StoryPointsField from '@/components/sprints/StoryPointsField';
import { HardDeadlineField } from '@/components/tasks/HardDeadlineField';
import { DailyEffortField } from '@/components/tasks/DailyEffortField';
import {
  CustomFieldsSection,
  type CustomFieldsValueMap,
} from '@/components/tasks/CustomFieldsSection';
import { GitHubLinkField } from '@/components/integrations/GitHubLinkField';

interface TaskFormProps {
  projects: { id: string; name: string }[];
  users: { id: string; name: string }[];
}

/**
 * Equipo D2 — Form simple de creación de tarea (modo minimal). Extiende
 * la versión original para exponer:
 *   - `hardDeadline` (Ola P5)
 *   - `dailyEffortHours` (Ola P5)
 *   - Campos personalizados del proyecto (Ola P1, modo `pending` —
 *     se acumulan en estado y se envían como JSON en `customFieldValues`).
 *   - Vínculo GitHub (Ola P4-5, modo `pending` — sólo se reporta al padre
 *     como referencia textual `githubReference`; la persistencia ocurre
 *     después de crear la tarea cuando el server action soporte el flag).
 *
 * NOTA: El server action `createTask` aún no lee `hardDeadline` /
 * `dailyEffortHours` / `customFieldValues` / `githubReference`. Los campos
 * se exponen aquí — la persistencia llega cuando el equipo de actions
 * descomente la rama de validación zod correspondiente.
 */
export default function TaskForm({ projects, users }: TaskFormProps) {
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [hardDeadline, setHardDeadline] = useState('');
  const [dailyEffortHours, setDailyEffortHours] = useState('');
  const [customValues, setCustomValues] = useState<CustomFieldsValueMap>({});
  const [pendingGithubRef, setPendingGithubRef] = useState<string | null>(null);

  return (
    <div className="px-6 pt-4 pb-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-400 transition-colors mb-3"
      >
        {open ? <ChevronUp className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
        {open ? 'Cerrar Formulario' : 'Nueva Tarea'}
      </button>

      {open && (
        <form
          action={createTask}
          className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-card border border-border rounded-xl p-5 mb-4"
        >
          {/* Título */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Título *</label>
            <input
              name="title"
              required
              placeholder="Ej: Implementar login con Supabase Auth"
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Proyecto */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Proyecto *</label>
            <select
              name="projectId"
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Seleccionar...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Prioridad */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Prioridad</label>
            <select
              name="priority"
              defaultValue="MEDIUM"
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </div>

          {/* Tipo */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Tipo</label>
            <select
              name="type"
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="AGILE_STORY">Agile Story</option>
              <option value="PMI_TASK">PMI Task</option>
              <option value="ITIL_TICKET">ITIL Ticket</option>
            </select>
          </div>

          {/* Asignado */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Asignado</label>
            <select
              name="assigneeId"
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Sin Asignar</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Fechas */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Fecha Inicio</label>
            <input
              name="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Fecha Final</label>
            <input
              name="endDate"
              type="date"
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Story Points (Fibonacci) */}
          <StoryPointsField />

          {/* Vencimiento forzoso (P5) */}
          <div>
            <HardDeadlineField
              value={hardDeadline}
              onChange={setHardDeadline}
              startDate={startDate}
            />
          </div>

          {/* Esfuerzo diario (P5) */}
          <div>
            <DailyEffortField
              value={dailyEffortHours}
              onChange={setDailyEffortHours}
            />
          </div>

          {/* Descripción */}
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Descripción</label>
            <input
              name="description"
              placeholder="Descripción opcional..."
              className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {/* Campos personalizados — sólo cuando hay proyecto seleccionado */}
          {projectId && (
            <div className="md:col-span-3">
              <CustomFieldsSection
                projectId={projectId}
                mode="pending"
                onValuesChange={setCustomValues}
              />
              {/* Snapshot serializado de los valores pendientes para que el
                  server action pueda leerlos cuando soporte el campo. */}
              <input
                type="hidden"
                name="customFieldValues"
                value={
                  Object.keys(customValues).length > 0
                    ? JSON.stringify(customValues)
                    : ''
                }
              />
            </div>
          )}

          {/* Vínculo GitHub (modo pending — sólo notifica al padre). */}
          <div className="md:col-span-3">
            <GitHubLinkField
              taskId={null}
              onPendingChange={setPendingGithubRef}
            />
            <input
              type="hidden"
              name="githubReference"
              value={pendingGithubRef ?? ''}
            />
          </div>

          {/* Submit */}
          <div className="flex items-end md:col-span-3 justify-end">
            <button
              type="submit"
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
            >
              Crear Tarea
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
