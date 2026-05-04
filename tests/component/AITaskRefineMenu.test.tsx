import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Wave P7 · Equipo P7-5 — Tests del componente `AITaskRefineMenu` y
 * `AISuggestionDialog`.
 *
 * Mockeamos las server actions de `@/lib/actions/task-refinement`
 * para no necesitar BD ni LLM real.
 */

const improveDescriptionAction = vi.fn()
const suggestChecklistAction = vi.fn()
const suggestTagsAction = vi.fn()
const detectDuplicatesAction = vi.fn()
const refineCategorizationAction = vi.fn()
const applyRefinementAction = vi.fn()

vi.mock('@/lib/actions/task-refinement', () => ({
  improveDescriptionAction: (...args: unknown[]) =>
    improveDescriptionAction(...args),
  suggestChecklistAction: (...args: unknown[]) =>
    suggestChecklistAction(...args),
  suggestTagsAction: (...args: unknown[]) => suggestTagsAction(...args),
  detectDuplicatesAction: (...args: unknown[]) =>
    detectDuplicatesAction(...args),
  refineCategorizationAction: (...args: unknown[]) =>
    refineCategorizationAction(...args),
  applyRefinementAction: (...args: unknown[]) =>
    applyRefinementAction(...args),
}))

import { AITaskRefineMenu } from '@/components/tasks/AITaskRefineMenu'

const baseProps = {
  taskId: 't-123',
  currentTask: {
    title: 'Mi tarea',
    description: 'Descripción inicial',
    type: 'AGILE_STORY',
    priority: 'MEDIUM',
    tags: ['frontend'],
  },
}

beforeEach(() => {
  improveDescriptionAction.mockReset()
  suggestChecklistAction.mockReset()
  suggestTagsAction.mockReset()
  detectDuplicatesAction.mockReset()
  refineCategorizationAction.mockReset()
  applyRefinementAction.mockReset()
})

