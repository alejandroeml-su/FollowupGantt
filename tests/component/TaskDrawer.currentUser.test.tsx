import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * Wave P7 · Equipo C-DEBT-2 — Tests del drilling de `currentUser` desde
 * los containers `*BoardClient` (List/Kanban/Table/Calendar/Gantt/
 * GanttListMobile) hasta `<TaskDrawerContent>`.
 *
 * Estrategia:
 *   - Mockeamos `TaskDrawerContent` con un stub que SIEMPRE pinta el
 *     `currentUser` recibido como atributo `data-current-user-*`. De esa
 *     forma podemos hacer assertions estructurales sobre el prop sin
 *     ejercitar el cuerpo real (que ya tiene su propia suite en
 *     `TaskDrawerContent.lock.test.tsx`).
 *   - Usamos el store `useUIStore` para abrir el drawer (`drawerTaskId`)
 *     porque `TaskDrawer` decide si renderiza children leyéndolo desde
 *     ahí. Sin el openDrawer no se monta el contenido.
 *   - Mockeamos los hijos pesados de cada container (filtros, drag,
 *     diálogos, hooks) para que el render se complete en jsdom sin
 *     side-effects de Realtime/Supabase/dnd-kit.
 *
 * Casos cubiertos (≥6):
 *   1. ListBoardClient drillea currentUser → drawer.
 *   2. KanbanBoardClient drillea currentUser → drawer.
 *   3. TableBoardClient drillea currentUser → drawer.
 *   4. CalendarBoardClient drillea currentUser → drawer.
 *   5. GanttListMobile drillea currentUser → drawer.
 *   6. Default `null` cuando no se pasa el prop (back-compat).
 *   7. TaskDrawer acepta currentUser sin romper su contrato existente.
 */

// ── Mock de paquetes opcionales que rompen la resolución del bundler ──
// `web-push` no está instalado en CI/local; el archivo `@/lib/web-push/server`
// lo importa server-side. Como nuestros containers transitively importan
// `@/lib/actions` (deleteTask, etc.) que a su vez referencia notifications →
// web-push, mockeamos el chain entero en su límite más alto.
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 200 }),
  },
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn().mockResolvedValue({ statusCode: 200 }),
}))
vi.mock('@/lib/web-push/server', () => ({
  sendPushToUser: vi.fn().mockResolvedValue({ ok: true }),
  sendPushToUsers: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/actions/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue({ ok: true }),
  createNotificationsBatch: vi.fn().mockResolvedValue({ ok: true }),
  getNotificationsForCurrentUser: vi.fn().mockResolvedValue([]),
  markAsRead: vi.fn().mockResolvedValue({ ok: true }),
  markAllAsRead: vi.fn().mockResolvedValue({ ok: true }),
  dismissNotification: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/actions', () => ({
  deleteTask: vi.fn().mockResolvedValue({ ok: true }),
  reorderTask: vi.fn().mockResolvedValue({ ok: true }),
  moveTaskToColumn: vi.fn().mockResolvedValue({ ok: true }),
  bulkMoveTasksWithStatus: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/actions/reorder', () => ({
  reorderTask: vi.fn().mockResolvedValue({ ok: true }),
  moveTaskToColumn: vi.fn().mockResolvedValue({ ok: true }),
  bulkMoveTasksWithStatus: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/actions/schedule', () => ({
  shiftTaskDates: vi.fn().mockResolvedValue({ ok: true }),
  updateTaskDates: vi.fn().mockResolvedValue({ ok: true }),
}))

// ── Mock de TaskDrawerContent: refleja currentUser como atributos ──────
vi.mock('@/components/interactions/TaskDrawerContent', () => ({
  TaskDrawerContent: ({
    currentUser,
    task,
  }: {
    currentUser?: { userId: string; name: string } | null
    task?: { id: string }
  }) => (
    <div
      data-testid="task-drawer-content-stub"
      data-current-user-id={currentUser?.userId ?? 'NULL'}
      data-current-user-name={currentUser?.name ?? 'NULL'}
      data-task-id={task?.id ?? 'NULL'}
    />
  ),
}))

