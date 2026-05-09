'use client'

/**
 * Wave P12 (PMI 100% · HU-12.9) — Lessons Learned repository.
 *
 * Búsqueda full-text + filtro por categoría + grid con cards
 * pliegables. Captura formal con context / what happened / root cause /
 * recommendation (PMBOK 7 · Knowledge Management).
 */

import { useMemo, useState, useTransition } from 'react'
import {
  Award,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Filter,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  createLesson,
  deleteLesson,
  updateLesson,
} from '@/lib/actions/lessons'
import type { LessonCategory, LessonVisibility } from '@prisma/client'
import { toast } from '@/components/interactions/Toaster'

type Lesson = {
  id: string
  title: string
  category: LessonCategory
  context: string
  whatHappened: string
  rootCause: string | null
  recommendation: string
  appliesTo: string | null
  visibility: LessonVisibility
  createdAt: Date | string
  project: { id: string; name: string }
  capturedBy: { id: string; name: string } | null
}

type Props = {
  scope: 'global' | 'project'
  projectId: string | null
  workspaceId: string | null
  projectName?: string
  lessons: Lesson[]
  categoryStats: Record<string, number>
  total: number
  currentUser: { id: string; name: string } | null
  /** Si scope = global, mostramos selector de project para create. */
  selectableProjects: { id: string; name: string }[]
}

const CATEGORY_META: Record<
  LessonCategory,
  { label: string; classes: string }
> = {
  PROCESS: { label: 'Proceso', classes: 'bg-cyan-500/15 text-cyan-200' },
  TECHNICAL: { label: 'Técnico', classes: 'bg-indigo-500/15 text-indigo-200' },
  PEOPLE: { label: 'Equipo', classes: 'bg-violet-500/15 text-violet-200' },
  TOOLS: { label: 'Herramientas', classes: 'bg-amber-500/15 text-amber-200' },
  RISK: { label: 'Riesgo', classes: 'bg-rose-500/15 text-rose-200' },
  QUALITY: { label: 'Calidad', classes: 'bg-emerald-500/15 text-emerald-200' },
  COMMUNICATIONS: {
    label: 'Comunicación',
    classes: 'bg-pink-500/15 text-pink-200',
  },
  OTHER: { label: 'Otro', classes: 'bg-zinc-500/15 text-zinc-200' },
}

const VISIBILITY_META: Record<LessonVisibility, string> = {
  PROJECT: 'Solo proyecto',
  WORKSPACE: 'Workspace',
  ORG: 'Organización',
}

const EMPTY_DRAFT = {
  title: '',
  category: 'PROCESS' as LessonCategory,
  context: '',
  whatHappened: '',
  rootCause: '',
  recommendation: '',
  appliesTo: '',
  visibility: 'WORKSPACE' as LessonVisibility,
  projectId: '',
}

