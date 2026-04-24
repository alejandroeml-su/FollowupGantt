'use client'

import {
  Pencil,
  Copy,
  ArrowRightLeft,
  Link as LinkIcon,
  Tag,
  UserPlus,
  Archive,
  Trash2,
  CircleDot,
} from 'lucide-react'
import { TaskContextMenu, type MenuItem } from './ContextMenuPrimitive'
import {
  archiveTask,
  duplicateTask,
  moveTaskToColumn,
  bulkArchive,
  bulkDelete,
} from '@/lib/actions/reorder'
import { deleteTask, updateTaskStatus } from '@/lib/actions'
import { useUIStore } from '@/lib/stores/ui'
import { SHORTCUTS, displayShortcut } from '@/lib/keys'
import type { ReactNode } from 'react'

const STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const

type Ctx = {
  taskId: string
  columns?: { id: string; name: string }[]
  assignees?: { id: string; name: string }[]
  tags?: string[]
}

/**
 * Wrapper que envuelve un Task visual con un menú contextual completo
 * (estilo ClickUp). Si hay multi-selección activa, adapta los handlers
 * a acciones en lote.
 */
export function TaskWithContextMenu({
  ctx,
  children,
}: {
  ctx: Ctx
  children: ReactNode
}) {
  const selectedIds = useUIStore((s) => s.selectedIds)
  const openDrawer = useUIStore((s) => s.openDrawer)
  const clearSelection = useUIStore((s) => s.clearSelection)

  const isBulk = selectedIds.size > 1 && selectedIds.has(ctx.taskId)
  const targetIds = isBulk ? Array.from(selectedIds) : [ctx.taskId]
  const label = isBulk
    ? `Acciones para ${targetIds.length} tareas`
    : 'Acciones de tarea'

  const items: MenuItem[] = [
    { type: 'label', label },
    {
      label: 'Editar',
      icon: <Pencil className="h-4 w-4" />,
      shortcut: displayShortcut(SHORTCUTS.EDIT_TITLE),
      onSelect: () => openDrawer(ctx.taskId),
    },
    {
      label: 'Duplicar',
      icon: <Copy className="h-4 w-4" />,
      shortcut: displayShortcut(SHORTCUTS.DUPLICATE),
      disabled: isBulk,
      onSelect: () => duplicateTask(ctx.taskId),
    },
    {
      label: 'Mover a',
      icon: <ArrowRightLeft className="h-4 w-4" />,
      disabled: !ctx.columns?.length,
      submenu: ctx.columns?.map((c) => ({
        label: c.name,
        onSelect: () =>
          isBulk
            ? void Promise.all(
                targetIds.map((id) => moveTaskToColumn(id, c.id)),
              ).then(() => clearSelection())
            : void moveTaskToColumn(ctx.taskId, c.id),
      })),
    },
    {
      label: 'Cambiar estado',
      icon: <CircleDot className="h-4 w-4" />,
      shortcut: displayShortcut(SHORTCUTS.CHANGE_STATUS),
      submenu: STATUSES.map((s) => ({
        label: s,
        onSelect: () =>
          isBulk
            ? void Promise.all(
                targetIds.map((id) => updateTaskStatus(id, s)),
              ).then(() => clearSelection())
            : void updateTaskStatus(ctx.taskId, s),
      })),
    },
    {
      label: 'Asignar',
      icon: <UserPlus className="h-4 w-4" />,
      shortcut: displayShortcut(SHORTCUTS.CHANGE_ASSIGNEE),
      disabled: !ctx.assignees?.length,
      submenu: ctx.assignees?.map((u) => ({
        label: u.name,
        onSelect: () => openDrawer(ctx.taskId),
      })),
    },
    {
      label: 'Etiquetar',
      icon: <Tag className="h-4 w-4" />,
      disabled: !ctx.tags?.length,
      submenu: ctx.tags?.map((t) => ({
        label: t,
        onSelect: () => openDrawer(ctx.taskId),
      })),
    },
    {
      label: 'Copiar enlace',
      icon: <LinkIcon className="h-4 w-4" />,
      shortcut: displayShortcut(SHORTCUTS.COPY_LINK),
      disabled: isBulk,
      onSelect: () => {
        const url = new URL(window.location.href)
        url.searchParams.set('task', ctx.taskId)
        navigator.clipboard?.writeText(url.toString())
      },
    },
    { type: 'separator' },
    {
      label: isBulk ? `Archivar ${targetIds.length}` : 'Archivar',
      icon: <Archive className="h-4 w-4" />,
      onSelect: () =>
        isBulk
          ? void bulkArchive(targetIds).then(() => clearSelection())
          : void archiveTask(ctx.taskId),
    },
    {
      label: isBulk ? `Eliminar ${targetIds.length}` : 'Eliminar',
      icon: <Trash2 className="h-4 w-4" />,
      destructive: true,
      shortcut: displayShortcut(SHORTCUTS.DELETE),
      onSelect: () => {
        const ok = confirm(
          isBulk
            ? `¿Eliminar ${targetIds.length} tareas? Esta acción no se puede deshacer.`
            : '¿Eliminar esta tarea? Esta acción no se puede deshacer.',
        )
        if (!ok) return
        if (isBulk) {
          void bulkDelete(targetIds).then(() => clearSelection())
        } else {
          const fd = new FormData()
          fd.set('id', ctx.taskId)
          void deleteTask(fd)
        }
      },
    },
  ]

  return <TaskContextMenu trigger={children} items={items} />
}
