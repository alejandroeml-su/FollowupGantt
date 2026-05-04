import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { HardDeadlineField } from '@/components/tasks/HardDeadlineField'

describe('HardDeadlineField', () => {
  it('renderiza label y helper text', () => {
    render(<HardDeadlineField value="" onChange={() => {}} />)
    expect(screen.getByLabelText(/Vencimiento forzoso/i)).toBeInTheDocument()
    expect(
      screen.getByText(/violación en \/leveling/i),
    ).toBeInTheDocument()
  })

  it('expone input de tipo date con name por defecto "hardDeadline"', () => {
    render(<HardDeadlineField value="" onChange={() => {}} />)
    const input = screen.getByLabelText(/Vencimiento forzoso/i) as HTMLInputElement
    expect(input.type).toBe('date')
    expect(input.name).toBe('hardDeadline')
  })

  it('emite onChange cuando el usuario escribe una fecha', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<HardDeadlineField value="" onChange={onChange} />)
    const input = screen.getByLabelText(/Vencimiento forzoso/i)
    await user.type(input, '2026-12-31')
    expect(onChange).toHaveBeenCalled()
    // El último valor debe corresponder con un string ISO YYYY-MM-DD.
    expect(onChange).toHaveBeenLastCalledWith('2026-12-31')
  })

  it('muestra error si la fecha es anterior a startDate', () => {
    render(
      <HardDeadlineField
        value="2026-01-01"
        startDate="2026-06-01"
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      /no puede ser anterior al inicio/i,
    )
    const input = screen.getByLabelText(/Vencimiento forzoso/i)
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('NO muestra error si la fecha es igual o posterior al startDate', () => {
    render(
      <HardDeadlineField
        value="2026-06-01"
        startDate="2026-06-01"
        onChange={() => {}}
      />,
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('respeta el prop disabled', () => {
    render(<HardDeadlineField value="" onChange={() => {}} disabled />)
    expect(screen.getByLabelText(/Vencimiento forzoso/i)).toBeDisabled()
  })
})
