'use client'

import { useEffect } from 'react'

type Handlers = {
  selectedNodeId: string | null
  onDelete: (id: string) => void
  onAddChild: (parentId: string) => void
  onAddSibling: (nodeId: string) => void
  onDeselect: () => void
}

// Keyboard shortcuts estilo MindMup 3:
// - Tab           → crear nodo hijo
// - Enter         → crear nodo hermano
// - Delete/Backspace → eliminar nodo (no raíz)
// - Escape        → deseleccionar
export function useMindMapShortcuts({
  selectedNodeId,
  onDelete,
  onAddChild,
  onAddSibling,
  onDeselect,
}: Handlers) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // No interferir con inputs / textareas / contenteditable
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }

      if (e.key === 'Escape') {
        onDeselect()
        return
      }

      if (!selectedNodeId) return

      if (e.key === 'Tab') {
        e.preventDefault()
        onAddChild(selectedNodeId)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onAddSibling(selectedNodeId)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDelete(selectedNodeId)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedNodeId, onDelete, onAddChild, onAddSibling, onDeselect])
}
