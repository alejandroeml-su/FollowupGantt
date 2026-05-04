'use client'

/**
 * Ola P4 · Equipo P4-1 — Form para crear un workspace nuevo desde
 * `/settings/workspace`. Tras crear, hace `router.refresh()` para que la
 * tabla de espacios se rehidrate.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { WorkspacePlan } from '@prisma/client'
import { createWorkspace, switchWorkspace } from '@/lib/actions/workspaces'
import { useUIStore } from '@/lib/stores/ui'

const PLANS: WorkspacePlan[] = ['FREE', 'PRO', 'ENTERPRISE']

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 40)
}

export function CreateWorkspaceForm() {
  const router = useRouter()
  const setActiveWorkspaceId = useUIStore((s) => s.setActiveWorkspaceId)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [plan, setPlan] = useState<WorkspacePlan>('FREE')
  const [touchedSlug, setTouchedSlug] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleNameChange = (v: string) => {
    setName(v)
    if (!touchedSlug) setSlug(deriveSlug(v))
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const created = await createWorkspace({
          name: name.trim(),
          slug: slug.trim(),
          plan,
        })
        // Activamos el WS recién creado.
        await switchWorkspace({ workspaceId: created.id })
        setActiveWorkspaceId(created.id)
        setName('')
        setSlug('')
        setTouchedSlug(false)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error creando workspace')
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-card p-5 space-y-4"
    >
      <div>
        <h2 className="text-base font-semibold text-foreground">
          Crear espacio de trabajo
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Cada espacio aísla proyectos, plantillas y miembros.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <label
            htmlFor="ws-name"
            className="text-xs font-medium text-foreground"
          >
            Nombre
          </label>
          <input
            id="ws-name"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Avante Digital"
            required
            maxLength={80}
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="space-y-1">
          <label
            htmlFor="ws-slug"
            className="text-xs font-medium text-foreground"
          >
            Slug
          </label>
          <input
            id="ws-slug"
            value={slug}
            onChange={(e) => {
              setTouchedSlug(true)
              setSlug(e.target.value.toLowerCase())
            }}
            placeholder="avante-digital"
            required
            minLength={3}
            maxLength={40}
            pattern="^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"
            className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary font-mono"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="ws-plan" className="text-xs font-medium text-foreground">
          Plan
        </label>
        <select
          id="ws-plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value as WorkspacePlan)}
          className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div
          role="alert"
          className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2"
        >
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending || !name.trim() || !slug.trim()}
          className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? 'Creando…' : 'Crear espacio'}
        </button>
      </div>
    </form>
  )
}
