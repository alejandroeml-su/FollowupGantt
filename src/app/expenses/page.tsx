/**
 * Ola P8 · Equipo P8-3 · Cost Management — Página /expenses.
 *
 * Server component que lista gastos, presupuesto vs actual del proyecto
 * filtrado y forecast EAC. Incluye el formulario de submisión.
 *
 * searchParams:
 *   - projectId: filtra todas las vistas a un proyecto específico.
 *   - status:    filtra el listado por status (DRAFT/SUBMITTED/...).
 *
 * Si no hay projectId seleccionado, mostramos todos los gastos sin
 * forecast/budget chart (esos requieren contexto de proyecto).
 */

import { Wallet } from 'lucide-react'
import type { ExpenseStatus } from '@prisma/client'
import prisma from '@/lib/prisma'
import { getCurrentUserPresence } from '@/lib/auth/get-current-user-presence'
import { listExpenses } from '@/lib/actions/expenses'
import {
  getBudgetVsActualForProject,
  getProjectForecast,
} from '@/lib/actions/budgets'
import { ExpenseSubmissionForm } from '@/components/cost/ExpenseSubmissionForm'
import { ExpenseList } from '@/components/cost/ExpenseList'
import { BudgetVsActualChart } from '@/components/cost/BudgetVsActualChart'
import { EACForecastCard } from '@/components/cost/EACForecastCard'
import { EXPENSE_STATUS_VALUES } from '@/lib/cost/expense-types'

export const dynamic = 'force-dynamic'

type SP = Promise<{ projectId?: string; status?: string }>

function isExpenseStatus(value: string | undefined): value is ExpenseStatus {
  return Boolean(value) && (EXPENSE_STATUS_VALUES as readonly string[]).includes(value as string)
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: SP
}) {
  const sp = await searchParams
  const projectId = sp.projectId
  const status = isExpenseStatus(sp.status) ? sp.status : undefined

  const currentUser = await getCurrentUserPresence()

  const [expenses, projects, tasks] = await Promise.all([
    listExpenses({
      projectId,
      status,
    }),
    prisma.project.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.task.findMany({
      where: projectId ? { projectId, archivedAt: null } : { archivedAt: null },
      select: { id: true, title: true, projectId: true },
      orderBy: { title: 'asc' },
      take: 500,
    }),
  ])

  const [budgetRows, forecast] = projectId
    ? await Promise.all([
        getBudgetVsActualForProject(projectId).catch(() => []),
        getProjectForecast(projectId).catch(() => null),
      ])
    : [[], null]

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      <header className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-primary" aria-hidden />
        <h1 className="text-lg font-semibold">Gastos & Presupuestos</h1>
      </header>
      <p className="text-xs text-muted-foreground">
        Registra gastos por proyecto en cualquier moneda. La conversión a USD
        se calcula con el tipo de cambio diario. El EAC pronosticado se
        ajusta por la velocity reciente del equipo.
      </p>

      {forecast && <EACForecastCard forecast={forecast} />}

      {projectId && budgetRows.length > 0 && (
        <section aria-labelledby="budget-vs-actual">
          <h2 id="budget-vs-actual" className="mb-2 text-sm font-semibold">
            Presupuesto vs gasto real
          </h2>
          <BudgetVsActualChart rows={budgetRows} />
        </section>
      )}

      <section aria-labelledby="new-expense">
        <h2 id="new-expense" className="mb-2 text-sm font-semibold">
          Nuevo gasto
        </h2>
        <ExpenseSubmissionForm
          projects={projects}
          tasks={tasks}
          submittedById={currentUser?.userId ?? ''}
        />
      </section>

      <section aria-labelledby="expenses-list">
        <h2 id="expenses-list" className="mb-2 text-sm font-semibold">
          Historial
        </h2>
        <ExpenseList expenses={expenses} showProject={!projectId} />
      </section>
    </main>
  )
}
