import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

/**
 * Wave P6 · Equipo B3 — Tests de wiring del SoftLock + EditingByBanner +
 * ConflictDialog en `TaskDrawerContent`.
 *
 * Estrategia:
 *   - Mockeamos `useTaskEditLock` para controlar deterministamente el
 *     estado del lock sin levantar Supabase Realtime ni mockear el cliente.
 *   - Mockeamos los hijos pesados (`TaskForm`, secciones laterales) con
 *     stubs mínimos: el test se enfoca en el wiring de B3, no en la
 *     funcionalidad de cada subsección.
 *   - Verificamos:
 *       1. Sin peers editando → no hay banner ni dialog.
 *       2. Con peers editando + isLockedByOther=true → banner visible y el
 *          contenedor del form recibe `data-locked="true"`.
 *       3. ForceOverride invoca el callback del hook.
 *       4. Lifecycle: startEditing al montar, stopEditing al desmontar.
 *       5. ConflictDialog se abre en cuanto `hasConflict` es true.
 *       6. Resolución 'overwrite' llama dismissConflict y NO recarga.
 *       7. Resolución 'accept_remote' llama dismissConflict y reload.
 *       8. Sin currentUser ⇒ degradación: nada de presence/banner aunque
 *          el hook devuelva todo en cero.
 */

// ── Mocks de hijos pesados ─────────────────────────────────────────────
vi.mock('@/components/interactions/task-form/TaskForm', () => ({
  TaskForm: () => <div data-testid="task-form-stub" />,
  TaskFormHeaderActions: () => <div />,
}))
vi.mock('@/components/interactions/TaskDrawer', () => ({
  TaskBreadcrumbs: () => <div />,
}))
vi.mock('@/components/time-tracking/TaskTimeTrackingSection', () => ({
  TaskTimeTrackingSection: () => <div />,
}))
vi.mock('@/components/custom-fields/TaskCustomFieldsSection', () => ({
  TaskCustomFieldsSection: () => <div />,
}))
vi.mock('@/components/goals/TaskGoalsSection', () => ({
  TaskGoalsSection: () => <div />,
}))
vi.mock('@/components/docs/TaskDocsSection', () => ({
  TaskDocsSection: () => <div />,
}))
vi.mock('@/components/tasks/TaskAuditHistorySection', () => ({
  TaskAuditHistorySection: () => <div />,
}))
vi.mock('@/components/tasks/TaskInsightsSection', () => ({
  TaskInsightsSection: () => <div />,
}))

// ── Mock del hook combinado: la fuente de la verdad para el wiring B3 ──
type LockState = {
  editingUsers: { id: string; name: string }[]
  isLockedByOther: boolean
  isCurrentUserEditing: boolean
  startEditing: ReturnType<typeof vi.fn>
  stopEditing: ReturnType<typeof vi.fn>
  forceOverride: ReturnType<typeof vi.fn>
  isRealtimeAvailable: boolean
  hasConflict: boolean
  remoteVersion: string | null
  remoteAuthorId: string | null
  dismissConflict: ReturnType<typeof vi.fn>
  overrideTaken: boolean
}

let mockLock: LockState
const useTaskEditLockSpy = vi.fn(() => mockLock)

vi.mock('@/components/realtime-locks/useTaskEditLock', () => ({
  useTaskEditLock: (...args: unknown[]) => useTaskEditLockSpy(...args),
}))

// Reload mock
const reloadSpy = vi.fn()

