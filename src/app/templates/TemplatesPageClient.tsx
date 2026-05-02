'use client'

/**
 * Ola P2 · Equipo P2-3 — Cliente de la página /templates.
 *
 * Lista los templates accesibles, permite crear/eliminar y abre el
 * dialog de Recurrencia y de Instanciación.
 */

import { useState, useTransition } from 'react'
import { TemplateForm } from '@/components/templates/TemplateForm'
import { RecurrenceDialog } from '@/components/recurrence/RecurrenceDialog'
import { deleteTemplate } from '@/lib/actions/templates'

type TemplateRow = {
  id: string
  name: string
  description: string | null
  projectId: string | null
  isShared: boolean
  taskShape: Record<string, unknown>
  createdAt: string
}

export function TemplatesPageClient({
  initialTemplates,
}: {
  initialTemplates: TemplateRow[]
}) {
  const [templates, setTemplates] = useState<TemplateRow[]>(initialTemplates)
  const [showForm, setShowForm] = useState(false)
  const [recurrenceFor, setRecurrenceFor] = useState<TemplateRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleDelete = (id: string) => {
    if (!confirm('¿Eliminar este template? Esta acción no se puede deshacer.')) return
    startTransition(async () => {
      try {
        await deleteTemplate(id)
        setTemplates((prev) => prev.filter((t) => t.id !== id))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <div className="p-6 max-w-5xl mx-auto" data-testid="templates-page">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="text-sm text-gray-500">
            Plantillas reutilizables y tareas recurrentes
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm hover:bg-blue-700"
          data-testid="templates-create-btn"
        >
          {showForm ? 'Cerrar' : 'Crear template'}
        </button>
      </header>

      {error && (
        <div
          className="mb-4 p-3 border border-red-300 bg-red-50 text-red-800 rounded text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {showForm && (
        <div className="mb-6 border border-gray-200 rounded-lg p-4 bg-white">
          <TemplateForm
            onCreated={(t) => {
              setTemplates((prev) => [
                {
                  id: t.id,
                  name: t.name,
                  description: t.description,
                  projectId: t.projectId,
                  isShared: t.isShared,
                  taskShape: t.taskShape as Record<string, unknown>,
                  createdAt: new Date(t.createdAt).toISOString(),
                },
                ...prev,
              ])
              setShowForm(false)
            }}
            onError={(msg) => setError(msg)}
          />
        </div>
      )}

      <ul className="space-y-2" data-testid="templates-list">
        {templates.length === 0 && (
          <li className="text-sm text-gray-500 italic">
            Aún no hay templates. Crea el primero con el botón superior.
          </li>
        )}
        {templates.map((t) => {
          const shape = t.taskShape as { title?: string; type?: string; priority?: string }
          return (
            <li
              key={t.id}
              className="border border-gray-200 rounded-lg p-3 flex items-center justify-between hover:bg-gray-50"
              data-testid={`template-row-${t.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{t.name}</div>
                <div className="text-xs text-gray-500 truncate">
                  {shape.title ?? '—'} · {shape.type ?? 'AGILE_STORY'} ·{' '}
                  {shape.priority ?? 'MEDIUM'}
                  {t.isShared ? ' · compartido' : ''}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  type="button"
                  onClick={() => setRecurrenceFor(t)}
                  className="text-sm px-3 py-1 border border-gray-300 rounded hover:bg-gray-100"
                  data-testid={`template-recurrence-btn-${t.id}`}
                >
                  Recurrencia
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(t.id)}
                  disabled={isPending}
                  className="text-sm px-3 py-1 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
                >
                  Eliminar
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {recurrenceFor && (
        <RecurrenceDialog
          templateId={recurrenceFor.id}
          templateName={recurrenceFor.name}
          onClose={() => setRecurrenceFor(null)}
        />
      )}
    </div>
  )
}
