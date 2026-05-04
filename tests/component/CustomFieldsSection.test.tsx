import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const setTaskFieldValueMock = vi.fn()
const clearTaskFieldValueMock = vi.fn()
const getFieldDefsForProjectMock = vi.fn()
const getTaskFieldValuesMock = vi.fn()

vi.mock('@/lib/actions/custom-fields', () => ({
  setTaskFieldValue: (...args: unknown[]) => setTaskFieldValueMock(...args),
  clearTaskFieldValue: (...args: unknown[]) =>
    clearTaskFieldValueMock(...args),
  getFieldDefsForProject: (...args: unknown[]) =>
    getFieldDefsForProjectMock(...args),
  getTaskFieldValues: (...args: unknown[]) =>
    getTaskFieldValuesMock(...args),
}))

import {
  CustomFieldsSection,
  type LoadedCustomFieldDef,
} from '@/components/tasks/CustomFieldsSection'

const TEXT_DEF: LoadedCustomFieldDef = {
  id: 'def-text',
  key: 'codigo_cliente',
  label: 'Código de cliente',
  type: 'TEXT',
  required: true,
  options: [],
  position: 1,
}

const NUMBER_DEF: LoadedCustomFieldDef = {
  id: 'def-num',
  key: 'horas_extra',
  label: 'Horas extra',
  type: 'NUMBER',
  required: false,
  options: [],
  position: 2,
}

const SELECT_DEF: LoadedCustomFieldDef = {
  id: 'def-sel',
  key: 'severidad',
  label: 'Severidad',
  type: 'SELECT',
  required: false,
  options: [
    { value: 'low', label: 'Baja' },
    { value: 'high', label: 'Alta' },
  ],
  position: 3,
}

const MULTI_DEF: LoadedCustomFieldDef = {
  id: 'def-multi',
  key: 'plataformas',
  label: 'Plataformas',
  type: 'MULTI_SELECT',
  required: false,
  options: [
    { value: 'web', label: 'Web' },
    { value: 'ios', label: 'iOS' },
    { value: 'android', label: 'Android' },
  ],
  position: 4,
}

const BOOL_DEF: LoadedCustomFieldDef = {
  id: 'def-bool',
  key: 'urgente',
  label: 'Urgente',
  type: 'BOOLEAN',
  required: false,
  options: [],
  position: 5,
}

const DATE_DEF: LoadedCustomFieldDef = {
  id: 'def-date',
  key: 'fecha_compromiso',
  label: 'Fecha compromiso',
  type: 'DATE',
  required: false,
  options: [],
  position: 6,
}

const URL_DEF: LoadedCustomFieldDef = {
  id: 'def-url',
  key: 'enlace_externo',
  label: 'Enlace externo',
  type: 'URL',
  required: false,
  options: [],
  position: 7,
}

beforeEach(() => {
  setTaskFieldValueMock.mockReset()
  clearTaskFieldValueMock.mockReset()
  getFieldDefsForProjectMock.mockReset()
  getTaskFieldValuesMock.mockReset()
  setTaskFieldValueMock.mockResolvedValue({ value: 'persisted' })
  clearTaskFieldValueMock.mockResolvedValue(undefined)
  getFieldDefsForProjectMock.mockResolvedValue([])
  getTaskFieldValuesMock.mockResolvedValue([])
})

