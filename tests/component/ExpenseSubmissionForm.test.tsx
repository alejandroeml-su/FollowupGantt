import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Ola P8 · Equipo P8-3 — tests de componente del `ExpenseSubmissionForm`.
 *
 * Mockeamos las server actions para evitar pasar por Prisma.
 */

const createExpense = vi.fn()
const submitExpense = vi.fn()

vi.mock('@/lib/actions/expenses', () => ({
  createExpense: (...args: unknown[]) => createExpense(...args),
  submitExpense: (...args: unknown[]) => submitExpense(...args),
}))

import { ExpenseSubmissionForm } from '@/components/cost/ExpenseSubmissionForm'

const projects = [
  { id: 'p1', name: 'Proyecto Alpha' },
  { id: 'p2', name: 'Proyecto Beta' },
]
const tasks = [
  { id: 't1', title: 'Comprar licencia', projectId: 'p1' },
  { id: 't2', title: 'Hosting', projectId: 'p2' },
]

beforeEach(() => {
  createExpense.mockReset()
  submitExpense.mockReset()
})

describe('ExpenseSubmissionForm', () => {
  it('renderiza inputs principales (descripción, importe, moneda, fecha)', () => {
    render(
      <ExpenseSubmissionForm
        projects={projects}
        tasks={tasks}
        submittedById="u1"
      />,
    )
    expect(screen.getByRole('form', { name: /Formulario de gasto/i })).toBeInTheDocument()
    expect(screen.getByText('Descripción')).toBeInTheDocument()
    expect(screen.getByText('Importe')).toBeInTheDocument()
    expect(screen.getByText('Moneda')).toBeInTheDocument()
    expect(screen.getByText('Fecha del gasto')).toBeInTheDocument()
  })

  it('al guardar borrador llama createExpense pero NO submitExpense', async () => {
    createExpense.mockResolvedValue({ id: 'e1' })
    const user = userEvent.setup()
    render(
      <ExpenseSubmissionForm
        projects={projects}
        tasks={tasks}
        submittedById="u1"
      />,
    )

    await user.type(screen.getByRole('textbox', { name: /Descripción/i }), 'Cafetería')
    // Importe usa input type="text" con placeholder distintivo.
    const amountInput = screen.getByPlaceholderText('0.00')
    await user.type(amountInput, '50.25')

    await user.click(screen.getByRole('button', { name: /Guardar borrador/i }))

    expect(createExpense).toHaveBeenCalled()
    expect(submitExpense).not.toHaveBeenCalled()
    const arg = createExpense.mock.calls[0][0]
    expect(arg.description).toBe('Cafetería')
    expect(arg.amount).toBe(50.25)
    expect(arg.currency).toBe('USD')
    expect(arg.submittedById).toBe('u1')
  })

  it('al someter llama createExpense y luego submitExpense', async () => {
    createExpense.mockResolvedValue({ id: 'e2' })
    submitExpense.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <ExpenseSubmissionForm
        projects={projects}
        tasks={tasks}
        submittedById="u1"
      />,
    )
    await user.type(screen.getByRole('textbox', { name: /Descripción/i }), 'Software')
    await user.type(screen.getByPlaceholderText('0.00'), '100')

    await user.click(screen.getByRole('button', { name: /Someter/i }))

    expect(createExpense).toHaveBeenCalled()
    expect(submitExpense).toHaveBeenCalledWith('e2')
  })

  it('valida importe inválido (alfanumérico) sin llamar la server action', async () => {
    const user = userEvent.setup()
    render(
      <ExpenseSubmissionForm
        projects={projects}
        tasks={tasks}
        submittedById="u1"
      />,
    )
    await user.type(screen.getByRole('textbox', { name: /Descripción/i }), 'X')
    await user.type(screen.getByPlaceholderText('0.00'), 'abc')
    await user.click(screen.getByRole('button', { name: /Guardar borrador/i }))

    expect(createExpense).not.toHaveBeenCalled()
    expect(screen.getByText(/Importe inválido/i)).toBeInTheDocument()
  })

  it('valida descripción vacía', async () => {
    const user = userEvent.setup()
    render(
      <ExpenseSubmissionForm
        projects={projects}
        tasks={tasks}
        submittedById="u1"
      />,
    )
    await user.type(screen.getByPlaceholderText('0.00'), '10')
    await user.click(screen.getByRole('button', { name: /Guardar borrador/i }))

    expect(createExpense).not.toHaveBeenCalled()
    expect(screen.getByText(/descripción es obligatoria/i)).toBeInTheDocument()
  })

  it('filtra el dropdown de tareas por proyecto seleccionado', () => {
    render(
      <ExpenseSubmissionForm
        projects={projects}
        tasks={tasks}
        submittedById="u1"
      />,
    )
    // Por defecto se selecciona p1 → debe mostrar t1 pero no t2.
    expect(screen.getByText('Comprar licencia')).toBeInTheDocument()
    expect(screen.queryByText('Hosting')).toBeNull()
  })

  it('muestra error de servidor si createExpense lanza', async () => {
    createExpense.mockRejectedValue(new Error('[INVALID_INPUT] desc'))
    const user = userEvent.setup()
    render(
      <ExpenseSubmissionForm
        projects={projects}
        tasks={tasks}
        submittedById="u1"
      />,
    )
    await user.type(screen.getByRole('textbox', { name: /Descripción/i }), 'X')
    await user.type(screen.getByPlaceholderText('0.00'), '10')
    await user.click(screen.getByRole('button', { name: /Guardar borrador/i }))

    // Esperar al next tick para que la transition resuelva.
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent(/INVALID_INPUT/i)
  })

  it('valida URL de recibo (debe ser http/https)', async () => {
    const user = userEvent.setup()
    render(
      <ExpenseSubmissionForm
        projects={projects}
        tasks={tasks}
        submittedById="u1"
      />,
    )
    await user.type(screen.getByRole('textbox', { name: /Descripción/i }), 'X')
    await user.type(screen.getByPlaceholderText('0.00'), '10')
    await user.type(
      screen.getByPlaceholderText('https://drive.google.com/...'),
      'ftp://invalid',
    )
    await user.click(screen.getByRole('button', { name: /Guardar borrador/i }))

    expect(createExpense).not.toHaveBeenCalled()
    expect(screen.getByText(/URL inválida/i)).toBeInTheDocument()
  })
})
