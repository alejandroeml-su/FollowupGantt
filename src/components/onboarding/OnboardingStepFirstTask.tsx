'use client'

/**
 * Equipo D3 · Onboarding · Step 4 — Crear primera tarea.
 *
 * Form: title + assigneeId opcional (free text → el server resuelve la
 * existencia del usuario). En el MVP el campo se deja vacío para no
 * sobrecargar al usuario nuevo; cuando ya haya miembros invitados el
 * autocomplete se conecta en una iteración futura.
 */

import { useState } from 'react'

type Props = {
  projectId: string
  onComplete: () => void
  /** Inyectable para tests. */
  onSubmit?: (input: {
    projectId: string
    title: string
    assigneeId?: string
  }) => Promise<void>
}

export function OnboardingStepFirstTask({
  projectId,
  onComplete,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = title.trim().length > 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (!onSubmit) throw new Error('onSubmit no provisto')
      await onSubmit({
        projectId,
        title: title.trim(),
        assigneeId: assigneeId.trim() || undefined,
      })
      onComplete()
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
      data-testid="onboarding-step-task"
    >
      <div>
        <label
          htmlFor="task-title"
          className="block text-sm font-semibold text-foreground"
        >
          Título de la tarea
        </label>
        <input
          id="task-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          placeholder="Ej. Levantar requerimientos iniciales"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid="onboarding-task-title"
        />
      </div>
      <div>
        <label
          htmlFor="task-assignee"
          className="block text-sm font-semibold text-foreground"
        >
          Asignado a (opcional, ID del usuario)
        </label>
        <input
          id="task-assignee"
          type="text"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          placeholder="Déjalo vacío si aún no tienes equipo"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
          data-testid="onboarding-task-assignee"
        />
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500"
          data-testid="onboarding-task-error"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        data-testid="onboarding-task-submit"
      >
        {submitting ? 'Creando…' : 'Crear primera tarea'}
      </button>
    </form>
  )
}
