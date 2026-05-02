import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Ola P1 · Equipo 3 — Tests de componente del formulario `FieldDefForm`.
 *
 * Mockeamos los server actions importados por el componente
 * (`createFieldDef` / `updateFieldDef`) para no tocar BD ni Next runtime.
 * Las aserciones validan que:
 *   1. El form auto-deriva la `key` desde el `label` mientras el usuario
 *      no la edite manualmente.
 *   2. Cuando el tipo es SELECT, aparecen los inputs de opciones.
 *   3. Al enviar con datos válidos, se llama al action correcto.
 *   4. Si el action lanza error tipado, se muestra el mensaje al usuario.
 */

const createFieldDefMock = vi.fn()
const updateFieldDefMock = vi.fn()

vi.mock('@/lib/actions/custom-fields', () => ({
  createFieldDef: (...args: unknown[]) => createFieldDefMock(...args),
  updateFieldDef: (...args: unknown[]) => updateFieldDefMock(...args),
}))

import { FieldDefForm, type FieldDefDraft } from '@/components/custom-fields/FieldDefForm'

beforeEach(() => {
  createFieldDefMock.mockReset()
  createFieldDefMock.mockResolvedValue({ id: 'def-1' })
  updateFieldDefMock.mockReset()
  updateFieldDefMock.mockResolvedValue({ id: 'def-1' })
})

describe('FieldDefForm', () => {
  it('auto-deriva la key desde el label cuando el usuario no la toca', async () => {
    const user = userEvent.setup()
    render(<FieldDefForm projectId="p1" />)

    const labelInput = screen.getByLabelText(/Etiqueta/i)
    await user.type(labelInput, 'Código de Cliente')

    const keyInput = screen.getByLabelText(/Clave/i) as HTMLInputElement
    await waitFor(() => {
      expect(keyInput.value).toBe('codigo_de_cliente')
    })
  })

  it('muestra inputs de opciones cuando el tipo es SELECT', async () => {
    const user = userEvent.setup()
    render(<FieldDefForm projectId="p1" />)

    // Cambiamos a SELECT y verificamos que aparece la sección de opciones.
    const typeSelect = screen.getByLabelText(/^Tipo/i)
    await user.selectOptions(typeSelect, 'SELECT')

    expect(screen.getByTestId('custom-field-options')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Agregar opción/i }),
    ).toBeInTheDocument()
  })

  it('invoca createFieldDef con datos válidos al enviar', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<FieldDefForm projectId="proj-99" onSaved={onSaved} />)

    await user.type(screen.getByLabelText(/Etiqueta/i), 'Prioridad ITIL')
    // type defaults TEXT — submit directo
    await user.click(screen.getByRole('button', { name: /Crear campo/i }))

    await waitFor(() => {
      expect(createFieldDefMock).toHaveBeenCalledTimes(1)
    })
    const [projectId, input] = createFieldDefMock.mock.calls[0]
    expect(projectId).toBe('proj-99')
    expect(input).toMatchObject({
      key: 'prioridad_itil',
      label: 'Prioridad ITIL',
      type: 'TEXT',
      required: false,
    })
    expect(onSaved).toHaveBeenCalledWith('def-1')
  })

  it('muestra el detalle del error cuando el action falla', async () => {
    createFieldDefMock.mockRejectedValueOnce(
      new Error('[FIELD_KEY_DUPLICATE] Ya existe un campo con esa key'),
    )
    const user = userEvent.setup()
    render(<FieldDefForm projectId="p1" />)

    await user.type(screen.getByLabelText(/Etiqueta/i), 'Centro de costo')
    await user.click(screen.getByRole('button', { name: /Crear campo/i }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/FIELD_KEY_DUPLICATE/)
  })

  it('en modo edición pre-pobla los campos y llama updateFieldDef', async () => {
    const initial: FieldDefDraft = {
      id: 'def-7',
      key: 'cliente',
      label: 'Cliente',
      type: 'TEXT',
      required: true,
      options: [],
    }
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<FieldDefForm projectId="p1" initial={initial} onSaved={onSaved} />)

    expect((screen.getByLabelText(/Etiqueta/i) as HTMLInputElement).value).toBe(
      'Cliente',
    )
    expect((screen.getByLabelText(/Clave/i) as HTMLInputElement).value).toBe(
      'cliente',
    )

    // Cambiamos label y guardamos.
    await user.clear(screen.getByLabelText(/Etiqueta/i))
    await user.type(screen.getByLabelText(/Etiqueta/i), 'Cliente principal')
    await user.click(screen.getByRole('button', { name: /Guardar cambios/i }))

    await waitFor(() => {
      expect(updateFieldDefMock).toHaveBeenCalledTimes(1)
    })
    expect(updateFieldDefMock).toHaveBeenCalledWith('def-7', expect.objectContaining({
      label: 'Cliente principal',
      key: 'cliente',
    }))
    expect(onSaved).toHaveBeenCalledWith('def-1')
  })
})
