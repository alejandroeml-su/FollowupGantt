import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/lib/stores/ui'

beforeEach(() => {
  useUIStore.setState({
    selectedIds: new Set(),
    drawerTaskId: null,
    commandPaletteOpen: false,
    shortcutsOverlayOpen: false,
    columnPrefs: {},
    criticalOnly: false,
    activeBaselineId: {},
    baselineTrendOpen: false,
  })
})

describe('uiStore · selección múltiple', () => {
  it('toggle sin additive reemplaza la selección', () => {
    const { toggleSelection } = useUIStore.getState()
    toggleSelection('a')
    toggleSelection('b')
    expect(Array.from(useUIStore.getState().selectedIds)).toEqual(['b'])
  })

  it('toggle con additive añade o quita', () => {
    const { toggleSelection } = useUIStore.getState()
    toggleSelection('a', true)
    toggleSelection('b', true)
    expect(useUIStore.getState().selectedIds.size).toBe(2)
    toggleSelection('a', true) // quita
    expect(useUIStore.getState().selectedIds.has('a')).toBe(false)
    expect(useUIStore.getState().selectedIds.has('b')).toBe(true)
  })

  it('clearSelection vacía', () => {
    useUIStore.getState().toggleSelection('x', true)
    useUIStore.getState().clearSelection()
    expect(useUIStore.getState().selectedIds.size).toBe(0)
  })
})

describe('uiStore · drawer', () => {
  it('openDrawer setea el id, closeDrawer lo limpia', () => {
    useUIStore.getState().openDrawer('t-42')
    expect(useUIStore.getState().drawerTaskId).toBe('t-42')
    useUIStore.getState().closeDrawer()
    expect(useUIStore.getState().drawerTaskId).toBe(null)
  })
})

describe('uiStore · columnPrefs', () => {
  it('mezcla patches sin perder claves previas', () => {
    useUIStore.getState().setColumnPrefs('TODO', { collapsed: true })
    useUIStore.getState().setColumnPrefs('TODO', { accent: '#ff0000' })
    expect(useUIStore.getState().columnPrefs.TODO).toEqual({
      collapsed: true,
      accent: '#ff0000',
    })
  })

  it('resetColumnPrefs elimina la entrada', () => {
    useUIStore.getState().setColumnPrefs('DONE', { collapsed: true })
    useUIStore.getState().resetColumnPrefs('DONE')
    expect(useUIStore.getState().columnPrefs.DONE).toBeUndefined()
  })

  it('wipOverride null significa "sin límite"', () => {
    useUIStore.getState().setColumnPrefs('REVIEW', { wipOverride: null })
    expect(useUIStore.getState().columnPrefs.REVIEW?.wipOverride).toBe(null)
  })
})

describe('uiStore · overlays', () => {
  it('toggleCommandPalette alterna', () => {
    useUIStore.getState().toggleCommandPalette()
    expect(useUIStore.getState().commandPaletteOpen).toBe(true)
    useUIStore.getState().toggleCommandPalette()
    expect(useUIStore.getState().commandPaletteOpen).toBe(false)
  })

  it('toggleCommandPalette(false) fuerza estado', () => {
    useUIStore.getState().toggleCommandPalette(true)
    useUIStore.getState().toggleCommandPalette(false)
    expect(useUIStore.getState().commandPaletteOpen).toBe(false)
  })
})

