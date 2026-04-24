'use client'

import { useEffect } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useUIStore } from '@/lib/stores/ui'
import { SHORTCUTS, isTypingTarget } from '@/lib/keys'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { CommandPalette } from './CommandPalette'
import { Toaster } from './Toaster'

/**
 * Montado una sola vez en el RootLayout.
 * Expone:
 *  - overlay de atajos (Shift + /)
 *  - paleta de comandos (/)
 *  - live region ARIA para anuncios de DnD
 *
 * Las vistas (list/kanban/gantt) adicionan sus propios shortcuts vía
 * `useTaskShortcuts()`; esta shell sólo gestiona los globales.
 */
export function AppInteractionShell() {
  const toggleShortcuts = useUIStore((s) => s.toggleShortcutsOverlay)
  const toggleCommand = useUIStore((s) => s.toggleCommandPalette)

  useHotkeys(SHORTCUTS.SHORTCUTS_OVERLAY, (e) => {
    if (isTypingTarget(e.target)) return
    e.preventDefault()
    toggleShortcuts(true)
  })
  useHotkeys(SHORTCUTS.COMMAND_PALETTE, (e) => {
    if (isTypingTarget(e.target)) return
    e.preventDefault()
    toggleCommand(true)
  })
  useHotkeys(SHORTCUTS.CLOSE, () => {
    toggleShortcuts(false)
    toggleCommand(false)
  })

  useEffect(() => {
    // Garantiza live region global para dnd-kit announcements
    let region = document.getElementById('a11y-live')
    if (!region) {
      region = document.createElement('div')
      region.id = 'a11y-live'
      region.setAttribute('aria-live', 'polite')
      region.setAttribute('aria-atomic', 'true')
      region.className = 'sr-only'
      document.body.appendChild(region)
    }
  }, [])

  return (
    <>
      <ShortcutsOverlay />
      <CommandPalette />
      <Toaster />
    </>
  )
}
