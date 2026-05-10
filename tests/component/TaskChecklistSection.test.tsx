import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Wave C-debt-1 · Equipo C-DEBT-1 — Tests del componente
 * `TaskChecklistSection`. Cubre:
 *   - Render inicial (loading → empty → data).
 *   - Crear checklist nueva.
 *   - Toggle, eliminar, reorder items (con optimistic + rollback).
 *   - Añadir item con submit del form.
 *   - Mensaje de error cuando una server action lanza.
 */

// ─────────────────────────── Mocks ───────────────────────────

const getChecklistsForTaskMock = vi.fn()
const createChecklistMock = vi.fn()
const addChecklistItemMock = vi.fn()
const toggleChecklistItemMock = vi.fn()
const deleteChecklistItemMock = vi.fn()
const reorderChecklistItemsMock = vi.fn()

vi.mock('@/lib/actions/checklist', () => ({
  getChecklistsForTask: (...args: unknown[]) => getChecklistsForTaskMock(...args),
  createChecklist: (...args: unknown[]) => createChecklistMock(...args),
  addChecklistItem: (...args: unknown[]) => addChecklistItemMock(...args),
  toggleChecklistItem: (...args: unknown[]) => toggleChecklistItemMock(...args),
  deleteChecklistItem: (...args: unknown[]) => deleteChecklistItemMock(...args),
  reorderChecklistItems: (...args: unknown[]) =>
    reorderChecklistItemsMock(...args),
}))

import { TaskChecklistSection } from '@/components/tasks/TaskChecklistSection'

// ─────────────────────────── Fixtures ───────────────────────────

const NOW_ISO = '2026-05-04T10:00:00.000Z'

function makeItem(overrides: Partial<{
  id: string
  text: string
  done: boolean
  position: number
}> = {}) {
  return {
    id: overrides.id ?? 'cli-1',
    checklistId: 'cl-1',
    text: overrides.text ?? 'Item demo',
    done: overrides.done ?? false,
    position: overrides.position ?? 1,
    doneAt: null,
    doneById: null,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  }
}

function makeChecklist(items: ReturnType<typeof makeItem>[] = [], title = 'Demo') {
  return {
    id: 'cl-1',
    taskId: 't1',
    title,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    items,
  }
}

// ─────────────────────────── Reset ───────────────────────────

beforeEach(() => {
  getChecklistsForTaskMock.mockReset().mockResolvedValue([])
  createChecklistMock.mockReset()
  addChecklistItemMock.mockReset()
  toggleChecklistItemMock.mockReset()
  deleteChecklistItemMock.mockReset()
  reorderChecklistItemsMock.mockReset()
  // Suppress confirm() prompts; lo overrideamos por test cuando hace falta.
  vi.stubGlobal('confirm', () => true)
})

// ─────────────────────────── Tests ───────────────────────────

