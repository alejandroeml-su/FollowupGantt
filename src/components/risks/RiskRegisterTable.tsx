'use client'

/**
 * Wave P8 · Equipo P8-2 — Tabla del risk register con filtros.
 *
 * Renderiza la lista plana de riesgos. Filtros aplicables:
 *   - status (multi)
 *   - tier (multi, derivado del score)
 *   - cell selection desde `RiskMatrix` (probability + impact exactos)
 *   - búsqueda por título (case-insensitive)
 *
 * Acciones por fila: Editar / Eliminar (delegadas vía callbacks al padre).
 */

import { useMemo, useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import {
  STATUS_LABEL,
  TIER_LABEL,
  type RiskStatus,
  type RiskTier,
  type SerializedRisk,
} from '@/lib/risks/types'
import {
  TIER_BG_CLASS,
  TIER_BORDER_CLASS,
  TIER_TEXT_CLASS,
} from '@/lib/risks/risk-score'
import type { MatrixCellSelection } from './RiskMatrix'

type Props = {
  risks: SerializedRisk[]
  cellFilter?: MatrixCellSelection
  onEdit?: (risk: SerializedRisk) => void
  onDelete?: (id: string) => void
}

export function RiskRegisterTable({
  risks,
  cellFilter,
  onEdit,
  onDelete,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<RiskStatus | 'ALL'>('ALL')
  const [tierFilter, setTierFilter] = useState<RiskTier | 'ALL'>('ALL')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return risks.filter((r) => {
      if (cellFilter) {
        if (
          r.probability !== cellFilter.probability ||
          r.impact !== cellFilter.impact
        ) {
          return false
        }
      }
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
      if (tierFilter !== 'ALL' && r.tier !== tierFilter) return false
      if (q && !r.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [risks, cellFilter, statusFilter, tierFilter, search])

  return (
    <div
      className="rounded-lg border border-border bg-card"
      data-testid="risk-register-table"
    >
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Buscar</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Título…"
            className="w-48 rounded border border-border bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Estado</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as RiskStatus | 'ALL')}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="ALL">Todos</option>
            <option value="OPEN">{STATUS_LABEL.OPEN}</option>
            <option value="MITIGATING">{STATUS_LABEL.MITIGATING}</option>
            <option value="ACCEPTED">{STATUS_LABEL.ACCEPTED}</option>
            <option value="CLOSED">{STATUS_LABEL.CLOSED}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Severidad</span>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as RiskTier | 'ALL')}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="ALL">Todas</option>
            <option value="LOW">{TIER_LABEL.LOW}</option>
            <option value="MEDIUM">{TIER_LABEL.MEDIUM}</option>
            <option value="HIGH">{TIER_LABEL.HIGH}</option>
            <option value="CRITICAL">{TIER_LABEL.CRITICAL}</option>
          </select>
        </label>
        {cellFilter && (
          <span className="self-end rounded bg-primary/10 px-2 py-1 text-xs text-primary">
            Filtro matriz: P{cellFilter.probability} × I{cellFilter.impact}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} / {risks.length} riesgos
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Título</th>
              <th className="px-3 py-2 text-left">Proyecto</th>
              <th className="px-3 py-2 text-center">P × I</th>
              <th className="px-3 py-2 text-center">Score</th>
              <th className="px-3 py-2 text-left">Severidad</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-right">Delay (d)</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No hay riesgos que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  data-testid="risk-row"
                  className="border-t border-border hover:bg-muted/20"
                >
                  <td className="px-3 py-2 font-medium">{r.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.projectName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.probability} × {r.impact}
                  </td>
                  <td className="px-3 py-2 text-center font-semibold">
                    {r.score}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={[
                        'inline-block rounded border px-2 py-0.5 text-xs',
                        TIER_BG_CLASS[r.tier],
                        TIER_BORDER_CLASS[r.tier],
                        TIER_TEXT_CLASS[r.tier],
                      ].join(' ')}
                    >
                      {TIER_LABEL[r.tier]}
                    </span>
                  </td>
                  <td className="px-3 py-2">{STATUS_LABEL[r.status]}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.ownerName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.triggerDelayDays ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {onEdit && (
                        <button
                          type="button"
                          onClick={() => onEdit(r)}
                          aria-label={`Editar riesgo ${r.title}`}
                          className="rounded border border-border bg-background p-1 hover:bg-muted"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(r.id)}
                          aria-label={`Eliminar riesgo ${r.title}`}
                          className="rounded border border-border bg-background p-1 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
