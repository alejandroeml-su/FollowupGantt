'use client'

/**
 * Equipo D3 · Onboarding · Step 1 — Crear Workspace.
 *
 * Form controlado: name + slug (auto-derived). El slug se puede editar
 * manualmente. Valida formato local antes de delegar al server.
 */

import { useState } from 'react'

export type WorkspaceFormResult = { id: string; slug: string }

type Props = {
  onComplete: (result: WorkspaceFormResult) => void
  /** Inyectable para tests. */
  onSubmit?: (input: {
    name: string
    slug: string
  }) => Promise<WorkspaceFormResult>
}

function deriveSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
}

export function OnboardingStepCreateWorkspace({ onComplete, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveSlug = slugTouched ? slug : deriveSlug(name)
  const canSubmit = name.trim().length > 0 && effectiveSlug.length >= 3

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      if (!onSubmit) {
        throw new Error(
          'OnboardingStepCreateWorkspace requiere onSubmit (no hay binding del server)',
        )
      }
      const result = await onSubmit({ name: name.trim(), slug: effectiveSlug })
      onComplete(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      data-testid="onboarding-step-workspace"
    >
      <div>
        <label
          htmlFor="ws-name"
          className="block text-sm font-semibold text-foreground"
        >
          Nombre del workspace
        </label>
        <input
          id="ws-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          placeholder="Ej. Avante Transformación"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          data-testid="onboarding-ws-name"
        />
      </div>
      <div>
        <label
          htmlFor="ws-slug"
          className="block text-sm font-semibold text-foreground"
        >
          Slug (URL)
        </label>
        <input
          id="ws-slug"
          type="text"
          value={effectiveSlug}
          onChange={(e) => {
            setSlug(e.target.value)
            setSlugTouched(true)
          }}
          required
          minLength={3}
          maxLength={40}
          placeholder="avante-transformacion"
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
          data-testid="onboarding-ws-slug"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Lower-case, números y guiones. Mínimo 3 caracteres.
        </p>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-500"
          data-testid="onboarding-ws-error"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        data-testid="onboarding-ws-submit"
      >
        {submitting ? 'Creando…' : 'Crear workspace'}
      </button>
    </form>
  )
}
