'use client'

import { useHotkeys } from 'react-hotkeys-hook'
import { useRouter } from 'next/navigation'
import { useUIStore } from '@/lib/stores/ui'
import { SHORTCUTS, isTypingTarget } from '@/lib/keys'

type Handlers = {
  focusedTaskId: string | null
  orderedTaskIds: string[]
  onFocus?: (id: string | null) => void
  onNewTask?: () => void
  onEditTitle?: (id: string) => void
  onChangeStatus?: (id: string) => void
  onChangeAssignee?: (id: string) => void
  onChangeDate?: (id: string) => void
  onDuplicate?: (id: string) => void
  onDelete?: (id: string) => void
}

/**
 * Atajos globales de interacción sobre una lista de tareas.
 * Llamar una vez por vista (List, Kanban, Gantt).
 */
export function useTaskShortcuts(h: Handlers) {
  const router = useRouter()
  const openDrawer = useUIStore((s) => s.openDrawer)
  const closeDrawer = useUIStore((s) => s.closeDrawer)
  const toggleCommand = useUIStore((s) => s.toggleCommandPalette)
  const toggleShortcuts = useUIStore((s) => s.toggleShortcutsOverlay)

  const current = h.focusedTaskId
  const ids = h.orderedTaskIds

  const moveFocus = (delta: number) => {
    if (!ids.length) return
    const i = current ? ids.indexOf(current) : -1
    const next = Math.max(0, Math.min(ids.length - 1, i + delta))
    h.onFocus?.(ids[next] ?? null)
  }

  // Navegación
  useHotkeys(SHORTCUTS.FOCUS_DOWN, (e) => {
    if (isTypingTarget(e.target)) return
    e.preventDefault()
    moveFocus(+1)
  })
  useHotkeys(SHORTCUTS.FOCUS_UP, (e) => {
    if (isTypingTarget(e.target)) return
    e.preventDefault()
    moveFocus(-1)
  })
  useHotkeys(SHORTCUTS.OPEN_DRAWER, (e) => {
    if (isTypingTarget(e.target) || !current) return
    e.preventDefault()
    openDrawer(current)
  })
  useHotkeys(SHORTCUTS.CLOSE, () => closeDrawer())

  // Globales
  useHotkeys(
    SHORTCUTS.NEW_TASK,
    (e) => {
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      h.onNewTask?.()
    },
    { enableOnFormTags: false },
  )
  useHotkeys(
    SHORTCUTS.COMMAND_PALETTE,
    (e) => {
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      toggleCommand(true)
    },
    { enableOnFormTags: false },
  )
  useHotkeys(SHORTCUTS.SHORTCUTS_OVERLAY, (e) => {
    e.preventDefault()
    toggleShortcuts(true)
  })

  // Inline
  useHotkeys(SHORTCUTS.EDIT_TITLE, (e) => {
    if (isTypingTarget(e.target) || !current) return
    e.preventDefault()
    h.onEditTitle?.(current)
  })
  useHotkeys(SHORTCUTS.CHANGE_STATUS, (e) => {
    if (isTypingTarget(e.target) || !current) return
    e.preventDefault()
    h.onChangeStatus?.(current)
  })
  useHotkeys(SHORTCUTS.CHANGE_ASSIGNEE, (e) => {
    if (isTypingTarget(e.target) || !current) return
    e.preventDefault()
    h.onChangeAssignee?.(current)
  })
  useHotkeys(SHORTCUTS.CHANGE_DATE, (e) => {
    if (isTypingTarget(e.target) || !current) return
    e.preventDefault()
    h.onChangeDate?.(current)
  })
  useHotkeys(SHORTCUTS.DUPLICATE, (e) => {
    if (!current) return
    e.preventDefault()
    h.onDuplicate?.(current)
  })
  useHotkeys(SHORTCUTS.COPY_LINK, (e) => {
    if (!current) return
    e.preventDefault()
    const url = new URL(window.location.href)
    url.searchParams.set('task', current)
    navigator.clipboard?.writeText(url.toString())
  })
  useHotkeys(SHORTCUTS.DELETE, (e) => {
    if (!current) return
    e.preventDefault()
    h.onDelete?.(current)
  })

  // Navegación siguiente/anterior dentro del drawer (vim J/K)
  useHotkeys(SHORTCUTS.NEXT_TASK, (e) => {
    if (isTypingTarget(e.target)) return
    moveFocus(+1)
    if (current) openDrawer(ids[ids.indexOf(current) + 1] ?? current)
  })
  useHotkeys(SHORTCUTS.PREV_TASK, (e) => {
    if (isTypingTarget(e.target)) return
    moveFocus(-1)
    if (current) openDrawer(ids[ids.indexOf(current) - 1] ?? current)
  })

  return { router }
}