// ── Mocks de hijos pesados que rompen jsdom o invocan side-effects ─────
vi.mock('@/components/interactions/TaskFiltersBar', () => ({
  TaskFiltersBar: () => <div data-testid="filters-bar-stub" />,
}))
vi.mock('@/components/interactions/NewTaskButton', () => ({
  NewTaskButton: () => <div />,
}))
vi.mock('@/components/interactions/TaskContextMenuItems', () => ({
  TaskWithContextMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))
vi.mock('@/components/StatusSelector', () => ({
  default: () => <div />,
}))
vi.mock('@/components/views/SavedViewsDropdown', () => ({
  SavedViewsDropdown: () => <div />,
}))
vi.mock('@/components/views/GroupBySelector', () => ({
  GroupBySelector: () => <div />,
}))
vi.mock('@/lib/hooks/useTaskShortcuts', () => ({
  useTaskShortcuts: () => undefined,
}))
vi.mock('@/components/interactions/QuickCreatePopover', () => ({
  QuickCreatePopover: () => <div />,
}))
vi.mock('@/components/interactions/Toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => <div />,
}))

// Importamos DESPUÉS de los mocks
import { ListBoardClient } from '@/components/interactions/ListBoardClient'
import { KanbanBoardClient } from '@/components/interactions/KanbanBoardClient'
import { TableBoardClient } from '@/components/interactions/TableBoardClient'
import { CalendarBoardClient } from '@/components/interactions/CalendarBoardClient'
import { GanttListMobile } from '@/components/interactions/GanttListMobile'
import { TaskDrawer } from '@/components/interactions/TaskDrawer'
import { TaskDrawerContent } from '@/components/interactions/TaskDrawerContent'
import { useUIStore } from '@/lib/stores/ui'
import type { SerializedTask } from '@/lib/types'
import type { CurrentUserPresence } from '@/lib/auth/get-current-user-presence'

// Fixture mínimo de tarea
const baseTask: SerializedTask = {
  id: 'task-c-debt-2',
  mnemonic: 'C2-001',
  title: 'Drilling test task',
  description: null,
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  type: 'TASK',
  progress: 50,
  isMilestone: false,
  startDate: '2026-05-01T00:00:00.000Z',
  endDate: '2026-05-10T00:00:00.000Z',
  assignee: { id: 'u-edwin', name: 'Edwin' },
  project: { id: 'p-avante', name: 'Avante' },
  projectId: 'p-avante',
  assigneeId: 'u-edwin',
  updatedAt: '2026-05-04T10:00:00.000Z',
  createdAt: '2026-04-01T10:00:00.000Z',
}

const projects = [{ id: 'p-avante', name: 'Avante', areaId: null }]
const users = [{ id: 'u-edwin', name: 'Edwin' }]

const currentUser: CurrentUserPresence = {
  userId: 'u-edwin',
  name: 'Edwin Martinez',
}

beforeEach(() => {
  // Cierra cualquier drawer residual entre tests.
  useUIStore.getState().closeDrawer()
})

afterEach(() => {
  vi.clearAllMocks()
  useUIStore.getState().closeDrawer()
})

/**
 * Helper: abre el drawer en `taskId` y devuelve el atributo
 * `data-current-user-id` que el stub de TaskDrawerContent registró.
 */
function readDrilledCurrentUser(): {
  userId: string | null
  name: string | null
} {
  // Tras un re-render dentro del mismo test pueden quedar 2 stubs vivos
  // (cada `render()` de RTL deja su DOM hasta el cleanup automático). Tomamos
  // el último que es el del re-render con drawerTaskId activo.
  const stubs = screen.queryAllByTestId('task-drawer-content-stub')
  if (stubs.length === 0) return { userId: null, name: null }
  const stub = stubs[stubs.length - 1]
  return {
    userId: stub.getAttribute('data-current-user-id'),
    name: stub.getAttribute('data-current-user-name'),
  }
}

