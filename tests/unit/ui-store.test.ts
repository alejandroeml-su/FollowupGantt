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