describe('uiStore · criticalOnly (HU-2.3)', () => {
  it('estado inicial false', () => {
    expect(useUIStore.getState().criticalOnly).toBe(false)
  })

  it('toggleCriticalOnly() alterna el flag', () => {
    useUIStore.getState().toggleCriticalOnly()
    expect(useUIStore.getState().criticalOnly).toBe(true)
    useUIStore.getState().toggleCriticalOnly()
    expect(useUIStore.getState().criticalOnly).toBe(false)
  })

  it('toggleCriticalOnly(true|false) fuerza estado explícito', () => {
    useUIStore.getState().toggleCriticalOnly(true)
    expect(useUIStore.getState().criticalOnly).toBe(true)
    useUIStore.getState().toggleCriticalOnly(true) // idempotente
    expect(useUIStore.getState().criticalOnly).toBe(true)
    useUIStore.getState().toggleCriticalOnly(false)
    expect(useUIStore.getState().criticalOnly).toBe(false)
  })

  it('persiste en localStorage vía partialize', async () => {
    // Activamos y forzamos la persistencia (zustand/persist es sync con
    // localStorage, pero exponemos rehydrate para reescribir el snapshot).
    useUIStore.getState().toggleCriticalOnly(true)
    // Persiste sincrónicamente — si el partialize no incluye la clave, el
    // snapshot no la traerá y este aserto fallaría.
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem('followup-ui') : null
    expect(raw).toBeTruthy()
    const parsed = raw ? JSON.parse(raw) : null
    expect(parsed?.state?.criticalOnly).toBe(true)
    // Asegura que selección/drawer NO se persiste (regresión defensiva).
    expect(parsed?.state?.selectedIds).toBeUndefined()
    expect(parsed?.state?.drawerTaskId).toBeUndefined()
  })
})

describe('uiStore · activeBaselineId (HU-3.2)', () => {
  it('estado inicial es objeto vacío', () => {
    expect(useUIStore.getState().activeBaselineId).toEqual({})
  })

  it('setActiveBaseline guarda baseline por proyecto', () => {
    useUIStore.getState().setActiveBaseline('proj-A', 'baseline-1')
    expect(useUIStore.getState().activeBaselineId['proj-A']).toBe('baseline-1')
  })

  it('mantiene selecciones independientes por proyecto (cross-project key)', () => {
    // R2 del backlog @PO: cambiar de proyecto NO debe leakear la baseline
    // del anterior. La clave compuesta lo garantiza naturalmente.
    useUIStore.getState().setActiveBaseline('proj-A', 'baseline-A1')
    useUIStore.getState().setActiveBaseline('proj-B', 'baseline-B7')
    const state = useUIStore.getState().activeBaselineId
    expect(state['proj-A']).toBe('baseline-A1')
    expect(state['proj-B']).toBe('baseline-B7')
    // Sobreescribir un proyecto no toca al otro.
    useUIStore.getState().setActiveBaseline('proj-A', 'baseline-A2')
    expect(useUIStore.getState().activeBaselineId['proj-A']).toBe('baseline-A2')
    expect(useUIStore.getState().activeBaselineId['proj-B']).toBe('baseline-B7')
  })

  it('setActiveBaseline(null) preserva la clave con valor null (estado "Ninguna")', () => {
    useUIStore.getState().setActiveBaseline('proj-A', 'baseline-1')
    useUIStore.getState().setActiveBaseline('proj-A', null)
    const state = useUIStore.getState().activeBaselineId
    expect('proj-A' in state).toBe(true)
    expect(state['proj-A']).toBeNull()
  })

  it('clearActiveBaseline elimina la clave del proyecto', () => {
    useUIStore.getState().setActiveBaseline('proj-A', 'baseline-1')
    useUIStore.getState().setActiveBaseline('proj-B', 'baseline-2')
    useUIStore.getState().clearActiveBaseline('proj-A')
    const state = useUIStore.getState().activeBaselineId
    expect('proj-A' in state).toBe(false)
    expect(state['proj-B']).toBe('baseline-2')
  })

  it('clearActiveBaseline en proyecto sin clave es no-op', () => {
    const before = useUIStore.getState().activeBaselineId
    useUIStore.getState().clearActiveBaseline('proj-inexistente')
    expect(useUIStore.getState().activeBaselineId).toBe(before)
  })

  it('persiste activeBaselineId en localStorage', () => {
    useUIStore.getState().setActiveBaseline('proj-A', 'baseline-xyz')
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem('followup-ui') : null
    expect(raw).toBeTruthy()
    const parsed = raw ? JSON.parse(raw) : null
    expect(parsed?.state?.activeBaselineId).toEqual({ 'proj-A': 'baseline-xyz' })
  })
})

