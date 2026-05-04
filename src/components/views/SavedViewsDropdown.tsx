'use client'

/**
 * Ola P2 · Equipo P2-1 — Dropdown "Vistas guardadas".
 *
 * Lista las vistas del usuario y las compartidas para la superficie actual,
 * permite seleccionar una (aplica filters/grouping/sorting/columnPrefs) y
 * abre los diálogos de "Guardar como…" y "Gestionar vistas".
 */

import { useState } from 'react'
import { ChevronDown, Eye, Plus, Settings2 } from 'lucide-react'
import { clsx } from 'clsx'
import type { ViewSurfaceLiteral } from '@/lib/actions/saved-views'
import { useUIStore, type SavedViewSurface } from '@/lib/stores/ui'
import { SaveViewDialog } from './SaveViewDialog'
import { ManageViewsDialog } from './ManageViewsDialog'

export type SavedViewSummary = {
  id: string
  name: string
  isShared: boolean
  isDefault: boolean
  ownedByCurrentUser: boolean
  filters: Record<string, unknown>
  grouping: string | null
  sorting?: { field: string; direction: 'asc' | 'desc' } | null
  columnPrefs?: Record<string, unknown> | null
}

type Props = {
  surface: ViewSurfaceLiteral
  views: SavedViewSummary[]
  /** Estado actual capturable como nueva vista. */
  currentFilters: Record<string, unknown>
  currentGrouping?: string | null
  currentSorting?: { field: string; direction: 'asc' | 'desc' } | null
  currentColumnPrefs?: Record<string, unknown> | null
  /** Callback al elegir una vista; aplica el shape al cliente. */
  onApplyView: (view: SavedViewSummary | null) => void
  className?: string
}

const SURFACE_TO_PATH: Record<ViewSurfaceLiteral, SavedViewSurface> = {
  LIST: 'list',
  KANBAN: 'kanban',
  GANTT: 'gantt',
  CALENDAR: 'calendar',
  TABLE: 'table',
}

export function SavedViewsDropdown({
  surface,
  views,
  currentFilters,
  currentGrouping = null,
  currentSorting = null,
  currentColumnPrefs = null,
  onApplyView,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)

  const path = SURFACE_TO_PATH[surface]
  const activeViewByPath = useUIStore((s) => s.activeViewByPath)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const clearActiveView = useUIStore((s) => s.clearActiveView)

  const activeId = activeViewByPath[path]
  const activeView = views.find((v) => v.id === activeId) ?? null
  const ownViews = views.filter((v) => v.ownedByCurrentUser)
  const sharedViews = views.filter((v) => !v.ownedByCurrentUser)

  function applyView(v: SavedViewSummary | null) {
    if (v) {
      setActiveView(path, v.id)
    } else {
      clearActiveView(path)
    }
    onApplyView(v)
    setOpen(false)
  }

  return (
    <>
      <div className={clsx('relative inline-block', className)}>
        <button
          type="button"
          data-testid="saved-views-trigger"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Vistas guardadas"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary"
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="max-w-[160px] truncate">
            {activeView ? activeView.name : 'Vistas guardadas'}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {open && (
          <div
            data-testid="saved-views-menu"
            role="menu"
            className="absolute left-0 z-40 mt-1 w-64 overflow-hidden rounded-md border border-border bg-card shadow-lg"
          >
            <button
              type="button"
              role="menuitem"
              data-testid="saved-views-default"
              onClick={() => applyView(null)}
              className={clsx(
                'flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-secondary',
                !activeView && 'font-semibold text-primary',
              )}
            >
              Vista por defecto
            </button>

            {ownViews.length > 0 && (
              <div className="border-t border-border/60">
                <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Mis vistas
                </p>
                {ownViews.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="menuitem"
                    data-testid={`saved-views-item-${v.id}`}
                    onClick={() => applyView(v)}
                    className={clsx(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-secondary',
                      v.id === activeId && 'font-semibold text-primary',
                    )}
                  >
                    <span className="truncate">{v.name}</span>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      {v.isDefault && <span aria-label="Default">★</span>}
                      {v.isShared && <span aria-label="Compartida">⇆</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {sharedViews.length > 0 && (
              <div className="border-t border-border/60">
                <p className="px-3 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Compartidas
                </p>
                {sharedViews.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    role="menuitem"
                    data-testid={`saved-views-item-${v.id}`}
                    onClick={() => applyView(v)}
                    className={clsx(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-secondary',
                      v.id === activeId && 'font-semibold text-primary',
                    )}
                  >
                    <span className="truncate">{v.name}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-border/60">
              <button
                type="button"
                role="menuitem"
                data-testid="saved-views-save-as"
                onClick={() => {
                  setSaveOpen(true)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-secondary"
              >
                <Plus className="h-3.5 w-3.5" />
                Guardar como…
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="saved-views-manage"
                onClick={() => {
                  setManageOpen(true)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-secondary"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Gestionar vistas
              </button>
            </div>
          </div>
        )}
      </div>

      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        surface={surface}
        filters={currentFilters}
        grouping={currentGrouping}
        sorting={currentSorting}
        columnPrefs={currentColumnPrefs}
        onSaved={(v) => setActiveView(path, v.id)}
      />

      <ManageViewsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        surface={surface}
        views={ownViews.map((v) => ({
          id: v.id,
          name: v.name,
          isShared: v.isShared,
          isDefault: v.isDefault,
        }))}
      />
    </>
  )
}
