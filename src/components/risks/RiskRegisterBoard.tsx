'use client'

/**
 * Wave P8 · Equipo P8-2 — Orquestador cliente del dashboard de Risks.
 *
 * Maneja el estado de UI:
 *   - Selección de celda en la matriz → filtra tabla.
 *   - Apertura del dialog crear/editar.
 *   - Eliminación con confirm().
 *   - Disparo de la simulación Monte Carlo (server action) y su resultado.
 *
 * La página servidor pasa los datos pre-cargados (`risks`, `users`,
 * `projects`) y el `projectId` por defecto.
 */

import { useState, useTransition } from 'react'
import { Plus, Play, RotateCcw } from 'lucide-react'
import {
  deleteRisk,
  runMonteCarloForProject,
} from '@/lib/actions/risks'
import type { SerializedRisk } from '@/lib/risks/types'
import type { MonteCarloResult } from '@/lib/risks/monte-carlo'
import { RiskMatrix, type MatrixCellSelection } from './RiskMatrix'
import { RiskRegisterTable } from './RiskRegisterTable'
import { RiskFormDialog } from './RiskFormDialog'
import { MonteCarloChart } from './MonteCarloChart'

type Props = {
  risks: SerializedRisk[]
  projects: Array<{ id: string; name: string }>
  users: Array<{ id: string; name: string }>
  defaultProjectId: string | null
}

export function RiskRegisterBoard({
  risks,
  projects,
  users,
  defaultProjectId,
}: Props) {
  const [cellSelection, setCellSelection] = useState<MatrixCellSelection>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SerializedRisk | null>(null)
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null)
  const [mcLoading, setMcLoading] = useState(false)
  const [mcError, setMcError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleNew() {
    setEditing(null)
    setDialogOpen(true)
  }

  function handleEdit(r: SerializedRisk) {
    setEditing(r)
    setDialogOpen(true)
  }

  function handleDelete(id: string) {
    if (!confirm('¿Eliminar este riesgo? Esta acción no se puede deshacer.')) {
      return
    }
    startTransition(async () => {
      try {
        await deleteRisk(id)
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Error desconocido')
      }
    })
  }

  function handleRunSim() {
    if (!defaultProjectId) {
      setMcError('Selecciona un proyecto para correr la simulación.')
      return
    }
    setMcError(null)
    setMcLoading(true)
    startTransition(async () => {
      try {
        const result = await runMonteCarloForProject({
          projectId: defaultProjectId,
          iterations: 1000,
          // Sin seed → no determinista (usa Date.now). Para tests usar seed.
        })
        setMcResult(result)
      } catch (err) {
        setMcError(err instanceof Error ? err.message : 'Error desconocido')
      } finally {
        setMcLoading(false)
      }
    })
  }

  function handleResetSim() {
    setMcResult(null)
    setMcError(null)
  }

  return (
    <div className="space-y-4" data-testid="risk-register-board">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleNew}
          className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          data-testid="risk-new-btn"
        >
          <Plus className="h-4 w-4" />
          Nuevo riesgo
        </button>

        <div className="flex items-center gap-2">
          {mcResult && (
            <button
              type="button"
              onClick={handleResetSim}
              className="flex items-center gap-1 rounded border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
              data-testid="risk-mc-reset-btn"
            >
              <RotateCcw className="h-4 w-4" />
              Limpiar
            </button>
          )}
          <button
            type="button"
            onClick={handleRunSim}
            disabled={pending || mcLoading || !defaultProjectId}
            className="flex items-center gap-1 rounded bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
            data-testid="risk-mc-run-btn"
          >
            <Play className="h-4 w-4" />
            {mcLoading ? 'Simulando…' : 'Correr Monte Carlo (1000)'}
          </button>
        </div>
      </header>

      {mcError && (
        <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {mcError}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <RiskMatrix
          risks={risks}
          selected={cellSelection}
          onSelectCell={setCellSelection}
        />
        <MonteCarloChart result={mcResult} loading={mcLoading} />
      </div>

      <RiskRegisterTable
        risks={risks}
        cellFilter={cellSelection}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <RiskFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        risk={editing}
        defaultProjectId={defaultProjectId}
        projects={projects}
        users={users}
        onSaved={() => {
          // El server action ya hace revalidatePath; cerramos el dialog.
          setDialogOpen(false)
        }}
      />
    </div>
  )
}
