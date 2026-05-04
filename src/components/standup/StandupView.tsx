'use client'

/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Vista on-demand.
 *
 * Cliente. Permite:
 *   - Tabs `Mi standup` / `Equipo` (este último activado por proyecto si
 *     el caller pasa `projects`).
 *   - Render markdown del summaryFull.
 *   - Sections expandibles: Ayer, Hoy, Bloqueos.
 *   - Botón "Copiar a Slack" (clipboard con plain-text format).
 *   - Botón "Regenerar" (force=true, bypass cache).
 *
 * Estado:
 *   - El primer render usa el `initial` que viene del server. Las acciones
 *     (regenerate, switch tab, switch project) llaman a las server actions
 *     y actualizan el estado local con setState (sin router.refresh, para
 *     no recargar todo el árbol y perder el resto de la UI).
 *
 * Accesibilidad:
 *   - Botones tienen aria-pressed/aria-expanded.
 *   - Region landmarks por sección.
 */

import { useCallback, useState, useTransition } from 'react'
import {
  generateProjectStandup,
  generateUserStandup,
} from '@/lib/actions/standup'
import { formatStandupAsPlainText } from '@/lib/ai/standup/format-slack'
import type { Standup } from '@/lib/ai/standup/standup-schema'

export interface StandupViewProject {
  id: string
  name: string
}

interface Props {
  initial: Standup
  /** Lista de proyectos visibles para el tab "Equipo". */
  projects: StandupViewProject[]
  /** Project preseleccionado para el tab Equipo. */
  defaultProjectId?: string
}

type Tab = 'me' | 'team'

export function StandupView({
  initial,
  projects,
  defaultProjectId,
}: Props): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('me')
  const [standup, setStandup] = useState<Standup>(initial)
  const [projectId, setProjectId] = useState<string | undefined>(
    defaultProjectId ?? projects[0]?.id,
  )
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    yesterday: true,
    today: true,
    blockers: true,
  })
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(
    (force = false) => {
      setError(null)
      startTransition(async () => {
        try {
          let next: Standup
          if (tab === 'team' && projectId) {
            next = await generateProjectStandup({ projectId, force })
          } else {
            next = await generateUserStandup({ force })
          }
          setStandup(next)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Error inesperado')
        }
      })
    },
    [tab, projectId],
  )

  const handleTabChange = useCallback(
    (next: Tab) => {
      if (next === tab) return
      setTab(next)
      // Cargar standup correspondiente.
      setError(null)
      startTransition(async () => {
        try {
          let value: Standup
          if (next === 'team' && projectId) {
            value = await generateProjectStandup({ projectId })
          } else {
            value = await generateUserStandup()
          }
          setStandup(value)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Error inesperado')
        }
      })
    },
    [tab, projectId],
  )

  const handleProjectChange = useCallback(
    (id: string) => {
      setProjectId(id)
      if (tab === 'team') {
        setError(null)
        startTransition(async () => {
          try {
            const value = await generateProjectStandup({ projectId: id })
            setStandup(value)
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Error inesperado')
          }
        })
      }
    },
    [tab],
  )

  const handleCopySlack = useCallback(async () => {
    try {
      const text = formatStandupAsPlainText(standup)
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      setError(
        err instanceof Error
          ? `No se pudo copiar al portapapeles: ${err.message}`
          : 'No se pudo copiar al portapapeles',
      )
    }
  }, [standup])

  function toggleSection(key: 'yesterday' | 'today' | 'blockers'): void {
    setExpanded((s) => ({ ...s, [key]: !s[key] }))
  }

  return (
    <section
      className="space-y-4"
      aria-labelledby="standup-heading"
      data-pending={pending ? 'true' : 'false'}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1
            id="standup-heading"
            className="text-xl font-semibold text-slate-900 dark:text-slate-100"
          >
            Daily standup
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {standup.date} · {standup.summaryShort}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Scope" className="inline-flex rounded-md border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'me'}
              onClick={() => handleTabChange('me')}
              className={`px-3 py-1.5 text-xs font-medium ${
                tab === 'me'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              Mi standup
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'team'}
              onClick={() => handleTabChange('team')}
              disabled={projects.length === 0}
              className={`px-3 py-1.5 text-xs font-medium ${
                tab === 'team'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-700 dark:text-slate-300'
              } disabled:opacity-50`}
            >
              Equipo
            </button>
          </div>
          {tab === 'team' && projects.length > 0 && (
            <select
              aria-label="Proyecto"
              value={projectId ?? ''}
              onChange={(e) => handleProjectChange(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={handleCopySlack}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200"
          >
            {copied ? 'Copiado' : 'Copiar a Slack'}
          </button>
          <button
            type="button"
            onClick={() => refresh(true)}
            disabled={pending}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {pending ? 'Generando…' : 'Regenerar'}
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <article className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
        <pre className="whitespace-pre-wrap font-sans text-sm">
          {standup.summaryFull}
        </pre>
      </article>

      <CollapsibleSection
        title="Ayer"
        count={countItems(standup.yesterday)}
        expanded={expanded.yesterday}
        onToggle={() => toggleSection('yesterday')}
      >
        <UserList buckets={standup.yesterday} emptyText="Sin tareas completadas" />
      </CollapsibleSection>

      <CollapsibleSection
        title="Hoy"
        count={countItems(standup.today)}
        expanded={expanded.today}
        onToggle={() => toggleSection('today')}
      >
        <UserList buckets={standup.today} emptyText="Sin tareas activas" />
      </CollapsibleSection>

      <CollapsibleSection
        title="Bloqueos"
        count={standup.blockers.length}
        expanded={expanded.blockers}
        onToggle={() => toggleSection('blockers')}
      >
        {standup.blockers.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ninguno detectado.
          </p>
        ) : (
          <ul className="space-y-2">
            {standup.blockers.map((b, i) => (
              <li
                key={`${b.user}-${i}`}
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
              >
                <div>
                  <span className="font-medium">{b.user}</span> — {b.description}
                </div>
                {b.suggestedAction && (
                  <div className="mt-1 text-amber-700 dark:text-amber-300">
                    <span aria-hidden>💡</span> {b.suggestedAction}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {standup.participants.length > 0 && (
        <footer className="text-xs text-slate-500 dark:text-slate-400">
          Participantes: {standup.participants.join(', ')}
        </footer>
      )}
    </section>
  )
}

// ─────────────────────────── Subcomponentes ────────────────────────────

interface CollapsibleProps {
  title: string
  count: number
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}

function CollapsibleSection({
  title,
  count,
  expanded,
  onToggle,
  children,
}: CollapsibleProps): React.JSX.Element {
  return (
    <section
      aria-label={title}
      className="rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800"
      >
        <span>
          {title}
          <span className="ml-2 inline-flex items-center justify-center rounded bg-slate-100 px-1.5 text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {count}
          </span>
        </span>
        <span aria-hidden className="text-slate-500">
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded && <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-700">{children}</div>}
    </section>
  )
}

function UserList({
  buckets,
  emptyText,
}: {
  buckets: Standup['yesterday']
  emptyText: string
}): React.JSX.Element {
  if (buckets.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>
  }
  return (
    <ul className="space-y-2">
      {buckets.map((b) => (
        <li key={b.user}>
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
            {b.user}
          </div>
          <ul className="ml-4 list-disc space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
            {b.items.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

function countItems(buckets: Standup['yesterday']): number {
  return buckets.reduce((acc, b) => acc + b.items.length, 0)
}
