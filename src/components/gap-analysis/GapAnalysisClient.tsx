'use client'

/**
 * US-9.2 · Wave R5 — Lista interactiva de Gap Analysis.
 *
 * Filtra por proyecto y por estado (DRAFT/IN_PROGRESS/COMPLETED) en
 * cliente. Abre modal "Nuevo análisis" que llama a `createGapAnalysis`
 * y navega al detalle.
 */

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { Plus, Search, AlertCircle } from 'lucide-react'

import { createGapAnalysis } from '@/lib/actions/gap-analysis'
import type {
  GapAnalysisStatus,
  SerializedGapAnalysis,
} from '@/lib/gap-analysis/types'

type Props = {
  items: SerializedGapAnalysis[]
  projects: Array<{ id: string; name: string }>
  initialProjectId: string | null
}

const STATUS_OPTIONS: Array<{ key: GapAnalysisStatus | 'ALL'; label: string }> = [
  { key: 'ALL', label: 'Todos' },
  { key: 'DRAFT', label: 'Borrador' },
  { key: 'IN_PROGRESS', label: 'En progreso' },
  { key: 'COMPLETED', label: 'Completado' },
]

export default function GapAnalysisClient({
  items,
  projects,
  initialProjectId,
}: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    GapAnalysisStatus | 'ALL'
  >('ALL')
  const [projectFilter, setProjectFilter] = useState<string>(
    initialProjectId ?? 'ALL',
  )
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Form state del modal de creación
  const [formName, setFormName] = useState('')
  const [formProjectId, setFormProjectId] = useState<string>(
    initialProjectId ?? projects[0]?.id ?? '',
  )
  const [formDescription, setFormDescription] = useState('')
  const [formTargetDate, setFormTargetDate] = useState('')

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (statusFilter !== 'ALL' && it.status !== statusFilter) return false
      if (projectFilter !== 'ALL' && it.projectId !== projectFilter) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        if (
          !it.name.toLowerCase().includes(q) &&
          !(it.description ?? '').toLowerCase().includes(q) &&
          !(it.projectName ?? '').toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }, [items, statusFilter, projectFilter, search])

  function openCreate() {
    setFormName('')
    setFormDescription('')
    setFormTargetDate('')
    setFormProjectId(projectFilter !== 'ALL' ? projectFilter : projects[0]?.id ?? '')
    setError(null)
    setCreating(true)
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!formProjectId) {
      setError('Selecciona un proyecto')
      return
    }
    if (!formName.trim()) {
      setError('Indica un nombre para el análisis')
      return
    }
    startTransition(async () => {
      try {
        const created = await createGapAnalysis({
          projectId: formProjectId,
          name: formName.trim(),
          description: formDescription.trim() || null,
          targetDate: formTargetDate || null,
        })
        setCreating(false)
        router.push(`/gap-analysis/${created.id}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
      }
    })
  }

  return (
    <div className="space-y-3">
      {/* Filtros + acciones */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <label className="relative">
            <Search
              className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar análisis…"
              aria-label="Buscar análisis"
              className="h-8 w-56 rounded border bg-background pl-7 pr-2 text-sm"
            />
          </label>

          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            aria-label="Filtrar por proyecto"
            className="h-8 rounded border bg-background px-2 text-sm"
          >
            <option value="ALL">Todos los proyectos</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as GapAnalysisStatus | 'ALL')
            }
            aria-label="Filtrar por estado"
            className="h-8 rounded border bg-background px-2 text-sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-8 items-center gap-1 rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Nuevo análisis
        </button>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="rounded border border-dashed p-6 text-center text-xs text-muted-foreground">
          Sin análisis para los filtros aplicados.
        </div>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {filtered.map((it) => (
            <li key={it.id}>
              <Link
                href={`/gap-analysis/${it.id}`}
                className="block rounded-lg border bg-card p-3 transition hover:border-primary"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold">{it.name}</h3>
                  <span
                    className="rounded-full border px-2 py-0.5 text-[10px] uppercase text-muted-foreground"
                    title={`Estado: ${it.status}`}
                  >
                    {it.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {it.description ?? 'Sin descripción'}
                </p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div>
                    <dt className="text-muted-foreground">Proyecto</dt>
                    <dd className="truncate font-medium">
                      {it.projectName ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Dimensiones</dt>
                    <dd>{it.dimensions.length}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Score</dt>
                    <dd>
                      {it.overallScore != null
                        ? `${it.overallScore.toFixed(0)}%`
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Modal · Nuevo análisis */}
      {creating && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="gap-create-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreating(false)
          }}
        >
          <form
            onSubmit={handleCreate}
            className="w-full max-w-md space-y-3 rounded-lg border bg-card p-4 shadow-lg"
          >
            <h2 id="gap-create-title" className="text-sm font-semibold">
              Nuevo Gap Analysis
            </h2>

            <label className="block">
              <span className="text-xs text-muted-foreground">Proyecto</span>
              <select
                value={formProjectId}
                onChange={(e) => setFormProjectId(e.target.value)}
                required
                className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
              >
                <option value="">Selecciona…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Nombre</span>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                maxLength={200}
                placeholder="Ej. Diagnóstico de madurez ITIL"
                className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">
                Descripción (opcional)
              </span>
              <textarea
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                rows={3}
                maxLength={2000}
                className="mt-1 block w-full rounded border bg-background p-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">
                Fecha objetivo (opcional)
              </span>
              <input
                type="date"
                value={formTargetDate}
                onChange={(e) => setFormTargetDate(e.target.value)}
                className="mt-1 block h-8 w-full rounded border bg-background px-2 text-sm"
              />
            </label>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-1 rounded border border-destructive/60 bg-destructive/10 p-2 text-xs text-destructive"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5" aria-hidden />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="h-8 rounded border px-3 text-xs"
                disabled={isPending}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="h-8 rounded bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60"
              >
                {isPending ? 'Creando…' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
