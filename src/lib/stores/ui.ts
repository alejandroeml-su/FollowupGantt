'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

type View = 'list' | 'kanban' | 'gantt' | 'calendar' | 'table' | 'workload'

/**
 * Ola P2 · Equipo P2-1 — superficies que aceptan vistas guardadas.
 * Mantenemos en lowercase aquí (matching con `currentView`) y mapeamos al
 * enum `ViewSurface` (UPPER) en la frontera con server actions.
 */
export type SavedViewSurface = 'list' | 'kanban' | 'gantt' | 'calendar' | 'table'

export type ColumnPrefs = {
  collapsed?: boolean
  accent?: string           // hex color
  wipOverride?: number | null // null = sin límite; undefined = usar default
}

type UIState = {
  selectedIds: Set<string>
  drawerTaskId: string | null
  commandPaletteOpen: boolean
  shortcutsOverlayOpen: boolean
  currentView: View
  columnPrefs: Record<string, ColumnPrefs>
  mobileSidebarOpen: boolean
  sidebarCollapsed: boolean
  /** HU-2.3 — toggle global "Mostrar solo ruta crítica" en Gantt. */
  criticalOnly: boolean
  /**
   * HU-3.2 — selección de línea base activa por proyecto. Clave compuesta
   * (projectId) para evitar leakage cross-project (R2 del backlog @PO):
   * cuando el usuario cambia el filtro de proyecto, la baseline activa
   * del proyecto anterior NO se aplica automáticamente al nuevo, sino
   * que cada proyecto recuerda su propia selección.
   *
   * `null` significa "Ninguna" explícitamente (overlay oculto en HU-3.3).
   * `undefined` (clave ausente) significa "no se ha tocado el selector
   * para ese proyecto" — se trata igual que `null` en el cliente.
   */
  activeBaselineId: Record<string, string | null>
  /**
   * HU-3.4 — abierto/cerrado del panel lateral "Evolución SV/SPI".
   * Persistido para que el usuario reabra la sesión con la misma vista.
   * Default `false` (panel colapsado en la primera carga).
   */
  baselineTrendOpen: boolean
  /**
   * Ola P2 · Equipo P2-1 — vista guardada activa por superficie. Permite
   * que la última vista seleccionada por el usuario sobreviva al refresh.
   * `null` = vista "Default" (sin SavedView aplicada). Indexado por
   * superficie para que cambiar de tablero no pierda la vista anterior.
   */
  activeViewByPath: Record<SavedViewSurface, string | null>
  /**
   * Ola P4 · Equipo P4-1 — id del workspace activo. Hidratado desde la
   * cookie `x-active-workspace` (httpOnly=false) para que el switcher
   * pueda mostrar el slug sin un round-trip al server. La autoridad real
   * vive en `requireWorkspaceAccess` (server-only). `null` = usar el
   * workspace por defecto del usuario (resuelto en server).
   */
  activeWorkspaceId: string | null

  toggleSelection: (id: string, additive?: boolean) => void
  selectRange: (ids: string[]) => void
  clearSelection: () => void
  openDrawer: (id: string) => void
  closeDrawer: () => void
  toggleCommandPalette: (open?: boolean) => void
  toggleShortcutsOverlay: (open?: boolean) => void
  setView: (v: View) => void
  setColumnPrefs: (id: string, patch: Partial<ColumnPrefs>) => void
  resetColumnPrefs: (id: string) => void
  setMobileSidebarOpen: (open: boolean) => void
  toggleSidebarCollapsed: (collapsed?: boolean) => void
  toggleCriticalOnly: (on?: boolean) => void
  setActiveBaseline: (projectId: string, baselineId: string | null) => void
  clearActiveBaseline: (projectId: string) => void
  toggleBaselineTrend: (open?: boolean) => void
  setActiveView: (surface: SavedViewSurface, viewId: string | null) => void
  clearActiveView: (surface: SavedViewSurface) => void
  setActiveWorkspaceId: (workspaceId: string | null) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      selectedIds: new Set<string>(),
      drawerTaskId: null,
      commandPaletteOpen: false,
      shortcutsOverlayOpen: false,
      currentView: 'list',
      columnPrefs: {},
      mobileSidebarOpen: false,
      sidebarCollapsed: false,
      criticalOnly: false,
      activeBaselineId: {},
      baselineTrendOpen: false,
      activeViewByPath: {
        list: null,
        kanban: null,
        gantt: null,
        calendar: null,
        table: null,
      },
      activeWorkspaceId: null,

      toggleSelection: (id, additive = false) =>
        set((s) => {
          const next = new Set(additive ? s.selectedIds : [])
          if (additive && s.selectedIds.has(id)) next.delete(id)
          else next.add(id)
          return { selectedIds: next }
        }),
      selectRange: (ids) => set({ selectedIds: new Set(ids) }),
      clearSelection: () => set({ selectedIds: new Set() }),
      openDrawer: (id) => set({ drawerTaskId: id }),
      closeDrawer: () => set({ drawerTaskId: null }),
      toggleCommandPalette: (open) =>
        set((s) => ({ commandPaletteOpen: open ?? !s.commandPaletteOpen })),
      toggleShortcutsOverlay: (open) =>
        set((s) => ({ shortcutsOverlayOpen: open ?? !s.shortcutsOverlayOpen })),
      setView: (v) => set({ currentView: v }),
      setColumnPrefs: (id, patch) =>
        set((s) => ({
          columnPrefs: {
            ...s.columnPrefs,
            [id]: { ...s.columnPrefs[id], ...patch },
          },
        })),
      resetColumnPrefs: (id) =>
        set((s) => {
          const next = { ...s.columnPrefs }
          delete next[id]
          return { columnPrefs: next }
        }),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      toggleSidebarCollapsed: (collapsed) =>
        set((s) => ({ sidebarCollapsed: collapsed ?? !s.sidebarCollapsed })),
      toggleCriticalOnly: (on) =>
        set((s) => ({ criticalOnly: on ?? !s.criticalOnly })),
      setActiveBaseline: (projectId, baselineId) =>
        set((s) => ({
          activeBaselineId: {
            ...s.activeBaselineId,
            [projectId]: baselineId,
          },
        })),
      clearActiveBaseline: (projectId) =>
        set((s) => {
          // Borramos la clave en lugar de setear `null` para evitar que el
          // diccionario crezca indefinidamente con proyectos visitados.
          // Para el cliente "no presente" === "null" (ver activeBaselineId).
          if (!(projectId in s.activeBaselineId)) return {}
          const next = { ...s.activeBaselineId }
          delete next[projectId]
          return { activeBaselineId: next }
        }),
      toggleBaselineTrend: (open) =>
        set((s) => ({ baselineTrendOpen: open ?? !s.baselineTrendOpen })),
      setActiveView: (surface, viewId) =>
        set((s) => ({
          activeViewByPath: {
            ...s.activeViewByPath,
            [surface]: viewId,
          },
        })),
      clearActiveView: (surface) =>
        set((s) => ({
          activeViewByPath: {
            ...s.activeViewByPath,
            [surface]: null,
          },
        })),
      setActiveWorkspaceId: (workspaceId) =>
        set({ activeWorkspaceId: workspaceId }),
    }),
    {
      name: 'followup-ui',
      storage: createJSONStorage(() => localStorage),
      // Sólo persistimos preferencias visuales, no la selección ni el drawer.
      partialize: (s) =>
        ({
          columnPrefs: s.columnPrefs,
          sidebarCollapsed: s.sidebarCollapsed,
          criticalOnly: s.criticalOnly,
          activeBaselineId: s.activeBaselineId,
          baselineTrendOpen: s.baselineTrendOpen,
          activeViewByPath: s.activeViewByPath,
          activeWorkspaceId: s.activeWorkspaceId,
        }) as Partial<UIState>,
    },
  ),
)
