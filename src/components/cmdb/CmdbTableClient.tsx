'use client'

/**
 * Wave R5 · US-9.3 — CMDB simplificado · tabla cliente.
 *
 * Renderiza la lista de Configuration Items con filtros combinables
 * (type/status/criticality/environment/búsqueda libre + toggle retired).
 * Los cambios de filtro mutan los `searchParams` y dejan que el server
 * component re-renderice con los nuevos datos (server-driven UI).
 *
 * El componente usa SOLO clases tailwind del Design System (CSS vars de
 * `text-foreground`, `bg-card`, etc.) para soportar dark/light mode sin
 * variantes `dark:`. Mismo patrón que LessonsLearnedClient/RisksClient.
 */

import { useTransition, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Database, Search, Plus, Filter, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import type { SearchCIsInput } from '@/lib/actions/cmdb'

type Item = {
  id: string
  code: string
  name: string
  type: string
  status: string
  criticality: string
  environment: string | null
  description: string | null
  retiredAt: string | null
  updatedAt: string
  owner: { id: string; name: string } | null
  _count: { relationsFrom: number; relationsTo: number; taskLinks: number }
}

type Props = {
  initialResult: {
    total: number
    page: number
    pageSize: number
    items: Item[]
  }
  initialFilters: SearchCIsInput
}

const TYPE_LABEL: Record<string, string> = {
  SERVICE: 'Servicio',
  APPLICATION: 'Aplicación',
  SERVER: 'Servidor',
  DATABASE: 'Base de datos',
  NETWORK_DEVICE: 'Dispositivo de red',
  ENDPOINT: 'Endpoint',
  DOCUMENT: 'Documento',
  BUSINESS_PROCESS: 'Proceso de negocio',
  CONTRACT: 'Contrato',
  OTHER: 'Otro',
}

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planeado',
  ACTIVE: 'Activo',
  MAINTENANCE: 'Mantenimiento',
  RETIRED: 'Retirado',
  INCIDENT: 'Con incidente',
}

const STATUS_COLOR: Record<string, string> = {
  PLANNED: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  MAINTENANCE: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  RETIRED: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  INCIDENT: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
}

const CRIT_COLOR: Record<string, string> = {
  LOW: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  MEDIUM: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  HIGH: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  CRITICAL: 'bg-rose-500/20 text-rose-300 border-rose-500/40 font-semibold',
}

const CRIT_LABEL: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
}