describe('TaskChecklistSection', () => {
  it('renderiza estado vacío cuando no hay checklists', async () => {
    render(<TaskChecklistSection taskId="t1" />)
    await waitFor(() =>
      expect(screen.getByTestId('task-checklist-empty')).toBeInTheDocument(),
    )
    expect(screen.getByText(/Aún no hay checklists/i)).toBeInTheDocument()
  })

  it('renderiza checklists con items cuando existen', async () => {
    getChecklistsForTaskMock.mockResolvedValueOnce([
      makeChecklist([makeItem({ id: 'cli-1', text: 'Definir alcance' })]),
    ])
    render(<TaskChecklistSection taskId="t1" />)
    await waitFor(() =>
      expect(screen.getByText('Definir alcance')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('task-checklist-list')).toBeInTheDocument()
    expect(screen.getByTestId('task-checklist-block-cl-1')).toBeInTheDocument()
  })

  it('muestra el contador done/total', async () => {
    getChecklistsForTaskMock.mockResolvedValueOnce([
      makeChecklist([
        makeItem({ id: 'cli-1', done: true }),
        makeItem({ id: 'cli-2', done: false, text: 'Otro' }),
      ]),
    ])
    render(<TaskChecklistSection taskId="t1" />)
    await waitFor(() =>
      expect(screen.getByTestId('task-checklist-progress-cl-1')).toHaveTextContent(
        /1\/2/,
      ),
    )
  })

  it('crea una nueva checklist al click en "Nueva checklist"', async () => {
    createChecklistMock.mockResolvedValueOnce(
      makeChecklist([], 'Checklist'),
    )
    render(<TaskChecklistSection taskId="t1" />)
    await waitFor(() =>
      expect(screen.getByTestId('task-checklist-empty')).toBeInTheDocument(),
    )

    await userEvent.click(screen.getByTestId('task-checklist-new'))
    await waitFor(() =>
      expect(createChecklistMock).toHaveBeenCalledWith({
        taskId: 't1',
        title: 'Checklist',
      }),
    )
    // Debe pintarse el bloque tras la creación.
    await waitFor(() =>
      expect(screen.getByTestId('task-checklist-block-cl-1')).toBeInTheDocument(),
    )
  })

  it('toggle del checkbox llama toggleChecklistItem y aplica optimistic', async () => {
    const item = makeItem({ id: 'cli-1', text: 'A', done: false })
    getChecklistsForTaskMock.mockResolvedValueOnce([makeChecklist([item])])
    toggleChecklistItemMock.mockResolvedValueOnce({ ...item, done: true })

    render(<TaskChecklistSection taskId="t1" />)
    const checkbox = await screen.findByLabelText('A')
    expect((checkbox as HTMLInputElement).checked).toBe(false)

    await userEvent.click(checkbox)

    await waitFor(() =>
      expect(toggleChecklistItemMock).toHaveBeenCalledWith({ itemId: 'cli-1' }),
    )
    await waitFor(() =>
      expect((screen.getByLabelText('A') as HTMLInputElement).checked).toBe(true),
    )
  })

  it('rollback en toggle si el server falla', async () => {
    const item = makeItem({ id: 'cli-1', text: 'A', done: false })
    getChecklistsForTaskMock.mockResolvedValueOnce([makeChecklist([item])])
    toggleChecklistItemMock.mockRejectedValueOnce(new Error('[FORBIDDEN] sin acceso'))

    render(<TaskChecklistSection taskId="t1" />)
    const checkbox = await screen.findByLabelText('A')

    await userEvent.click(checkbox)
    await waitFor(() =>
      expect(screen.getByTestId('task-checklist-error')).toBeInTheDocument(),
    )
    expect((screen.getByLabelText('A') as HTMLInputElement).checked).toBe(false)
  })

  it('elimina item con confirm aceptado', async () => {
    vi.stubGlobal('confirm', () => true)
    const item = makeItem({ id: 'cli-1', text: 'Borrar' })
    getChecklistsForTaskMock.mockResolvedValueOnce([makeChecklist([item])])
    deleteChecklistItemMock.mockResolvedValueOnce({ ok: true, itemId: 'cli-1' })

    render(<TaskChecklistSection taskId="t1" />)
    await screen.findByText('Borrar')
    await userEvent.click(screen.getByTestId('task-checklist-delete-cli-1'))

    await waitFor(() =>
      expect(deleteChecklistItemMock).toHaveBeenCalledWith({ itemId: 'cli-1' }),
    )
    await waitFor(() =>
      expect(screen.queryByText('Borrar')).not.toBeInTheDocument(),
    )
  })

  it('NO elimina si el usuario cancela el confirm', async () => {
    vi.stubGlobal('confirm', () => false)
    const item = makeItem({ id: 'cli-1', text: 'No borrar' })
    getChecklistsForTaskMock.mockResolvedValueOnce([makeChecklist([item])])

    render(<TaskChecklistSection taskId="t1" />)
    await screen.findByText('No borrar')
    await userEvent.click(screen.getByTestId('task-checklist-delete-cli-1'))

    expect(deleteChecklistItemMock).not.toHaveBeenCalled()
    expect(screen.getByText('No borrar')).toBeInTheDocument()
  })

  it('añadir item via formulario llama addChecklistItem', async () => {
    getChecklistsForTaskMock.mockResolvedValueOnce([makeChecklist([])])
    addChecklistItemMock.mockResolvedValueOnce(
      makeItem({ id: 'cli-new', text: 'Hola mundo', position: 1 }),
    )

    render(<TaskChecklistSection taskId="t1" />)
    const input = await screen.findByTestId('task-checklist-add-input-cl-1')

    await userEvent.type(input, 'Hola mundo')
    await userEvent.click(screen.getByTestId('task-checklist-add-submit-cl-1'))

    await waitFor(() =>
      expect(addChecklistItemMock).toHaveBeenCalledWith({
        checklistId: 'cl-1',
        text: 'Hola mundo',
      }),
    )
    await waitFor(() =>
      expect(screen.getByText('Hola mundo')).toBeInTheDocument(),
    )
  })

  it('el botón añadir está deshabilitado con texto vacío', async () => {
    getChecklistsForTaskMock.mockResolvedValueOnce([makeChecklist([])])
    render(<TaskChecklistSection taskId="t1" />)
    const submit = await screen.findByTestId('task-checklist-add-submit-cl-1')
    expect(submit).toBeDisabled()
  })

  it('mover hacia arriba llama reorderChecklistItems con orden nuevo', async () => {
    const items = [
      makeItem({ id: 'cli-1', text: 'A', position: 1 }),
      makeItem({ id: 'cli-2', text: 'B', position: 2 }),
      makeItem({ id: 'cli-3', text: 'C', position: 3 }),
    ]
    getChecklistsForTaskMock.mockResolvedValueOnce([makeChecklist(items)])
    reorderChecklistItemsMock.mockResolvedValueOnce({
      ok: true,
      checklistId: 'cl-1',
      count: 3,
    })

    render(<TaskChecklistSection taskId="t1" />)
    await screen.findByText('A')

    await userEvent.click(screen.getByTestId('task-checklist-up-cli-3'))
    await waitFor(() =>
      expect(reorderChecklistItemsMock).toHaveBeenCalledWith({
        checklistId: 'cl-1',
        itemIds: ['cli-1', 'cli-3', 'cli-2'],
      }),
    )
  })

  it('mover arriba en el primer item está deshabilitado', async () => {
    const items = [
      makeItem({ id: 'cli-1', text: 'A', position: 1 }),
      makeItem({ id: 'cli-2', text: 'B', position: 2 }),
    ]
    getChecklistsForTaskMock.mockResolvedValueOnce([makeChecklist(items)])
    render(<TaskChecklistSection taskId="t1" />)
    await screen.findByText('A')

    expect(screen.getByTestId('task-checklist-up-cli-1')).toBeDisabled()
    expect(screen.getByTestId('task-checklist-down-cli-2')).toBeDisabled()
  })

  it('muestra el error cuando getChecklistsForTask falla', async () => {
    getChecklistsForTaskMock.mockRejectedValueOnce(
      new Error('[FORBIDDEN] sin acceso'),
    )
    render(<TaskChecklistSection taskId="t1" />)
    await waitFor(() =>
      expect(screen.getByTestId('task-checklist-error')).toBeInTheDocument(),
    )
    expect(screen.getByText(/FORBIDDEN/)).toBeInTheDocument()
  })

  it('colapsa y expande el bloque de checklist', async () => {
    const items = [makeItem({ id: 'cli-1', text: 'Visible' })]
    getChecklistsForTaskMock.mockResolvedValueOnce([makeChecklist(items)])
    render(<TaskChecklistSection taskId="t1" />)
    await screen.findByText('Visible')

    const toggle = screen.getByTestId('task-checklist-toggle-cl-1')
    await userEvent.click(toggle)
    expect(screen.queryByText('Visible')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(screen.getByText('Visible')).toBeInTheDocument()
  })

  it('aria-label en checkbox refleja el texto del item', async () => {
    getChecklistsForTaskMock.mockResolvedValueOnce([
      makeChecklist([makeItem({ id: 'cli-1', text: 'Mi item especial' })]),
    ])
    render(<TaskChecklistSection taskId="t1" />)
    const cb = await screen.findByLabelText('Mi item especial')
    expect(cb.tagName).toBe('INPUT')
    expect((cb as HTMLInputElement).type).toBe('checkbox')
  })

  it('lista renderizada usa role="list"', async () => {
    getChecklistsForTaskMock.mockResolvedValueOnce([
      makeChecklist([makeItem({ id: 'cli-1' })]),
    ])
    render(<TaskChecklistSection taskId="t1" />)
    await screen.findByText('Item demo')
    expect(screen.getAllByRole('list').length).toBeGreaterThan(0)
  })

  it('muestra "Cargando…" mientras la lectura inicial corre', () => {
    // Promise que nunca resuelve para preservar el estado loading.
    getChecklistsForTaskMock.mockReturnValueOnce(new Promise(() => undefined))
    render(<TaskChecklistSection taskId="t1" />)
    expect(screen.getByText(/Cargando/i)).toBeInTheDocument()
  })

  it('muestra contador (N) en el header', async () => {
    getChecklistsForTaskMock.mockResolvedValueOnce([
      makeChecklist([makeItem()]),
      { ...makeChecklist([], 'Otra'), id: 'cl-2' },
    ])
    render(<TaskChecklistSection taskId="t1" />)
    await waitFor(() => expect(screen.getByText('(2)')).toBeInTheDocument())
  })
})
