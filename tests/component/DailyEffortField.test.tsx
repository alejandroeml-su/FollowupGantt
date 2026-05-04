import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DailyEffortField } from '@/components/tasks/DailyEffortField'

describe('DailyEffortField', () => {
  it('renderiza label, helper y placeholder por defecto', () => {
    render(<DailyEffortField value="" onChange={() => {}} />)
    expect(
      screen.getByLabelText(/Esfuerzo diario \(horas\)/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/calcular carga de recursos en \/leveling/i),
    ).toBeInTheDocument()
    const input = screen.getByLabelText(
      /Esfuerzo diario/i,
    ) as HTMLInputElement
    expect(input.placeholder).toBe('8')
  })

  it('expone input number con step 0.5 y rango [0, 24]', () => {
    render(<DailyEffortField value="" onChange={() => {}} />)
    const input = screen.getByLabelText(
      /Esfuerzo diario/i,
    ) as HTMLInputElement
    expect(input.type).toBe('number')
    expect(input.step).toBe('0.5')
    expect(input.min).toBe('0')
    expect(input.max).toBe('24')
    expect(input.name).toBe('dailyEffortHours')
  })

  it('emite onChange con string al escribir', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<DailyEffortField value="" onChange={onChange} />)
    const input = screen.getByLabelText(/Esfuerzo diario/i)
    await user.type(input, '6')
    expect(onChange).toHaveBeenLastCalledWith('6')
  })

  it('marca error visual cuando el valor está fuera de rango (>24)', () => {
    render(<DailyEffortField value="30" onChange={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/entre 0 y 24/i)
    expect(screen.getByLabelText(/Esfuerzo diario/i)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('marca error visual cuando el valor es negativo', () => {
    render(<DailyEffortField value="-1" onChange={() => {}} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('NO marca error si el valor está vacío', () => {
    render(<DailyEffortField value="" onChange={() => {}} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
