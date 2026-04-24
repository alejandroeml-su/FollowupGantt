import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '@/lib/stores/ui'

beforeEach(() => {
  useUIStore.setState({
    selectedIds: new Set(),
    drawerTaskId: null,
    commandPaletteOpen: false,
    shortcutsOverlayOpen: false,
    columnPrefs: {},
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
