'use client'

/**
 * Ola P2 · Equipo P2-3 — Botón "Crear desde template".
 *
 * Renderiza un dropdown con templates accesibles (cargados al hacer
 * click) y delega en `instantiateFromTemplate` para materializar una
 * task nueva en el proyecto activo.
 */

import { useState, useTransition } from 'react'
import { instantiateFromTemplate, listTemplates } from '@/lib/actions/templates'

type TemplateOption = {
  id: string
  name: string
}

export function InstantiateFromTemplateButton({
  projectId,
  onCreated,
}: {
  projectId: string
  onCreated?: (taskId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<TemplateOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleOpen = async () => {
    setError(null)
    setOpen((v) => !v)
    if (open) return
    setLoading(true)
    try {
      const list = await listTemplates({ projectId, includeGlobal: true })
      setOptions(list.map((t) => ({ id: t.id, name: t.name })))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handlePick = (templateId: string) => {
    startTransition(async () => {
      try {
        const res = await instantiateFromTemplate({ templateId, projectId })
        setOpen(false)
        onCreated?.(res.taskId)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <div className="relative inline-block" data-testid="instantiate-template-btn">
      <button
        type="button"
        onClick={handleOpen}
        className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
        disabled={isPending}
      >
        Crear desde template
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white border border-gray-200 rounded shadow-lg z-10">
          {loading && <div className="p-2 text-sm text-gray-500">Cargando…</div>}
          {error && (
            <div className="p-2 text-xs text-red-700" role="alert">
              {error}
            </div>
          )}
          {!loading && options.length === 0 && !error && (
            <div className="p-2 text-sm text-gray-500 italic">
              Sin templates disponibles
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto">
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => handlePick(o.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                >
                  {o.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
