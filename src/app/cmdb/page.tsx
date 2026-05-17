import { Database } from 'lucide-react'
import { searchCIs, type SearchCIsInput } from '@/lib/actions/cmdb'
import { CmdbTableClient } from '@/components/cmdb/CmdbTableClient'

/**
 * Wave R5 · US-9.3 — CMDB simplificado · listado.
 *
 * Server component que renderiza la tabla de Configuration Items
 * (workspace-scoped). El cliente recibe los resultados serializados y
 * dispara nuevas búsquedas vía `searchCIs` directamente como server
 * action.
 */
export const dynamic = 'force-dynamic'

function firstParam(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}

const CI_TYPE_VALUES = [
  'SERVICE',
  'APPLICATION',
  'SERVER',
  'DATABASE',
  'NETWORK_DEVICE',
  'ENDPOINT',
  'DOCUMENT',
  'BUSINESS_PROCESS',
  'CONTRACT',
  'OTHER',
] as const
const CI_STATUS_VALUES = [
  'PLANNED',
  'ACTIVE',
  'MAINTENANCE',
  'RETIRED',
  'INCIDENT',
] as const
const CI_CRIT_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

function parseSearch(
  sp: Record<string, string | string[] | undefined>,
): SearchCIsInput {
  const type = firstParam(sp.type)
  const status = firstParam(sp.status)
  const criticality = firstParam(sp.criticality)
  const page = Number.parseInt(firstParam(sp.page) ?? '1', 10)
  const includeRetired = firstParam(sp.retired) === '1'

  return {
    query: firstParam(sp.q),
    type:
      type && (CI_TYPE_VALUES as readonly string[]).includes(type)
        ? (type as (typeof CI_TYPE_VALUES)[number])
        : undefined,
    status:
      status && (CI_STATUS_VALUES as readonly string[]).includes(status)
        ? (status as (typeof CI_STATUS_VALUES)[number])
        : undefined,
    criticality:
      criticality && (CI_CRIT_VALUES as readonly string[]).includes(criticality)
        ? (criticality as (typeof CI_CRIT_VALUES)[number])
        : undefined,
    environment: firstParam(sp.env),
    includeRetired,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: 25,
  }
}

export default async function CmdbPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const filters = parseSearch(sp)
  const result = await searchCIs(filters)

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="inline-flex items-center gap-2 text-xl font-bold text-foreground">
            <Database className="h-5 w-5 text-emerald-400" />
            CMDB · Configuration Items
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            ITIL v4 · Gestión de Activos · Inventario de infraestructura del
            workspace
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <CmdbTableClient
          initialResult={{
            ...result,
            items: result.items.map((it) => ({
              ...it,
              retiredAt: it.retiredAt ? it.retiredAt.toISOString() : null,
              updatedAt: it.updatedAt.toISOString(),
            })),
          }}
          initialFilters={filters}
        />
      </div>
    </div>
  )
}