describe('AITaskRefineMenu · render básico', () => {
  it('renderiza el botón trigger con texto IA', () => {
    render(<AITaskRefineMenu {...baseProps} />)
    const trigger = screen.getByTestId('ai-task-refine-trigger')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent(/IA/)
  })

  it('abre el dropdown al click y muestra los 5 items', () => {
    render(<AITaskRefineMenu {...baseProps} />)
    fireEvent.click(screen.getByTestId('ai-task-refine-trigger'))
    expect(
      screen.getByTestId('ai-task-refine-item-description'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('ai-task-refine-item-checklist'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('ai-task-refine-item-tags')).toBeInTheDocument()
    expect(
      screen.getByTestId('ai-task-refine-item-duplicates'),
    ).toBeInTheDocument()
    expect(
      screen.getByTestId('ai-task-refine-item-categorization'),
    ).toBeInTheDocument()
  })
})

describe('AITaskRefineMenu · flujo "Mejorar descripción"', () => {
  it('llama el action y abre el dialog con la sugerencia', async () => {
    improveDescriptionAction.mockResolvedValue({
      source: 'llm',
      data: {
        improvedDescription: 'Descripción mejorada por IA',
        acceptanceCriteria: ['Criterio A', 'Criterio B'],
        risks: ['Riesgo X'],
      },
    })
    render(<AITaskRefineMenu {...baseProps} />)
    fireEvent.click(screen.getByTestId('ai-task-refine-trigger'))
    fireEvent.click(screen.getByTestId('ai-task-refine-item-description'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-suggestion-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ai-suggested-description')).toHaveTextContent(
      'Descripción mejorada por IA',
    )
    expect(screen.getByTestId('ai-suggestion-source')).toHaveTextContent(
      /IA · Anthropic/,
    )
  })

  it('muestra "Heurística (LLM disabled)" cuando source=heuristic', async () => {
    improveDescriptionAction.mockResolvedValue({
      source: 'heuristic',
      data: {
        improvedDescription: 'Descripción heurística',
        acceptanceCriteria: ['c1'],
        risks: ['r1'],
      },
      fallbackReason: 'ANTHROPIC_API_KEY no configurada',
    })
    render(<AITaskRefineMenu {...baseProps} />)
    fireEvent.click(screen.getByTestId('ai-task-refine-trigger'))
    fireEvent.click(screen.getByTestId('ai-task-refine-item-description'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-suggestion-source')).toHaveTextContent(
        /Heurística/,
      )
    })
  })
})

describe('AITaskRefineMenu · aplicar sugerencia', () => {
  it('aplica la descripción exitosamente y cierra el dialog', async () => {
    improveDescriptionAction.mockResolvedValue({
      source: 'llm',
      data: {
        improvedDescription: 'Mejorada',
        acceptanceCriteria: [],
        risks: [],
      },
    })
    applyRefinementAction.mockResolvedValue({
      ok: true,
      taskId: 't-123',
      applied: ['description'],
    })
    render(<AITaskRefineMenu {...baseProps} />)
    fireEvent.click(screen.getByTestId('ai-task-refine-trigger'))
    fireEvent.click(screen.getByTestId('ai-task-refine-item-description'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-suggestion-dialog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('ai-suggestion-apply'))
    await waitFor(() => {
      expect(applyRefinementAction).toHaveBeenCalledWith({
        taskId: 't-123',
        kind: 'description',
        payload: { description: 'Mejorada' },
      })
    })
    await waitFor(() => {
      expect(screen.queryByTestId('ai-suggestion-dialog')).toBeNull()
    })
  })

  it('muestra error si applyRefinementAction devuelve ok:false', async () => {
    improveDescriptionAction.mockResolvedValue({
      source: 'llm',
      data: {
        improvedDescription: 'Mejorada',
        acceptanceCriteria: [],
        risks: [],
      },
    })
    applyRefinementAction.mockResolvedValue({
      ok: false,
      error: '[INVALID_INPUT] descripción vacía',
    })
    render(<AITaskRefineMenu {...baseProps} />)
    fireEvent.click(screen.getByTestId('ai-task-refine-trigger'))
    fireEvent.click(screen.getByTestId('ai-task-refine-item-description'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-suggestion-dialog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('ai-suggestion-apply'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-suggestion-error')).toHaveTextContent(
        /INVALID_INPUT/,
      )
    })
  })
})

describe('AITaskRefineMenu · duplicados', () => {
  it('muestra empty state cuando no hay candidatos', async () => {
    detectDuplicatesAction.mockResolvedValue({
      source: 'llm',
      data: { candidates: [] },
    })
    render(<AITaskRefineMenu {...baseProps} />)
    fireEvent.click(screen.getByTestId('ai-task-refine-trigger'))
    fireEvent.click(screen.getByTestId('ai-task-refine-item-duplicates'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-duplicates-empty')).toBeInTheDocument()
    })
  })

  it('lista candidatos y permite hacer merge', async () => {
    detectDuplicatesAction.mockResolvedValue({
      source: 'llm',
      data: {
        candidates: [
          { taskId: 'twin-1', similarity: 0.92, reason: 'casi igual' },
        ],
      },
    })
    applyRefinementAction.mockResolvedValue({
      ok: true,
      taskId: 't-123',
      applied: ['merge_duplicate'],
    })
    render(<AITaskRefineMenu {...baseProps} />)
    fireEvent.click(screen.getByTestId('ai-task-refine-trigger'))
    fireEvent.click(screen.getByTestId('ai-task-refine-item-duplicates'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-duplicates-list')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('ai-suggestion-apply'))
    await waitFor(() => {
      expect(applyRefinementAction).toHaveBeenCalledWith({
        taskId: 't-123',
        kind: 'merge_duplicate',
        payload: { canonicalId: 'twin-1' },
      })
    })
  })
})

describe('AITaskRefineMenu · errores', () => {
  it('muestra mensaje cuando el action lanza', async () => {
    suggestChecklistAction.mockRejectedValue(new Error('[NOT_FOUND] task'))
    render(<AITaskRefineMenu {...baseProps} />)
    fireEvent.click(screen.getByTestId('ai-task-refine-trigger'))
    fireEvent.click(screen.getByTestId('ai-task-refine-item-checklist'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-task-refine-error')).toHaveTextContent(
        /NOT_FOUND/,
      )
    })
  })
})

describe('AITaskRefineMenu · descartar', () => {
  it('cierra el dialog sin aplicar', async () => {
    suggestTagsAction.mockResolvedValue({
      source: 'llm',
      data: { tags: [{ tag: 'frontend', reused: true }] },
    })
    render(<AITaskRefineMenu {...baseProps} />)
    fireEvent.click(screen.getByTestId('ai-task-refine-trigger'))
    fireEvent.click(screen.getByTestId('ai-task-refine-item-tags'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-suggestion-dialog')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('ai-suggestion-dismiss'))
    await waitFor(() => {
      expect(screen.queryByTestId('ai-suggestion-dialog')).toBeNull()
    })
    expect(applyRefinementAction).not.toHaveBeenCalled()
  })
})