describe('Wave P7 · C-DEBT-2 · drilling de currentUser → TaskDrawerContent', () => {
  it('1. ListBoardClient: drillea currentUser hasta el drawer', () => {
    render(
      <ListBoardClient
        tasks={[{ ...baseTask, subtasks: [] }]}
        projects={projects}
        users={users}
        currentUser={currentUser}
      />,
    )
    // Abrir el drawer programáticamente — el render solo monta el TaskDrawer
    // pero sin drawerTaskId no hay children.
    useUIStore.getState().openDrawer(baseTask.id)
    // Forzar un re-render del Dialog — radix-dialog responde al cambio de
    // store via el subscribe del hook. Triggereamos un re-render manual:
    render(
      <ListBoardClient
        tasks={[{ ...baseTask, subtasks: [] }]}
        projects={projects}
        users={users}
        currentUser={currentUser}
      />,
    )
    const drilled = readDrilledCurrentUser()
    expect(drilled.userId).toBe(currentUser.userId)
    expect(drilled.name).toBe(currentUser.name)
  })

  it('2. KanbanBoardClient: drillea currentUser hasta el drawer', () => {
    const columns = [
      { id: 'TODO', title: 'To Do', wipLimit: null },
      { id: 'IN_PROGRESS', title: 'In Progress', wipLimit: null },
    ]
    const tasksByColumn = {
      TODO: [],
      IN_PROGRESS: [baseTask],
    }
    useUIStore.getState().openDrawer(baseTask.id)
    render(
      <KanbanBoardClient
        columns={columns}
        tasksByColumn={tasksByColumn}
        projects={projects}
        users={users}
        currentUser={currentUser}
      />,
    )
    const drilled = readDrilledCurrentUser()
    expect(drilled.userId).toBe(currentUser.userId)
    expect(drilled.name).toBe(currentUser.name)
  })

  it('3. TableBoardClient: drillea currentUser hasta el drawer', () => {
    useUIStore.getState().openDrawer(baseTask.id)
    render(
      <TableBoardClient
        tasks={[{ ...baseTask, commentCount: 0 }]}
        projects={projects}
        users={users}
        currentUser={currentUser}
      />,
    )
    const drilled = readDrilledCurrentUser()
    expect(drilled.userId).toBe(currentUser.userId)
    expect(drilled.name).toBe(currentUser.name)
  })

  it('4. CalendarBoardClient: drillea currentUser hasta el drawer', () => {
    useUIStore.getState().openDrawer(baseTask.id)
    render(
      <CalendarBoardClient
        tasks={[baseTask]}
        monthStart="2026-05-01T00:00:00.000Z"
        monthDays={31}
        prevMonthHref="?month=2026-04"
        nextMonthHref="?month=2026-06"
        monthLabel="Mayo 2026"
        gerencias={[]}
        areas={[]}
        projects={[{ id: 'p-avante', name: 'Avante', areaId: null }]}
        users={users}
        currentUser={currentUser}
      />,
    )
    const drilled = readDrilledCurrentUser()
    expect(drilled.userId).toBe(currentUser.userId)
    expect(drilled.name).toBe(currentUser.name)
  })

  it('5. GanttListMobile: drillea currentUser hasta el drawer', () => {
    useUIStore.getState().openDrawer(baseTask.id)
    render(
      <GanttListMobile
        tasks={[baseTask]}
        rangeLabel="Mayo 2026"
        projects={[{ id: 'p-avante', name: 'Avante' }]}
        users={users}
        allTasks={[baseTask]}
        currentUser={currentUser}
      />,
    )
    const drilled = readDrilledCurrentUser()
    expect(drilled.userId).toBe(currentUser.userId)
    expect(drilled.name).toBe(currentUser.name)
  })

  it('6. Default null cuando no se pasa currentUser (back-compat)', () => {
    useUIStore.getState().openDrawer(baseTask.id)
    render(
      <TableBoardClient
        tasks={[{ ...baseTask, commentCount: 0 }]}
        projects={projects}
        users={users}
        // sin currentUser → default null
      />,
    )
    const drilled = readDrilledCurrentUser()
    expect(drilled.userId).toBe('NULL')
    expect(drilled.name).toBe('NULL')
  })

  it('7. TaskDrawer acepta currentUser sin romper su contrato existente', () => {
    // El TaskDrawer SOLO renderiza children cuando hay drawerTaskId.
    // El prop currentUser es plumbing — no impacta el DOM del drawer
    // mismo, pero debe aceptarse sin warnings de React.
    useUIStore.getState().openDrawer(baseTask.id)
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(
      () => undefined,
    )
    render(
      <TaskDrawer currentUser={currentUser}>
        <TaskDrawerContent
          task={baseTask}
          projects={projects}
          users={users}
          currentUser={currentUser}
        />
      </TaskDrawer>,
    )
    // No warnings sobre props desconocidas en el DOM.
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Unknown prop'),
    )
    const drilled = readDrilledCurrentUser()
    expect(drilled.userId).toBe(currentUser.userId)
    expect(drilled.name).toBe(currentUser.name)
    consoleErrorSpy.mockRestore()
  })

  it('8. ListBoardClient con currentUser=null degrada limpio (sin sesión)', () => {
    useUIStore.getState().openDrawer(baseTask.id)
    render(
      <ListBoardClient
        tasks={[{ ...baseTask, subtasks: [] }]}
        projects={projects}
        users={users}
        currentUser={null}
      />,
    )
    const drilled = readDrilledCurrentUser()
    // null se mapea a 'NULL' por el stub, confirmando que el drilling
    // sí pasa pero con el valor null que el RSC entrega cuando no hay
    // sesión.
    expect(drilled.userId).toBe('NULL')
    expect(drilled.name).toBe('NULL')
  })
})