beforeEach(() => {
  mockLock = {
    editingUsers: [],
    isLockedByOther: false,
    isCurrentUserEditing: false,
    startEditing: vi.fn(),
    stopEditing: vi.fn(),
    forceOverride: vi.fn(),
    isRealtimeAvailable: false,
    hasConflict: false,
    remoteVersion: null,
    remoteAuthorId: null,
    dismissConflict: vi.fn(),
    overrideTaken: false,
  }
  useTaskEditLockSpy.mockClear()
  reloadSpy.mockClear()
  // Stubear `location.reload` sin reasignar la propiedad completa
  // (jsdom prohíbe `location = ...`).
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

// Importamos DESPUÉS de los mocks (vi.mock se hoistea pero queremos
// claridad).
import { TaskDrawerContent } from '@/components/interactions/TaskDrawerContent'
import type { SerializedTask } from '@/lib/types'

const baseTask: SerializedTask = {
  id: 'task-1',
  mnemonic: 'T-001',
  title: 'Implementar B3',
  description: null,
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  type: 'TASK',
  progress: 50,
  isMilestone: false,
  startDate: null,
  endDate: null,
  assignee: { id: 'u-1', name: 'Ana' },
  project: { id: 'p-1', name: 'Avante' },
  projectId: 'p-1',
  assigneeId: 'u-1',
  updatedAt: '2026-05-04T10:00:00.000Z',
  createdAt: '2026-04-01T10:00:00.000Z',
}

const users = [
  { id: 'u-1', name: 'Ana' },
  { id: 'u-2', name: 'Pedro' },
]
const projects = [{ id: 'p-1', name: 'Avante' }]

describe('TaskDrawerContent · soft lock wiring (Wave P6 · B3)', () => {
  it('1. sin peers editando, no muestra banner ni ConflictDialog', () => {
    render(
      <TaskDrawerContent
        task={baseTask}
        projects={projects}
        users={users}
        currentUser={users[0]}
      />,
    )
    expect(screen.queryByTestId('editing-by-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('conflict-dialog')).not.toBeInTheDocument()
    // El form debería estar habilitado (no locked).
    const region = screen.getByTestId('task-drawer-form-region')
    expect(region.getAttribute('data-locked')).toBe('false')
  })

  it('2. con peer editando + isLockedByOther, muestra banner y marca region como locked', () => {
    mockLock.editingUsers = [{ id: 'u-2', name: 'Pedro' }]
    mockLock.isLockedByOther = true
    render(
      <TaskDrawerContent
        task={baseTask}
        projects={projects}
        users={users}
        currentUser={users[0]}
      />,
    )
    expect(screen.getByTestId('editing-by-banner')).toBeInTheDocument()
    expect(screen.getByTestId('editing-by-banner')).toHaveTextContent(/Pedro/)
    const region = screen.getByTestId('task-drawer-form-region')
    expect(region.getAttribute('data-locked')).toBe('true')
    expect(region.getAttribute('aria-disabled')).toBe('true')
  })

  it('3. el botón "Forzar edición" del banner invoca lock.forceOverride', () => {
    mockLock.editingUsers = [{ id: 'u-2', name: 'Pedro' }]
    mockLock.isLockedByOther = true
    render(
      <TaskDrawerContent
        task={baseTask}
        projects={projects}
        users={users}
        currentUser={users[0]}
      />,
    )
    fireEvent.click(screen.getByTestId('editing-by-banner-force'))
    expect(mockLock.forceOverride).toHaveBeenCalledTimes(1)
  })

  it('4. lifecycle: startEditing al montar y stopEditing al desmontar', () => {
    const { unmount } = render(
      <TaskDrawerContent
        task={baseTask}
        projects={projects}
        users={users}
        currentUser={users[0]}
      />,
    )
    expect(mockLock.startEditing).toHaveBeenCalledTimes(1)
    expect(mockLock.stopEditing).not.toHaveBeenCalled()
    unmount()
    expect(mockLock.stopEditing).toHaveBeenCalledTimes(1)
  })

  it('5. cuando hasConflict=true, el ConflictDialog se renderiza abierto', () => {
    mockLock.hasConflict = true
    mockLock.remoteVersion = '2026-05-04T11:00:00.000Z'
    mockLock.remoteAuthorId = 'u-2'
    render(
      <TaskDrawerContent
        task={baseTask}
        projects={projects}
        users={users}
        currentUser={users[0]}
      />,
    )
    expect(screen.getByTestId('conflict-dialog')).toBeInTheDocument()
    expect(
      screen.getByText(/Cambios remotos detectados/i),
    ).toBeInTheDocument()
  })

  it("6. resolución 'overwrite' llama dismissConflict y NO recarga la página", () => {
    mockLock.hasConflict = true
    mockLock.remoteVersion = '2026-05-04T11:00:00.000Z'
    render(
      <TaskDrawerContent
        task={baseTask}
        projects={projects}
        users={users}
        currentUser={users[0]}
      />,
    )
    fireEvent.click(screen.getByTestId('conflict-dialog-overwrite'))
    expect(mockLock.dismissConflict).toHaveBeenCalled()
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it("7. resolución 'accept_remote' llama dismissConflict y recarga la página", () => {
    mockLock.hasConflict = true
    mockLock.remoteVersion = '2026-05-04T11:00:00.000Z'
    render(
      <TaskDrawerContent
        task={baseTask}
        projects={projects}
        users={users}
        currentUser={users[0]}
      />,
    )
    fireEvent.click(screen.getByTestId('conflict-dialog-accept-remote'))
    expect(mockLock.dismissConflict).toHaveBeenCalled()
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('8. sin currentUser explícito, usa users[0] como fallback (convención del módulo)', () => {
    render(
      <TaskDrawerContent
        task={baseTask}
        projects={projects}
        users={users}
        // sin currentUser ⇒ debe caer en users[0]
      />,
    )
    expect(useTaskEditLockSpy).toHaveBeenCalled()
    const callArg = useTaskEditLockSpy.mock.calls[0]?.[0] as
      | { currentUser?: { id: string; name: string } | null }
      | undefined
    expect(callArg?.currentUser?.id).toBe('u-1')
  })

  it('9. cuando users está vacío y no hay currentUser, degrada a null y no rompe', () => {
    render(
      <TaskDrawerContent
        task={baseTask}
        projects={projects}
        users={[]}
      />,
    )
    const callArg = useTaskEditLockSpy.mock.calls[0]?.[0] as
      | { currentUser?: { id: string; name: string } | null }
      | undefined
    expect(callArg?.currentUser).toBeNull()
    // No banner ni dialog en este caso (sin peers ni conflict).
    expect(screen.queryByTestId('editing-by-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('conflict-dialog')).not.toBeInTheDocument()
  })
})