export function LessonsLearnedClient({
  scope,
  projectId,
  projectName,
  lessons,
  categoryStats,
  total,
  currentUser,
  selectableProjects,
}: Props) {
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState<LessonCategory | 'ALL'>('ALL')
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState({
    ...EMPTY_DRAFT,
    projectId: projectId || '',
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const filtered = useMemo(() => {
    const s = search.toLowerCase()
    return lessons
      .filter((l) => filterCat === 'ALL' || l.category === filterCat)
      .filter(
        (l) =>
          !s ||
          l.title.toLowerCase().includes(s) ||
          l.recommendation.toLowerCase().includes(s) ||
          l.whatHappened.toLowerCase().includes(s) ||
          (l.appliesTo?.toLowerCase().includes(s) ?? false),
      )
  }, [lessons, search, filterCat])

  const handleSubmit = () => {
    if (!draft.title.trim() || !draft.recommendation.trim()) {
      toast.error('Title y Recommendation son requeridos')
      return
    }
    const targetProject = scope === 'project' ? projectId! : draft.projectId
    if (!targetProject) {
      toast.error('Selecciona un proyecto')
      return
    }
    startTransition(async () => {
      try {
        if (editingId) {
          await updateLesson({
            id: editingId,
            ...draft,
            actorId: currentUser?.id,
          })
          toast.success('Lesson actualizada')
        } else {
          await createLesson({
            projectId: targetProject,
            title: draft.title,
            category: draft.category,
            context: draft.context,
            whatHappened: draft.whatHappened,
            rootCause: draft.rootCause || undefined,
            recommendation: draft.recommendation,
            appliesTo: draft.appliesTo || undefined,
            visibility: draft.visibility,
            capturedById: currentUser?.id,
          })
          toast.success('Lesson capturada')
        }
        setDraft({ ...EMPTY_DRAFT, projectId: projectId || '' })
        setShowForm(false)
        setEditingId(null)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const startEdit = (l: Lesson) => {
    setEditingId(l.id)
    setDraft({
      title: l.title,
      category: l.category,
      context: l.context,
      whatHappened: l.whatHappened,
      rootCause: l.rootCause ?? '',
      recommendation: l.recommendation,
      appliesTo: l.appliesTo ?? '',
      visibility: l.visibility,
      projectId: l.project.id,
    })
    setShowForm(true)
    if (typeof window !== 'undefined')
      window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = (id: string) => {
    if (!confirm('¿Eliminar esta lesson?')) return
    startTransition(async () => {
      await deleteLesson({ id, actorId: currentUser?.id })
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border bg-gradient-to-br from-amber-500/10 via-card to-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-amber-300">
              <BookOpen className="h-3.5 w-3.5" />
              Lessons Learned · Knowledge Management
            </div>
            <h1 className="mt-1 text-2xl font-bold text-foreground">
              {scope === 'global' ? 'Repositorio centralizado' : projectName}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total} lecciones capturadas · convierte experiencia en activo
              organizacional
            </p>
          </div>
          <button
            onClick={() => {
              setEditingId(null)
              setDraft({ ...EMPTY_DRAFT, projectId: projectId || '' })
              setShowForm((s) => !s)
            }}
            className="inline-flex items-center gap-2 rounded-md bg-amber-500/20 px-3 py-2 text-sm font-medium text-amber-200 hover:bg-amber-500/30"
          >
            <Plus className="h-4 w-4" />
            Capturar lesson
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setFilterCat('ALL')}
            className={`rounded-full px-3 py-1 text-xs ${
              filterCat === 'ALL'
                ? 'bg-amber-500/20 text-amber-200'
                : 'bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            Todas ({total})
          </button>
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const count = categoryStats[key] ?? 0
            return (
              <button
                key={key}
                onClick={() => setFilterCat(key as LessonCategory)}
                className={`rounded-full px-3 py-1 text-xs ${
                  filterCat === key
                    ? meta.classes + ' ring-1 ring-current'
                    : 'bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {meta.label} ({count})
              </button>
            )
          })}
        </div>

        <div className="mt-4 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título, recomendación, contexto..."
            className="w-full rounded-md border border-border bg-background/50 pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </header>

      {showForm && (
        <div className="rounded-xl border border-amber-500/30 bg-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            {editingId ? 'Editar Lesson' : 'Nueva Lesson Learned'}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="text"
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
              placeholder="Título · ej: Mock vs DB en migrations"
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
            <select
              value={draft.category}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  category: e.target.value as LessonCategory,
                }))
              }
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground"
            >
              {Object.entries(CATEGORY_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              value={draft.visibility}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  visibility: e.target.value as LessonVisibility,
                }))
              }
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground"
            >
              {Object.entries(VISIBILITY_META).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            {scope === 'global' && (
              <select
                value={draft.projectId}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, projectId: e.target.value }))
                }
                className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground sm:col-span-2"
              >
                <option value="">Selecciona proyecto origen...</option>
                {selectableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <textarea
              rows={2}
              value={draft.context}
              onChange={(e) =>
                setDraft((d) => ({ ...d, context: e.target.value }))
              }
              placeholder="Contexto · ¿Cuándo y dónde ocurrió?"
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
            <textarea
              rows={3}
              value={draft.whatHappened}
              onChange={(e) =>
                setDraft((d) => ({ ...d, whatHappened: e.target.value }))
              }
              placeholder="Qué pasó · evento, decisión, sorpresa..."
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
            <textarea
              rows={2}
              value={draft.rootCause}
              onChange={(e) =>
                setDraft((d) => ({ ...d, rootCause: e.target.value }))
              }
              placeholder="Root cause · 5-Whys, fishbone, etc. (opcional)"
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
            <textarea
              rows={3}
              value={draft.recommendation}
              onChange={(e) =>
                setDraft((d) => ({ ...d, recommendation: e.target.value }))
              }
              placeholder="Recomendación · qué debemos hacer la próxima vez (action-oriented)"
              className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
            <input
              type="text"
              value={draft.appliesTo}
              onChange={(e) =>
                setDraft((d) => ({ ...d, appliesTo: e.target.value }))
              }
              placeholder="Aplica a · ej: kickoff, migrations, retros"
              className="rounded-md border border-border bg-background/50 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground sm:col-span-2"
            />
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setShowForm(false)
                setEditingId(null)
              }}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {editingId ? 'Guardar cambios' : 'Capturar'}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {filtered.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/30 p-10 text-center text-sm text-muted-foreground">
            <Award className="mx-auto h-10 w-10 opacity-40" />
            <p className="mt-3">
              {search || filterCat !== 'ALL'
                ? 'No hay lessons que coincidan con el filtro.'
                : 'Aún no hay lecciones capturadas.'}
            </p>
          </div>
        )}
        {filtered.map((l) => {
          const cat = CATEGORY_META[l.category]
          const expanded = expandedId === l.id
          return (
            <article
              key={l.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <header className="flex flex-wrap items-start gap-3">
                <div
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md ${cat.classes}`}
                >
                  <BookOpen className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-foreground">
                      {l.title}
                    </h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${cat.classes}`}
                    >
                      {cat.label}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      {VISIBILITY_META[l.visibility]}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {scope === 'global' && (
                      <span>{l.project.name} · </span>
                    )}
                    {l.capturedBy?.name ?? 'Sistema'} ·{' '}
                    {new Date(l.createdAt).toLocaleDateString('es-MX')}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => startEdit(l)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-card-hover hover:text-foreground"
                    title="Editar"
                  >
                    <Filter className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => remove(l.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"
                    title="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setExpandedId(expanded ? null : l.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-card-hover hover:text-foreground"
                  >
                    {expanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </header>

              <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-amber-300">
                  <CheckCircle2 className="h-3 w-3" />
                  Recomendación
                </div>
                <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">
                  {l.recommendation}
                </p>
              </div>

              {expanded && (
                <div className="mt-3 space-y-3 border-t border-border/60 pt-3 text-sm">
                  <Field title="Contexto" body={l.context} />
                  <Field title="¿Qué pasó?" body={l.whatHappened} />
                  {l.rootCause && (
                    <Field title="Root cause" body={l.rootCause} />
                  )}
                  {l.appliesTo && (
                    <Field title="Aplica a" body={l.appliesTo} />
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}

function Field({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{body}</p>
    </div>
  )
}
