'use client'

/**
 * Equipo D3 · Onboarding · Step 3 — Crear primer proyecto.
 *
 * Form simple (name + descripción). La server action `createProject`
 * existente recibe FormData; aquí construimos el FormData manualmente
 * para no tocar su contrato. Tras el create, resolvemos el id del
 * proyecto vía `findFirstProjectIdByName` (action de onboarding).
 */

import { useState } from 'react'

export type ProjectFormResult = { id: string; name: string }

type Props = {
  onComplete: (result: ProjectFormResult) => void
  /** Inyectable para tests. */
  onSubmit?: (input: {
    name: string
    description: string
  }) => Promise<ProjectFormResult>
}

export function OnboardingStepFirstProject({ onComplete, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim().length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (!onSubmit) throw new Error('onSubmit no provisto')
      const result = await onSubmit({
        name: name.trim(),
        description: description.trim(),
      })
      onComplete(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="onboarding-step-project"
    >
      <div>
        <label
          htmlFor="project-name"
          className="block text-sm font-semibold text-foreground"
        >
          Nombre del proyecto
        </label>
        <input
          id="project-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          placeholder="Ej. Implementación SAP"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid="onboarding-project-name"
        />
      </div>
      <div>
        <label
          htmlFor="project-description"
          className="block text-sm font-semibold text-foreground"
        >
          Descripción (opcional)
        </label>
        <textarea
          id="project-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid="onboarding-project-description"
        />
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500"
          data-testid="onboarding-project-error"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        data-testid="onboarding-project-submit"
      >
        {submitting ? 'Creando…' : 'Crear proyecto'}
      </button>
    </form>
  )
}
