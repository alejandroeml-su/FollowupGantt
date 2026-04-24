'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

type View = 'list' | 'kanban' | 'gantt' | 'calendar' | 'table' | 'workload'

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
    }),
    {
      name: 'followup-ui',
      storage: createJSONStorage(() => localStorage),
      // Sólo persistimos preferencias visuales, no la selección ni el drawer.
      partialize: (s) => ({ columnPrefs: s.columnPrefs }) as Partial<UIState>,
    },
  ),
)
