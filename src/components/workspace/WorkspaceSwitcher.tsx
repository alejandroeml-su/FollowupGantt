'use client'

/**
 * Ola P4 · Equipo P4-1 — Workspace switcher para el header del Sidebar.
 *
 * Lista los workspaces del usuario (resueltos por el padre vía
 * `listMyWorkspaces`) y permite cambiar el activo. Al cambiar, llama a
 * `switchWorkspace` (que actualiza la cookie httpOnly=false) y refleja
 * el cambio en zustand para feedback inmediato.
 *
 * Decisión D-WS-1 aplicada: confiamos en el server para la verdad
 * (cookie + requireWorkspaceAccess) — el store es sólo hint de UX.
 */

import { useState, useTransition } from 'react'
import { Building2, ChevronsUpDown, Check, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { switchWorkspace } from '@/lib/actions/workspaces'
import { useUIStore } from '@/lib/stores/ui'
import Link from 'next/link'
import type { WorkspacePlan, WorkspaceRole } from '@prisma/client'

export type WorkspaceSummary = {
  id: string
  name: string
  slug: string
  plan: WorkspacePlan
  role: WorkspaceRole
  memberCount: number
  isOwner: boolean
}

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId: initialActive,
  collapsed = false,
}: {
  workspaces: WorkspaceSummary[]
  activeWorkspaceId: string | null
  collapsed?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const storeActive = useUIStore((s) => s.activeWorkspaceId)
  const setStoreActive = useUIStore((s) => s.setActiveWorkspaceId)

  // Preferimos el store si está hidratado (refleja último switch en este
  // tab). El initial server lo usamos en SSR para evitar flash.
  const activeId = storeActive ?? initialActive
  const active =
    workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null

  const handleSwitch = (workspaceId: string) => {
    if (!workspaceId || workspaceId === active?.id) {
      setOpen(false)
      return
    }
    startTransition(async () => {
      try {
        await switchWorkspace({ workspaceId })
        setStoreActive(workspaceId)
        setOpen(false)
      } catch (e) {
        console.error('[WorkspaceSwitcher] switchWorkspace failed', e)
        // Mantenemos el dropdown abierto para que el usuario reintente.
      }
    })
  }

  if (workspaces.length === 0) {
    // Sin workspaces aún: redirige a la creación.
    return (
      <Link
        href="/settings/workspace"
        className={clsx(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-border/60 text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors',
          collapsed && 'lg:justify-center lg:px-2',
        )}
        aria-label="Crear espacio de trabajo"
      >
        <Plus className="h-4 w-4 flex-shrink-0" />
        <span className={clsx(collapsed && 'lg:hidden')}>
          Crear espacio
        </span>
      </Link>
    )
  }

  if (collapsed) {
    // Modo colapsado: solo ícono + tooltip; click abre la página del WS.
    return (
      <Link
        href="/settings/workspace"
        className="hidden lg:flex justify-center items-center w-full px-2 py-2 rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
        title={active ? `${active.name} · ${active.plan}` : 'Espacios de trabajo'}
        aria-label="Espacios de trabajo"
      >
        <Building2 className="h-5 w-5" />
      </Link>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm bg-accent/30 border border-border/50 hover:bg-accent/60 hover:border-border transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Cambiar espacio"
        disabled={isPending}
      >
        <span className="flex items-center gap-2 min-w-0">
          <Building2 className="h-4 w-4 flex-shrink-0 text-primary" />
          <span className="flex flex-col items-start min-w-0">
            <span className="text-xs font-semibold text-foreground truncate max-w-[160px]">
              {active?.name ?? 'Sin espacio'}
            </span>
            <span className="text-[10px] text-muted-foreground tracking-wide uppercase">
              {active?.plan ?? 'FREE'}
            </span>
          </span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
          role="listbox"
          aria-label="Espacios de trabajo"
        >
          <div className="max-h-72 overflow-y-auto custom-scrollbar py-1">
            {workspaces.map((w) => {
              const isActive = w.id === active?.id
              return (
                <button
                  key={w.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => handleSwitch(w.id)}
                  className={clsx(
                    'w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground hover:bg-accent/50',
                  )}
                >
                  <span className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold truncate">
                      {w.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground tracking-wide">
                      {w.role} · {w.memberCount}{' '}
                      {w.memberCount === 1 ? 'miembro' : 'miembros'}
                    </span>
                  </span>
                  {isActive && <Check className="h-3.5 w-3.5 flex-shrink-0" />}
                </button>
              )
            })}
          </div>
          <div className="border-t border-border bg-muted/30">
            <Link
              href="/settings/workspace"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuevo espacio
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
