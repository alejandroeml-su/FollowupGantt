'use client'

/**
 * Ola P2 · Equipo P2-5 — Sidebar del editor de docs.
 *
 * Renderiza el árbol jerárquico (DocTreeNode[]) con nodos colapsables,
 * search debounced y botones de creación / archivado.
 *
 * Estado interno:
 *   - `collapsed`: Set de ids de nodos plegados.
 *   - `query`:     término de búsqueda (espejado al server vía useTransition).
 *
 * Eventos hacia el padre:
 *   - `onSelect(id)` cuando el usuario clicka un nodo.
 *   - `onCreate(parentId | null)` para abrir el dialog en el padre indicado.
 *   - `onArchive(id)` y `onRestore(id)` para soft-delete.
 */

import { useState, useTransition, useMemo, useEffect, useRef } from 'react'
import {
  FileText,
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Trash2,
  RotateCcw,
} from 'lucide-react'
import type { DocTreeNode } from '@/lib/actions/docs'
import { searchDocs, type DocSearchResult } from '@/lib/actions/docs'

type Props = {
  tree: DocTreeNode[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: (parentId: string | null) => void
  onArchive: (id: string) => void
  onRestore?: (id: string) => void
  /** Si true, los nodos archivados también se muestran (modo papelera). */
  showArchived?: boolean
}

export function DocsSidebar({
  tree,
  selectedId,
  onSelect,
  onCreate,
  onArchive,
  onRestore,
  showArchived = false,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DocSearchResult[]>([])
  const [pending, start] = useTransition()
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Search debounced 300ms — dispara desde el handler `onChange` para no
  // caer en `react-hooks/set-state-in-effect`. El cleanup del timer en
  // unmount sí vive en useEffect (no toca state).
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  function handleQueryChange(next: string) {
    setQuery(next)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (next.trim().length < 2) {
      setResults([])
      return
    }
    searchTimerRef.current = setTimeout(() => {
      start(async () => {
        try {
          const found = await searchDocs(next)
          setResults(found)
        } catch {
          setResults([])
        }
      })
    }, 300)
  }

  const isSearching = useMemo(
    () => query.trim().length >= 2,
    [query],
  )

  return (
    <aside
      className="flex w-72 flex-shrink-0 flex-col border-r border-border bg-card/40"
      data-testid="docs-sidebar"
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileText className="h-4 w-4 text-primary" />
          Docs
        </h2>
        <button
          type="button"
          onClick={() => onCreate(null)}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="Nuevo documento raíz"
          title="Nuevo documento"
          data-testid="docs-sidebar-new-root"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Buscar en docs…"
            className="w-full rounded border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground outline-none focus:border-primary"
            data-testid="docs-sidebar-search"
          />
        </div>
        {pending && (
          <p className="mt-1 text-[10px] text-muted-foreground">Buscando…</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {isSearching ? (
          results.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Sin resultados
            </p>
          ) : (
            <ul className="space-y-1" data-testid="docs-sidebar-results">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r.id)}
                    className={[
                      'flex w-full flex-col items-start rounded px-2 py-1.5 text-left transition-colors',
                      selectedId === r.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-secondary',
                    ].join(' ')}
                  >
                    <span className="truncate text-sm">{r.title}</span>
                    {r.snippet && (
                      <span className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
                        {r.snippet}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : tree.length === 0 ? (
          <p
            className="px-2 py-4 text-center text-xs text-muted-foreground"
            data-testid="docs-sidebar-empty"
          >
            No hay documentos. Crea el primero.
          </p>
        ) : (
          <ul className="space-y-0.5" data-testid="docs-sidebar-tree">
            {tree.map((node) => (
              <TreeRow
                key={node.id}
                node={node}
                level={0}
                selectedId={selectedId}
                collapsed={collapsed}
                onToggle={toggle}
                onSelect={onSelect}
                onCreate={onCreate}
                onArchive={onArchive}
                onRestore={onRestore}
                showArchived={showArchived}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

type RowProps = {
  node: DocTreeNode
  level: number
  selectedId: string | null
  collapsed: Set<string>
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onCreate: (parentId: string | null) => void
  onArchive: (id: string) => void
  onRestore?: (id: string) => void
  showArchived?: boolean
}

function TreeRow({
  node,
  level,
  selectedId,
  collapsed,
  onToggle,
  onSelect,
  onCreate,
  onArchive,
  onRestore,
  showArchived,
}: RowProps) {
  const isOpen = !collapsed.has(node.id)
  const hasChildren = node.children.length > 0
  const isSelected = selectedId === node.id

  if (!showArchived && node.isArchived) return null

  return (
    <li>
      <div
        className={[
          'group flex items-center gap-1 rounded px-1 py-1 transition-colors',
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'text-foreground hover:bg-secondary',
          node.isArchived ? 'opacity-50' : '',
        ].join(' ')}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        data-testid="docs-sidebar-row"
        data-doc-id={node.id}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label={isOpen ? 'Plegar' : 'Expandir'}
            data-testid="docs-sidebar-toggle"
          >
            {isOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-[18px]" />
        )}

        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex flex-1 items-center gap-1.5 overflow-hidden text-left"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs">{node.title}</span>
        </button>

        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          {!node.isArchived ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onCreate(node.id)
                }}
                className="rounded p-0.5 text-muted-foreground hover:text-primary"
                aria-label="Nuevo doc hijo"
                title="Nuevo hijo"
              >
                <Plus className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onArchive(node.id)
                }}
                className="rounded p-0.5 text-muted-foreground hover:text-red-500"
                aria-label="Archivar"
                title="Archivar"
                data-testid="docs-sidebar-archive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </>
          ) : onRestore ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRestore(node.id)
              }}
              className="rounded p-0.5 text-muted-foreground hover:text-emerald-500"
              aria-label="Restaurar"
              title="Restaurar"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>

      {isOpen && hasChildren && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
              onCreate={onCreate}
              onArchive={onArchive}
              onRestore={onRestore}
              showArchived={showArchived}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
