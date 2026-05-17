'use client'

/**
 * Wave R5 · US-9.3 — Selector "CIs afectados" para Tasks ITIL.
 *
 * Muestra los CIs ya linkeados a una task y permite agregar/quitar
 * vínculos vía server actions. Carga sugerencias por búsqueda (debounce
 * 250ms) sobre `searchCIs`. Sólo se usa desde `TaskItilSection` cuando
 * `taskId` está disponible (mode='edit').
 *
 * Reglas:
 *   - Default role='AFFECTED' (la UI ofrece cambiarlo después si Edwin
 *     lo pide; YAGNI por ahora).
 *   - Soft-fail: si una mutación falla, se restaura el estado anterior y
 *     se muestra un mensaje inline. NO bloquea la edición del resto del
 *     form.
 */

import { useEffect, useState, useTransition } from 'react'
import { Database, X, Loader2, Search } from 'lucide-react'
import { clsx } from 'clsx'
import {
  searchCIs,
  linkTaskToCI,
  unlinkTaskFromCI,
} from '@/lib/actions/cmdb'

type CILink = {
  id: string
  role: 'AFFECTED' | 'CAUSE' | 'AFFECTED_DOWNSTREAM' | 'INFORMATIONAL'
  ci: {
    id: string
    code: string
    name: string
    type: string
    criticality: string
  }
}

type Suggestion = {
  id: string
  code: string
  name: string
  type: string
  criticality: string
}

type Props = {
  taskId: string
  initialLinks: CILink[]
  disabled?: boolean
}

const ROLE_LABEL: Record<string, string> = {
  AFFECTED: 'Afectado',
  CAUSE: 'Causa raíz',
  AFFECTED_DOWNSTREAM: 'Downstream',
  INFORMATIONAL: 'Informativo',
}

const CRIT_DOT: Record<string, string> = {
  LOW: 'bg-emerald-400',
  MEDIUM: 'bg-amber-400',
  HIGH: 'bg-orange-400',
  CRITICAL: 'bg-rose-500',
}

export function TaskCISelector({ taskId, initialLinks, disabled }: Props) {
  const [links, setLinks] = useState<CILink[]>(initialLinks)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Debounce 250ms · si el usuario sigue tecleando descartamos la query
  // anterior antes de pegarle a la red. NOTA: para vaciar suggestions
  // cuando query está vacío usamos un cleanup async-safe — evitamos un
  // setState síncrono en el body del effect (lint react-hooks/set-state-in-effect).
  useEffect(() => {
    const trimmed = query.trim()
    let cancelled = false
    if (!trimmed) {
      // Programa el reset al siguiente microtask para evitar el setState
      // síncrono que dispararía cascading renders. Mismo patrón que las
      // suggestions remotas.
      const handle = setTimeout(() => {
        if (!cancelled) setSuggestions([])
      }, 0)
      return () => {
        cancelled = true
        clearTimeout(handle)
      }
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        try {
          const res = await searchCIs({ query: trimmed, pageSize: 10 })
          if (cancelled) return
          const linkedIds = new Set(links.map((l) => l.ci.id))
          setSuggestions(
            res.items
              .filter((it) => !linkedIds.has(it.id))
              .map((it) => ({
                id: it.id,
                code: it.code,
                name: it.name,
                type: it.type,
                criticality: it.criticality,
              })),
          )
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Error buscando CIs')
          }
        }
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query, links])

  async function handleLink(s: Suggestion): Promise<void> {
    setError(null)
    const optimistic: CILink = {
      id: `temp-${s.id}`,
      role: 'AFFECTED',
      ci: s,
    }
    setLinks((prev) => [...prev, optimistic])
    setQuery('')
    setSuggestions([])
    try {
      const created = await linkTaskToCI({
        taskId,
        ciId: s.id,
        role: 'AFFECTED',
      })
      setLinks((prev) =>
        prev.map((l) => (l.id === optimistic.id ? { ...l, id: created.id } : l)),
      )
    } catch (err) {
      // Rollback
      setLinks((prev) => prev.filter((l) => l.id !== optimistic.id))
      setError(
        err instanceof Error ? err.message.replace(/^\[\w+\]\s*/, '') : 'No se pudo vincular',
      )
    }
  }

  async function handleUnlink(link: CILink): Promise<void> {
    setError(null)
    const prevSnapshot = links
    setLinks((prev) => prev.filter((l) => l.id !== link.id))
    try {
      await unlinkTaskFromCI({ id: link.id })
    } catch (err) {
      setLinks(prevSnapshot)
      setError(
        err instanceof Error ? err.message.replace(/^\[\w+\]\s*/, '') : 'No se pudo desvincular',
      )
    }
  }

  return (
    <div
      className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3"
      data-testid="task-ci-selector"
    >
      <h4 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-300">
        <Database className="h-3 w-3" /> CIs afectados (CMDB)
      </h4>

      {links.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Sin CIs vinculados. Busca uno abajo para registrar la afectación.
        </p>
      ) : (
        <ul className="space-y-1">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center gap-2 rounded border border-border bg-card/40 px-2 py-1 text-xs"
            >
              <span
                className={clsx(
                  'h-2 w-2 rounded-full',
                  CRIT_DOT[link.ci.criticality] ?? 'bg-slate-400',
                )}
                title={`Criticidad ${link.ci.criticality}`}
              />
              <span className="font-mono text-[11px] text-primary">
                {link.ci.code}
              </span>
              <span className="flex-1 truncate text-foreground">
                {link.ci.name}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {ROLE_LABEL[link.role] ?? link.role}
              </span>
              <button
                type="button"
                onClick={() => handleUnlink(link)}
                disabled={disabled}
                aria-label={`Desvincular ${link.ci.code}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-rose-500/20 hover:text-rose-300"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar CI por código o nombre…"
          disabled={disabled}
          aria-label="Buscar Configuration Item"
          className="w-full rounded-md border border-border bg-input pl-7 pr-2 py-1.5 text-xs text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {open && suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-popover shadow-lg">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    handleLink(s)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-subtle"
                >
                  <span className="font-mono text-[10px] text-primary">
                    {s.code}
                  </span>
                  <span className="flex-1 truncate text-foreground">
                    {s.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {s.type}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {isPending && (
          <Loader2 className="absolute right-2 top-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300"
        >
          {error}
        </p>
      )}
    </div>
  )
}