export function CmdbTableClient({ initialResult, initialFilters }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const filters = useMemo(
    () => ({
      q: initialFilters.query ?? '',
      type: initialFilters.type ?? '',
      status: initialFilters.status ?? '',
      criticality: initialFilters.criticality ?? '',
      env: initialFilters.environment ?? '',
      retired: initialFilters.includeRetired ? '1' : '',
    }),
    [initialFilters],
  )

  function updateParam(key: string, value: string): void {
    const params = new URLSearchParams(search?.toString() ?? '')
    if (value) params.set(key, value)
    else params.delete(key)
    // Reset page al cambiar filtros
    params.delete('page')
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  function goToPage(page: number): void {
    const params = new URLSearchParams(search?.toString() ?? '')
    if (page > 1) params.set('page', String(page))
    else params.delete('page')
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  const totalPages = Math.max(
    1,
    Math.ceil(initialResult.total / initialResult.pageSize),
  )

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div
        className="grid grid-cols-1 gap-2 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6"
        role="region"
        aria-label="Filtros CMDB"
        data-testid="cmdb-filters"
      >
        <label className="relative col-span-1 lg:col-span-2">
          <Search
            className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            defaultValue={filters.q}
            placeholder="Buscar por código, nombre o descripción…"
            aria-label="Buscar Configuration Items"
            data-testid="cmdb-filter-search"
            className="w-full rounded-md border border-border bg-input pl-7 pr-2 py-1.5 text-sm text-input-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateParam('q', (e.target as HTMLInputElement).value.trim())
              }
            }}
          />
        </label>

        <select
          value={filters.type}
          onChange={(e) => updateParam('type', e.target.value)}
          aria-label="Filtrar por tipo de CI"
          data-testid="cmdb-filter-type"
          className="rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground"
        >
          <option value="">Todos los tipos</option>
          {Object.entries(TYPE_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={filters.status}
          onChange={(e) => updateParam('status', e.target.value)}
          aria-label="Filtrar por estado"
          data-testid="cmdb-filter-status"
          className="rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={filters.criticality}
          onChange={(e) => updateParam('criticality', e.target.value)}
          aria-label="Filtrar por criticidad"
          data-testid="cmdb-filter-criticality"
          className="rounded-md border border-border bg-input px-2 py-1.5 text-sm text-input-foreground"
        >
          <option value="">Todas las criticidades</option>
          {Object.entries(CRIT_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 rounded-md border border-border bg-input px-2 py-1.5 text-xs text-input-foreground">
          <input
            type="checkbox"
            checked={filters.retired === '1'}
            onChange={(e) => updateParam('retired', e.target.checked ? '1' : '')}
            className="h-3.5 w-3.5 rounded border-border bg-input accent-primary"
            data-testid="cmdb-filter-retired"
          />
          <span>Incluir retirados</span>
        </label>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Filter className="h-3.5 w-3.5" />
          {initialResult.total} CI{initialResult.total === 1 ? '' : 's'} ·
          página {initialResult.page} / {totalPages}
          {isPending && <Loader2 className="ml-2 h-3.5 w-3.5 animate-spin" />}
        </span>
        <Link
          href="/cmdb/new"
          className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
        >
          <Plus className="h-3.5 w-3.5" /> Nuevo CI
        </Link>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-subtle/40">
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Criticidad</th>
              <th className="px-3 py-2 font-medium">Ambiente</th>
              <th className="px-3 py-2 font-medium">Dueño</th>
              <th className="px-3 py-2 font-medium text-right">Vínculos</th>
            </tr>
          </thead>
          <tbody>
            {initialResult.items.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-12 text-center text-muted-foreground"
                >
                  <Database className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p>No hay CIs que coincidan con los filtros.</p>
                  <p className="mt-1 text-xs">
                    Crea el primer Configuration Item para empezar a poblar el
                    inventario.
                  </p>
                </td>
              </tr>
            ) : (
              initialResult.items.map((item) => {
                const links =
                  item._count.relationsFrom +
                  item._count.relationsTo +
                  item._count.taskLinks
                return (
                  <tr
                    key={item.id}
                    className="border-t border-border hover:bg-subtle/40"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-foreground">
                      <Link
                        href={`/cmdb/${item.id}`}
                        className="text-primary hover:underline"
                      >
                        {item.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-foreground">
                      <Link
                        href={`/cmdb/${item.id}`}
                        className="hover:underline"
                      >
                        {item.name}
                      </Link>
                      {item.description ? (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                          {item.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {TYPE_LABEL[item.type] ?? item.type}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={clsx(
                          'rounded border px-1.5 py-0.5 text-[10px] font-medium',
                          STATUS_COLOR[item.status] ??
                            'bg-slate-500/15 text-slate-300 border-slate-500/30',
                        )}
                      >
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={clsx(
                          'rounded border px-1.5 py-0.5 text-[10px]',
                          CRIT_COLOR[item.criticality] ??
                            'bg-slate-500/15 text-slate-300 border-slate-500/30',
                        )}
                      >
                        {CRIT_LABEL[item.criticality] ?? item.criticality}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.environment ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.owner?.name ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      <span
                        className="inline-flex min-w-[2rem] justify-center rounded bg-subtle px-2 py-0.5 text-foreground"
                        title={`${item._count.relationsFrom + item._count.relationsTo} relaciones · ${item._count.taskLinks} tickets`}
                      >
                        {links}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <button
            type="button"
            onClick={() => goToPage(initialResult.page - 1)}
            disabled={initialResult.page <= 1 || isPending}
            className="rounded-md border border-border bg-card px-2 py-1 hover:bg-subtle disabled:opacity-50"
          >
            Anterior
          </button>
          <span>
            {initialResult.page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => goToPage(initialResult.page + 1)}
            disabled={initialResult.page >= totalPages || isPending}
            className="rounded-md border border-border bg-card px-2 py-1 hover:bg-subtle disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  )
}
