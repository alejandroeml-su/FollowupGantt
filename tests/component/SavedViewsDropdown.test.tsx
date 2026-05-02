import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Ola P2 · Equipo P2-1 — Tests del SavedViewsDropdown.
 * Mockeamos las server actions y el store de UI para no depender de
 * persistencia ni BD.
 */

const createView = vi.fn()
const updateView = vi.fn()
const deleteView = vi.fn()
const setDefaultView = vi.fn()

vi.mock('@/lib/actions/saved-views', async () => {
  const actual = await vi.importActual<typeof import('@/lib/actions/saved-views')>(
    '@/lib/actions/saved-views',
  )
  return {
    ...actual,
    createView: (...args: unknown[]) => createView(...args),
    updateView: (...args: unknown[]) => updateView(...args),
    deleteView: (...args: unknown[]) => deleteView(...args),
    setDefaultView: (...args: unknown[]) => setDefaultView(...args),
  }
})

import {
  SavedViewsDropdown,
  type SavedViewSummary,
} from '@/components/views/SavedViewsDropdown'
import { useUIStore } from '@/lib/stores/ui'

const baseView = (over: Partial<SavedViewSummary>): SavedViewSummary => ({
  id: 'v1',
  name: 'Mi vista',
  isShared: false,
  isDefault: false,
  ownedByCurrentUser: true,
  filters: {},
  grouping: null,
  ...over,
})

beforeEach(() => {
  createView.mockReset()
  createView.mockResolvedValue({ id: 'new-view', name: 'Nueva' })
  updateView.mockReset()
  deleteView.mockReset()
  setDefaultView.mockReset()
  // Reset zustand store
  useUIStore.setState({
    activeViewByPath: {
      list: null,
      kanban: null,
      gantt: null,
      calendar: null,
      table: null,
    },
  })
})

describe('SavedViewsDropdown', () => {
  it('muestra "Vistas guardadas" cuando no hay vista activa', () => {
    render(
      <SavedViewsDropdown
        surface="LIST"
        views={[]}
        currentFilters={{}}
        onApplyView={() => {}}
      />,
    )
    expect(
      screen.getByTestId('saved-views-trigger'),
    ).toHaveTextContent(/Vistas guardadas/i)
  })

  it('abre el menú al click y muestra opciones', async () => {
    const user = userEvent.setup()
    const views = [
      baseView({ id: 'v1', name: 'Sprint actual' }),
      baseView({ id: 'v2', name: 'Compartida', ownedByCurrentUser: false, isShared: true }),
    ]
    render(
      <SavedViewsDropdown
        surface="LIST"
        views={views}
        currentFilters={{}}
        onApplyView={() => {}}
      />,
    )
    await user.click(screen.getByTestId('saved-views-trigger'))
    expect(screen.getByTestId('saved-views-menu')).toBeInTheDocument()
    expect(screen.getByTestId('saved-views-item-v1')).toBeInTheDocument()
    expect(screen.getByTestId('saved-views-item-v2')).toBeInTheDocument()
    expect(screen.getByTestId('saved-views-save-as')).toBeInTheDocument()
    expect(screen.getByTestId('saved-views-manage')).toBeInTheDocument()
  })

  it('aplica una vista al click llamando onApplyView', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const view = baseView({
      id: 'v1',
      name: 'Mi vista',
      filters: { status: 'TODO' },
      grouping: 'assignee',
    })
    render(
      <SavedViewsDropdown
        surface="LIST"
        views={[view]}
        currentFilters={{}}
        onApplyView={onApply}
      />,
    )
    await user.click(screen.getByTestId('saved-views-trigger'))
    await user.click(screen.getByTestId('saved-views-item-v1'))
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'v1', grouping: 'assignee' }),
    )
    // Persiste la vista activa en el store
    expect(useUIStore.getState().activeViewByPath.list).toBe('v1')
  })

  it('volver a "Vista por defecto" limpia activeViewByPath', async () => {
    const user = userEvent.setup()
    useUIStore.setState({
      activeViewByPath: {
        list: 'v1',
        kanban: null,
        gantt: null,
        calendar: null,
        table: null,
      },
    })
    const onApply = vi.fn()
    render(
      <SavedViewsDropdown
        surface="LIST"
        views={[baseView({ id: 'v1', name: 'X' })]}
        currentFilters={{}}
        onApplyView={onApply}
      />,
    )
    await user.click(screen.getByTestId('saved-views-trigger'))
    await user.click(screen.getByTestId('saved-views-default'))
    expect(onApply).toHaveBeenCalledWith(null)
    expect(useUIStore.getState().activeViewByPath.list).toBeNull()
  })

  it('expone trigger accesible con aria-haspopup=menu', () => {
    render(
      <SavedViewsDropdown
        surface="LIST"
        views={[]}
        currentFilters={{}}
        onApplyView={() => {}}
      />,
    )
    const trigger = screen.getByTestId('saved-views-trigger')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-label', 'Vistas guardadas')
  })
})