describe('CustomFieldsSection', () => {
  it('no renderiza nada si no hay defs', () => {
    const { container } = render(
      <CustomFieldsSection
        projectId="p1"
        preloadedDefs={[]}
        preloadedValues={{}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('marca con asterisco las definiciones requeridas', () => {
    render(
      <CustomFieldsSection
        projectId="p1"
        preloadedDefs={[TEXT_DEF]}
        preloadedValues={{}}
      />,
    )
    const label = screen.getByText('Código de cliente')
    expect(label.parentElement?.textContent).toContain('*')
  })

  it('renderiza inputs por cada tipo soportado', () => {
    render(
      <CustomFieldsSection
        projectId="p1"
        preloadedDefs={[
          TEXT_DEF,
          NUMBER_DEF,
          SELECT_DEF,
          MULTI_DEF,
          BOOL_DEF,
          DATE_DEF,
          URL_DEF,
        ]}
        preloadedValues={{}}
      />,
    )
    expect(screen.getByTestId('custom-field-codigo_cliente')).toBeInTheDocument()
    expect(screen.getByTestId('custom-field-horas_extra')).toBeInTheDocument()
    expect(screen.getByTestId('custom-field-severidad')).toBeInTheDocument()
    expect(screen.getByTestId('custom-field-plataformas')).toBeInTheDocument()
    expect(screen.getByTestId('custom-field-urgente')).toBeInTheDocument()
    expect(screen.getByTestId('custom-field-fecha_compromiso')).toBeInTheDocument()
    expect(screen.getByTestId('custom-field-enlace_externo')).toBeInTheDocument()
  })

  it('en modo persisted llama a setTaskFieldValue al hacer blur en TEXT', async () => {
    const user = userEvent.setup()
    render(
      <CustomFieldsSection
        projectId="p1"
        taskId="t1"
        mode="persisted"
        preloadedDefs={[TEXT_DEF]}
        preloadedValues={{}}
      />,
    )
    const input = screen.getByLabelText(/Código de cliente/i)
    await user.type(input, 'ABC-001')
    await user.tab()
    await waitFor(() => {
      expect(setTaskFieldValueMock).toHaveBeenCalledWith(
        't1',
        'def-text',
        'ABC-001',
      )
    })
  })

  it('en modo pending NO llama al server: notifica al padre', async () => {
    const onValuesChange = vi.fn()
    const user = userEvent.setup()
    render(
      <CustomFieldsSection
        projectId="p1"
        mode="pending"
        preloadedDefs={[TEXT_DEF]}
        preloadedValues={{}}
        onValuesChange={onValuesChange}
      />,
    )
    const input = screen.getByLabelText(/Código de cliente/i)
    await user.type(input, 'XYZ')
    await user.tab()
    await waitFor(() => {
      expect(onValuesChange).toHaveBeenCalled()
    })
    expect(setTaskFieldValueMock).not.toHaveBeenCalled()
    const lastCall = onValuesChange.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >
    expect(lastCall['def-text']).toBe('XYZ')
  })

  it('persisted: clearTaskFieldValue cuando el campo opcional queda vacío', async () => {
    const user = userEvent.setup()
    render(
      <CustomFieldsSection
        projectId="p1"
        taskId="t1"
        mode="persisted"
        preloadedDefs={[NUMBER_DEF]}
        preloadedValues={{ 'def-num': 5 }}
      />,
    )
    const input = screen.getByLabelText(/Horas extra/i) as HTMLInputElement
    await user.clear(input)
    await user.tab()
    await waitFor(() => {
      expect(clearTaskFieldValueMock).toHaveBeenCalledWith('t1', 'def-num')
    })
  })

  it('SELECT cambia el valor al seleccionar opción', async () => {
    const user = userEvent.setup()
    render(
      <CustomFieldsSection
        projectId="p1"
        taskId="t1"
        mode="persisted"
        preloadedDefs={[SELECT_DEF]}
        preloadedValues={{}}
      />,
    )
    const select = screen.getByLabelText(/Severidad/i) as HTMLSelectElement
    await user.selectOptions(select, 'high')
    await waitFor(() => {
      expect(setTaskFieldValueMock).toHaveBeenCalledWith(
        't1',
        'def-sel',
        'high',
      )
    })
  })

  it('MULTI_SELECT (checkboxes): permite agregar varias opciones', async () => {
    const user = userEvent.setup()
    render(
      <CustomFieldsSection
        projectId="p1"
        taskId="t1"
        mode="persisted"
        preloadedDefs={[MULTI_DEF]}
        preloadedValues={{}}
      />,
    )
    const checkbox = screen.getByLabelText('Web')
    await user.click(checkbox)
    await waitFor(() => {
      const calls = setTaskFieldValueMock.mock.calls
      const last = calls.at(-1)
      expect(last?.[0]).toBe('t1')
      expect(last?.[1]).toBe('def-multi')
      expect(last?.[2]).toEqual(['web'])
    })
  })

  it('BOOLEAN: toggle dispara persistencia', async () => {
    const user = userEvent.setup()
    render(
      <CustomFieldsSection
        projectId="p1"
        taskId="t1"
        mode="persisted"
        preloadedDefs={[BOOL_DEF]}
        preloadedValues={{}}
      />,
    )
    const checkbox = screen.getByLabelText(/Urgente/i)
    await user.click(checkbox)
    await waitFor(() => {
      expect(setTaskFieldValueMock).toHaveBeenCalledWith(
        't1',
        'def-bool',
        true,
      )
    })
  })

  it('muestra error inline si setTaskFieldValue rechaza', async () => {
    setTaskFieldValueMock.mockRejectedValueOnce(
      new Error('[FIELD_VALUE_INVALID] no permitido'),
    )
    const user = userEvent.setup()
    render(
      <CustomFieldsSection
        projectId="p1"
        taskId="t1"
        mode="persisted"
        preloadedDefs={[TEXT_DEF]}
        preloadedValues={{}}
      />,
    )
    const input = screen.getByLabelText(/Código de cliente/i)
    await user.type(input, 'X')
    await user.tab()
    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent(/no permitido/i)
  })
})
