import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Wave P7 · P7-2 — Tests del componente `WBSGeneratorDialog`.
 *
 * Mockeamos las server actions (`@/lib/actions/wbs-generator`,
 * `@/lib/actions/wbs-import`) para controlar el flujo de estados:
 *   idle → generating → preview → applying → done.
 */

const generateMock = vi.fn()
const applyMock = vi.fn()

vi.mock('@/lib/actions/wbs-generator', () => ({
  generateWBSFromBrief: (...args: unknown[]) => generateMock(...args),
}))
vi.mock('@/lib/actions/wbs-import', () => ({
  applyGeneratedWBS: (...args: unknown[]) => applyMock(...args),
}))

import { WBSGeneratorDialog } from '@/components/projects/WBSGeneratorDialog'

const wbsResult = {
  wbs: {
    projectName: 'CRM',
    description: 'Demo',
    estimatedDurationDays: 60,
    phases: [
      {
        name: 'Discovery',
        order: 0,
        tasks: [
          { title: 'Levantamiento', type: 'PMI_TASK', estimatedDays: 5, priority: 'HIGH' },
          {
            title: 'Diseño',
            type: 'PMI_TASK',
            estimatedDays: 5,
            priority: 'HIGH',
            dependsOn: ['Levantamiento'],
            children: [
              { title: 'Mockups', type: 'PMI_TASK', estimatedDays: 3, priority: 'MEDIUM' },
            ],
          },
        ],
      },
    ],
  },
  source: 'llm' as const,
  warnings: [] as string[],
  tokensUsed: 100,
  fromCache: false,
  provider: 'mock',
}

beforeEach(() => {
  generateMock.mockReset()
  applyMock.mockReset()
})

describe('WBSGeneratorDialog', () => {
  it('no renderiza contenido cuando open=false', () => {
    render(<WBSGeneratorDialog open={false} onOpenChange={() => {}} />)
    expect(screen.queryByTestId('wbs-generator-dialog')).not.toBeInTheDocument()
  })

  it('renderiza el formulario inicial con título y textarea', () => {
    render(<WBSGeneratorDialog open onOpenChange={() => {}} />)
    expect(screen.getByText(/Generar WBS con IA/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Brief del proyecto/i)).toBeInTheDocument()
  })

  it('deshabilita el botón Generar si el brief es muy corto', () => {
    render(<WBSGeneratorDialog open onOpenChange={() => {}} />)
    const btn = screen.getByRole('button', { name: /^Generar$/i })
    expect(btn).toBeDisabled()
  })

  it('llama generateWBSFromBrief y muestra preview con los datos', async () => {
    generateMock.mockResolvedValue(wbsResult)
    const user = userEvent.setup()
    render(<WBSGeneratorDialog open onOpenChange={() => {}} targetProjectId="p-1" />)

    const textarea = screen.getByLabelText(/Brief del proyecto/i)
    await user.type(textarea, 'Implementar un CRM con módulo de ventas y soporte')
    await user.click(screen.getByRole('button', { name: /^Generar$/i }))

    await waitFor(() => {
      expect(generateMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByTestId('wbs-preview')).toBeInTheDocument()
    })
    expect(screen.getByText(/CRM/)).toBeInTheDocument()
    expect(screen.getByText(/60 días/)).toBeInTheDocument()
  })

  it('muestra mensaje de error cuando la action lanza', async () => {
    generateMock.mockRejectedValue(new Error('[INVALID_INPUT] mal'))
    const user = userEvent.setup()
    render(<WBSGeneratorDialog open onOpenChange={() => {}} targetProjectId="p-1" />)
    const textarea = screen.getByLabelText(/Brief del proyecto/i)
    await user.type(textarea, 'Implementar CRM con módulo de ventas')
    await user.click(screen.getByRole('button', { name: /^Generar$/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/INVALID_INPUT/i)
    })
  })

  it('aplica el WBS y muestra estado "done" tras éxito', async () => {
    generateMock.mockResolvedValue(wbsResult)
    applyMock.mockResolvedValue({
      projectId: 'p-1',
      projectCreated: true,
      phaseCount: 1,
      taskCount: 3,
      dependencyCount: 1,
      titleToId: { levantamiento: 't-1' },
      warnings: [],
    })
    const user = userEvent.setup()
    render(<WBSGeneratorDialog open onOpenChange={() => {}} targetProjectId="p-1" />)
    await user.type(
      screen.getByLabelText(/Brief del proyecto/i),
      'Implementar CRM con módulo de ventas y soporte',
    )
    await user.click(screen.getByRole('button', { name: /^Generar$/i }))
    await waitFor(() => screen.getByTestId('wbs-preview'))
    await user.click(screen.getByRole('button', { name: /Aplicar a proyecto/i }))
    await waitFor(() => {
      expect(applyMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(screen.getByText(/aplicado exitosamente/i)).toBeInTheDocument()
    })
  })

  it('botón Descartar regresa al estado idle', async () => {
    generateMock.mockResolvedValue(wbsResult)
    const user = userEvent.setup()
    render(<WBSGeneratorDialog open onOpenChange={() => {}} targetProjectId="p-1" />)
    await user.type(
      screen.getByLabelText(/Brief del proyecto/i),
      'Implementar CRM con módulo de ventas y soporte',
    )
    await user.click(screen.getByRole('button', { name: /^Generar$/i }))
    await waitFor(() => screen.getByTestId('wbs-preview'))
    await user.click(screen.getByRole('button', { name: /Descartar/i }))
    await waitFor(() => {
      expect(screen.queryByTestId('wbs-preview')).not.toBeInTheDocument()
    })
    // Volvió al formulario.
    expect(screen.getByLabelText(/Brief del proyecto/i)).toBeInTheDocument()
  })

  it('muestra etiqueta de fuente "Heurística" cuando source=heuristic', async () => {
    generateMock.mockResolvedValue({
      ...wbsResult,
      source: 'heuristic',
      templateId: 'software-project',
      llmError: 'timeout',
    })
    const user = userEvent.setup()
    render(<WBSGeneratorDialog open onOpenChange={() => {}} targetProjectId="p-1" />)
    await user.type(
      screen.getByLabelText(/Brief del proyecto/i),
      'Implementar CRM con módulo de ventas',
    )
    await user.click(screen.getByRole('button', { name: /^Generar$/i }))
    await waitFor(() => screen.getByTestId('wbs-preview'))
    expect(screen.getByText(/Heurística/i)).toBeInTheDocument()
    expect(screen.getByText(/timeout/i)).toBeInTheDocument()
  })

  it('muestra advertencias acumuladas en el preview', async () => {
    generateMock.mockResolvedValue({
      ...wbsResult,
      warnings: ['Dependencia rota: A → B'],
    })
    const user = userEvent.setup()
    render(<WBSGeneratorDialog open onOpenChange={() => {}} targetProjectId="p-1" />)
    await user.type(
      screen.getByLabelText(/Brief del proyecto/i),
      'Implementar CRM con módulo de ventas',
    )
    await user.click(screen.getByRole('button', { name: /^Generar$/i }))
    await waitFor(() => screen.getByTestId('wbs-preview'))
    expect(screen.getByText(/1 advertencia/i)).toBeInTheDocument()
  })
})
