'use client'

/**
 * Ola P2 · Equipo P2-3 — Form de creación de Template.
 *
 * Cliente que invoca `createTemplate` directamente. No hace fetching de
 * proyectos; el campo projectId acepta cualquier UUID válido o null
 * (template global). Validaciones server-side bloquean inputs malformados.
 */

import { useState, useTransition } from 'react'
import type { TaskTemplate } from '@prisma/client'
import { createTemplate } from '@/lib/actions/templates'

type FormState = {
  name: string
  description: string
  projectId: string
  isShared: boolean
  // taskShape
  title: string
  type: 'AGILE_STORY' | 'PMI_TASK' | 'ITIL_TICKET'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  durationDays: string
  isMilestone: boolean
  tags: string
}

const INITIAL: FormState = {
  name: '',
  description: '',
  projectId: '',
  isShared: false,
  title: '',
  type: 'AGILE_STORY',
  priority: 'MEDIUM',
  durationDays: '',
  isMilestone: false,
  tags: '',
}

export function TemplateForm({
  onCreated,
  onError,
}: {
  onCreated: (template: TaskTemplate) => void
  onError: (message: string) => void
}) {
  const [state, setState] = useState<FormState>(INITIAL)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    startTransition(async () => {
      try {
        const tags = state.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)

        const created = await createTemplate({
          name: state.name,
          description: state.description || null,
          projectId: state.projectId || null,
          isShared: state.isShared,
          taskShape: {
            title: state.title,
            description: null,
            type: state.type,
            priority: state.priority,
            durationDays: state.durationDays
              ? Number.parseInt(state.durationDays, 10)
              : undefined,
            isMilestone: state.isMilestone,
            tags,
            referenceUrl: null,
          },
        })
        onCreated(created)
        setState(INITIAL)
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="template-form">
      <div>
        <label className="block text-sm font-medium mb-1">Nombre del template</label>
        <input
          type="text"
          required
          value={state.name}
          onChange={(e) => setState({ ...state, name: e.target.value })}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          data-testid="template-form-name"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Descripción</label>
        <textarea
          value={state.description}
          onChange={(e) => setState({ ...state, description: e.target.value })}
          className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          rows={2}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">Project ID (opcional)</label>
          <input
            type="text"
            value={state.projectId}
            onChange={(e) => setState({ ...state, projectId: e.target.value })}
            placeholder="Dejar vacío = global"
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex items-end">
          <label className="flex items-center text-sm">
            <input
              type="checkbox"
              checked={state.isShared}
              onChange={(e) => setState({ ...state, isShared: e.target.checked })}
              className="mr-2"
            />
            Compartido
          </label>
        </div>
      </div>

      <fieldset className="border border-gray-200 rounded p-3">
        <legend className="text-sm font-semibold px-1">Snapshot del task</legend>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Título</label>
            <input
              type="text"
              required
              value={state.title}
              onChange={(e) => setState({ ...state, title: e.target.value })}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              data-testid="template-form-title"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Tipo</label>
              <select
                value={state.type}
                onChange={(e) =>
                  setState({ ...state, type: e.target.value as FormState['type'] })
                }
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              >
                <option value="AGILE_STORY">AGILE_STORY</option>
                <option value="PMI_TASK">PMI_TASK</option>
                <option value="ITIL_TICKET">ITIL_TICKET</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Prioridad</label>
              <select
                value={state.priority}
                onChange={(e) =>
                  setState({ ...state, priority: e.target.value as FormState['priority'] })
                }
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              >
                <option value="LOW">LOW</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HIGH">HIGH</option>
                <option value="CRITICAL">CRITICAL</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Duración (días)</label>
              <input
                type="number"
                min="0"
                value={state.durationDays}
                onChange={(e) => setState({ ...state, durationDays: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center text-sm">
              <input
                type="checkbox"
                checked={state.isMilestone}
                onChange={(e) =>
                  setState({ ...state, isMilestone: e.target.checked })
                }
                className="mr-2"
              />
              Es hito
            </label>
            <input
              type="text"
              value={state.tags}
              onChange={(e) => setState({ ...state, tags: e.target.value })}
              placeholder="Tags (separadas por coma)"
              className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
            />
          </div>
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          data-testid="template-form-submit"
        >
          {isPending ? 'Guardando…' : 'Guardar template'}
        </button>
      </div>
    </form>
  )
}
