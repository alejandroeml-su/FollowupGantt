'use client'

/**
 * Ola P8 · Equipo P8-3 · Cost Management — Tabla de gastos.
 *
 * Renderiza una tabla read-only (sort por fecha desc) con columnas
 * proyecto, descripción, importe, USD, status y receipt link. Pensado
 * para `/expenses` y para embeberse en project drawer.
 *
 * Strings visibles en español. Las acciones (approve, reject, etc.)
 * están deferidas a P8-4 — en P8-3 sólo se ven los datos.
 */

import { ExternalLink } from 'lucide-react'
import type { ExpenseStatus } from '@prisma/client'
import type { SerializedExpense } from '@/lib/actions/expenses'

const STATUS_LABEL: Record<ExpenseStatus, string> = {
  DRAFT: 'Borrador',
  SUBMITTED: 'Sometido',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  REIMBURSED: 'Reembolsado',
}

const STATUS_STYLE: Record<ExpenseStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  SUBMITTED: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  APPROVED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  REJECTED: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30',
  REIMBURSED: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
}

export type ExpenseListProps = {
  expenses: SerializedExpense[]
  /** Si true, muestra columna proyecto (oculta en vistas project-scoped). */
  showProject?: boolean
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function ExpenseList(props: ExpenseListProps) {
  const { expenses, showProject = true } = props
  if (expenses.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No hay gastos registrados.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded border border-border bg-card">
      <table className="w-full text-sm" aria-label="Lista de gastos">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-left">
            <th className="px-3 py-2 font-medium">Fecha</th>
            {showProject && <th className="px-3 py-2 font-medium">Proyecto</th>}
            <th className="px-3 py-2 font-medium">Descripción</th>
            <th className="px-3 py-2 text-right font-medium">Importe</th>
            <th className="px-3 py-2 text-right font-medium">USD</th>
            <th className="px-3 py-2 font-medium">Sometido por</th>
            <th className="px-3 py-2 font-medium">Estado</th>
            <th className="px-3 py-2 font-medium">Recibo</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 whitespace-nowrap">{formatDate(e.incurredAt)}</td>
              {showProject && <td className="px-3 py-2">{e.projectName}</td>}
              <td className="px-3 py-2">
                {e.description}
                {e.taskTitle && (
                  <span className="ml-2 text-xs text-muted-foreground">→ {e.taskTitle}</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatMoney(e.amount, e.currency)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {e.amountUsd === null ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  formatMoney(e.amountUsd, 'USD')
                )}
              </td>
              <td className="px-3 py-2">{e.submittedByName}</td>
              <td className="px-3 py-2">
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[e.status]}`}
                >
                  {STATUS_LABEL[e.status]}
                </span>
              </td>
              <td className="px-3 py-2">
                {e.receiptUrl ? (
                  <a
                    href={e.receiptUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Ver <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
