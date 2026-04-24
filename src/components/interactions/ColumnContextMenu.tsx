'use client'

import type { ReactNode } from 'react'
import * as ContextMenu from '@radix-ui/react-context-menu'
import {
  ChevronsLeftRight,
  EyeOff,
  Palette,
  Target,
  RotateCcw,
} from 'lucide-react'
import { useUIStore } from '@/lib/stores/ui'
import { TaskContextMenu, type MenuItem } from './ContextMenuPrimitive'

/**
 * Menú contextual para encabezado de columna Kanban.
 * Aplica a columnas basadas en TaskStatus (la UI actual): las acciones
 * que dependen de un modelo BoardColumn persistente (Renombrar, Eliminar)
 * quedan deshabilitadas hasta que se migre la UI a entidades de tablero.
 */
const SWATCHES = [
  { color: null, label: 'Sin acento' },
  { color: '#6366F1', label: 'Indigo' },
  { color: '#10B981', label: 'Emerald' },
  { color: '#F59E0B', label: 'Amber' },
  { color: '#EF4444', label: 'Red' },
  { color: '#8B5CF6', label: 'Violet' },
  { color: '#14B8A6', label: 'Teal' },
] as const

const WIP_OPTIONS: (number | null)[] = [null, 1, 2, 3, 5, 8]

export function ColumnContextMenu({
  columnId,
  columnName,
  trigger,
}: {
  columnId: string
  columnName: string
  trigger: ReactNode
}) {
  const prefs = useUIStore((s) => s.columnPrefs[columnId])
  const setColumnPrefs = useUIStore((s) => s.setColumnPrefs)
  const resetColumnPrefs = useUIStore((s) => s.resetColumnPrefs)

  const items: MenuItem[] = [
    { type: 'label', label: `Columna "${columnName}"` },
    {
      label: prefs?.collapsed ? 'Expandir' : 'Colapsar',
      icon: prefs?.collapsed ? (
        <ChevronsLeftRight className="h-4 w-4" />
      ) : (
        <EyeOff className="h-4 w-4" />
      ),
      onSelect: () =>
        setColumnPrefs(columnId, { collapsed: !prefs?.collapsed }),
    },
    {
      label: 'Cambiar color',
      icon: <Palette className="h-4 w-4" />,
      submenu: SWATCHES.map((sw) => ({
        label: sw.label,
        icon: (
          <span
            className="inline-block h-3 w-3 rounded-full border border-border"
            style={{ backgroundColor: sw.color ?? 'transparent' }}
            aria-hidden
          />
        ),
        onSelect: () => setColumnPrefs(columnId, { accent: sw.color ?? undefined }),
      })),
    },
    {
      label: 'Definir WIP limit',
      icon: <Target className="h-4 w-4" />,
      submenu: WIP_OPTIONS.map((n) => ({
        label: n == null ? 'Sin límite' : `Máx ${n}`,
        onSelect: () => setColumnPrefs(columnId, { wipOverride: n }),
      })),
    },
    { type: 'separator' },
    {
      label: 'Restaurar defaults',
      icon: <RotateCcw className="h-4 w-4" />,
      onSelect: () => resetColumnPrefs(columnId),
    },
  ]

  return <TaskContextMenu trigger={trigger} items={items} />
}

// Re-export genérico: un menú contextual alternativo con wrapper directo
// para cuando no queremos pasar por TaskContextMenu (si necesitamos portal
// distinto o anidación), preservado por simetría API.
export { ContextMenu }