describe('uiStore · baselineTrendOpen (HU-3.4)', () => {
  it('estado inicial false', () => {
    expect(useUIStore.getState().baselineTrendOpen).toBe(false)
  })

  it('toggleBaselineTrend() alterna el flag', () => {
    useUIStore.getState().toggleBaselineTrend()
    expect(useUIStore.getState().baselineTrendOpen).toBe(true)
    useUIStore.getState().toggleBaselineTrend()
    expect(useUIStore.getState().baselineTrendOpen).toBe(false)
  })

  it('toggleBaselineTrend(true|false) fuerza estado explícito', () => {
    useUIStore.getState().toggleBaselineTrend(true)
    expect(useUIStore.getState().baselineTrendOpen).toBe(true)
    useUIStore.getState().toggleBaselineTrend(false)
    expect(useUIStore.getState().baselineTrendOpen).toBe(false)
  })

  it('persiste baselineTrendOpen en localStorage', () => {
    useUIStore.getState().toggleBaselineTrend(true)
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem('followup-ui') : null
    const parsed = raw ? JSON.parse(raw) : null
    expect(parsed?.state?.baselineTrendOpen).toBe(true)
  })
})

// ─── R3.0-G · Coverage push: toggles + setters faltantes ─────────────

describe('uiStore · sidebar + mobile', () => {
  it('toggleSidebarCollapsed() alterna sin arg', () => {
    useUIStore.setState({ sidebarCollapsed: false })
    useUIStore.getState().toggleSidebarCollapsed()
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    useUIStore.getState().toggleSidebarCollapsed()
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
  })

  it('toggleSidebarCollapsed(true) fuerza estado', () => {
    useUIStore.getState().toggleSidebarCollapsed(true)
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
  })

  it('setMobileSidebarOpen actualiza flag', () => {
    useUIStore.getState().setMobileSidebarOpen(true)
    expect(useUIStore.getState().mobileSidebarOpen).toBe(true)
    useUIStore.getState().setMobileSidebarOpen(false)
    expect(useUIStore.getState().mobileSidebarOpen).toBe(false)
  })
})

describe('uiStore · filters expand/dateRange', () => {
  it('toggleFiltersExpanded() alterna sin arg', () => {
    useUIStore.setState({ filtersExpanded: true })
    useUIStore.getState().toggleFiltersExpanded()
    expect(useUIStore.getState().filtersExpanded).toBe(false)
    useUIStore.getState().toggleFiltersExpanded()
    expect(useUIStore.getState().filtersExpanded).toBe(true)
  })

  it('toggleFiltersExpanded(false) fuerza estado', () => {
    useUIStore.getState().toggleFiltersExpanded(false)
    expect(useUIStore.getState().filtersExpanded).toBe(false)
  })

  it('toggleFiltersDateRange() alterna sin arg', () => {
    useUIStore.setState({ filtersDateRangeOpen: false })
    useUIStore.getState().toggleFiltersDateRange()
    expect(useUIStore.getState().filtersDateRangeOpen).toBe(true)
    useUIStore.getState().toggleFiltersDateRange()
    expect(useUIStore.getState().filtersDateRangeOpen).toBe(false)
  })

  it('toggleFiltersDateRange(true) fuerza estado', () => {
    useUIStore.getState().toggleFiltersDateRange(true)
    expect(useUIStore.getState().filtersDateRangeOpen).toBe(true)
  })
})

describe('uiStore · shortcuts overlay + view + active workspace', () => {
  it('toggleShortcutsOverlay() alterna', () => {
    useUIStore.setState({ shortcutsOverlayOpen: false })
    useUIStore.getState().toggleShortcutsOverlay()
    expect(useUIStore.getState().shortcutsOverlayOpen).toBe(true)
    useUIStore.getState().toggleShortcutsOverlay(false)
    expect(useUIStore.getState().shortcutsOverlayOpen).toBe(false)
  })

  it('setView cambia la vista actual', () => {
    useUIStore.getState().setView('gantt')
    expect(useUIStore.getState().currentView).toBe('gantt')
    useUIStore.getState().setView('list')
    expect(useUIStore.getState().currentView).toBe('list')
  })

  it('setActiveWorkspaceId guarda y limpia', () => {
    useUIStore.getState().setActiveWorkspaceId('ws-42')
    expect(useUIStore.getState().activeWorkspaceId).toBe('ws-42')
    useUIStore.getState().setActiveWorkspaceId(null)
    expect(useUIStore.getState().activeWorkspaceId).toBeNull()
  })
})

describe('uiStore · activeView por superficie (Ola P2-1)', () => {
  it('setActiveView guarda viewId por surface', () => {
    useUIStore.getState().setActiveView('kanban', 'view-1')
    expect(useUIStore.getState().activeViewByPath.kanban).toBe('view-1')
  })

  it('clearActiveView resetea a null SIN tocar otras surfaces', () => {
    useUIStore.getState().setActiveView('list', 'view-list')
    useUIStore.getState().setActiveView('gantt', 'view-gantt')
    useUIStore.getState().clearActiveView('list')
    const v = useUIStore.getState().activeViewByPath
    expect(v.list).toBeNull()
    expect(v.gantt).toBe('view-gantt')
  })
})

describe('uiStore · onboarding tour + newTask (Wave P16-C)', () => {
  it('toggleOnboardingTour() alterna sin arg', () => {
    useUIStore.setState({ onboardingTourOpen: false })
    useUIStore.getState().toggleOnboardingTour()
    expect(useUIStore.getState().onboardingTourOpen).toBe(true)
    useUIStore.getState().toggleOnboardingTour()
    expect(useUIStore.getState().onboardingTourOpen).toBe(false)
  })

  it('toggleOnboardingTour(true) fuerza estado', () => {
    useUIStore.getState().toggleOnboardingTour(true)
    expect(useUIStore.getState().onboardingTourOpen).toBe(true)
  })

  it('requestNewTask actualiza newTaskRequestedAt con timestamp >0', () => {
    const before = useUIStore.getState().newTaskRequestedAt
    useUIStore.getState().requestNewTask()
    const after = useUIStore.getState().newTaskRequestedAt
    expect(after).not.toBe(before)
    expect(typeof after).toBe('number')
    expect(after).toBeGreaterThan(0)
  })
})

describe('uiStore · multi-selection helpers', () => {
  it('toggleManySelection con array vacío es no-op', () => {
    const before = useUIStore.getState().selectedIds
    useUIStore.getState().toggleManySelection([])
    expect(useUIStore.getState().selectedIds).toBe(before)
  })

  it('toggleManySelection (additive=false) reemplaza selección', () => {
    useUIStore.getState().toggleSelection('x', true)
    useUIStore.getState().toggleManySelection(['a', 'b'])
    const ids = Array.from(useUIStore.getState().selectedIds).sort()
    expect(ids).toEqual(['a', 'b'])
  })

  it('toggleManySelection additive: agrega si faltaban', () => {
    useUIStore.getState().toggleSelection('a', true)
    useUIStore.getState().toggleManySelection(['b', 'c'], true)
    const ids = Array.from(useUIStore.getState().selectedIds).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('toggleManySelection additive: deselecciona TODOS si ya estaban', () => {
    useUIStore.getState().toggleSelection('a', true)
    useUIStore.getState().toggleSelection('b', true)
    useUIStore.getState().toggleSelection('c', true)
    useUIStore.getState().toggleManySelection(['a', 'b'], true)
    const ids = Array.from(useUIStore.getState().selectedIds).sort()
    expect(ids).toEqual(['c'])
  })

  it('selectRange reemplaza con set de ids', () => {
    useUIStore.getState().toggleSelection('x', true)
    useUIStore.getState().selectRange(['a', 'b', 'c'])
    const ids = Array.from(useUIStore.getState().selectedIds).sort()
    expect(ids).toEqual(['a', 'b', 'c'])
  })
})
