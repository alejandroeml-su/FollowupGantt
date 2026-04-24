'use client'

import * as ContextMenu from '@radix-ui/react-context-menu'
import type { ReactNode } from 'react'
import { clsx } from 'clsx'

/**
 * Menú contextual accesible construido sobre Radix.
 * Soporta submenús, separadores y atajos de teclado.
 *
 * Uso:
 *   <TaskContextMenu
 *     trigger={<TaskCard task={t} />}
 *     items={[
 *       { label: 'Editar',    shortcut: 'E',   onSelect: () => ... },
 *       { label: 'Mover a',   submenu: [...] },
 *       { type: 'separator' },
 *       { label: 'Eliminar',  destructive: true, shortcut: '⌘⌫' },
 *     ]}
 *   />
 */
export type MenuAction = {
  type?: 'item'
  label: string
  icon?: ReactNode
  shortcut?: string
  destructive?: boolean
  disabled?: boolean
  onSelect?: () => void
  submenu?: MenuItem[]
}
export type MenuItem =
  | MenuAction
  | { type: 'separator' }
  | { type: 'label'; label: string }

function isSeparator(i: MenuItem): i is { type: 'separator' } {
  return (i as { type?: string }).type === 'separator'
}
function isGroupLabel(i: MenuItem): i is { type: 'label'; label: string } {
  return (i as { type?: string }).type === 'label'
}

const CONTENT_CLS =
  'z-50 min-w-[220px] overflow-hidden rounded-[10px] border border-slate-200 bg-white p-1 shadow-lg ' +
  'dark:border-border dark:bg-card'

const ITEM_BASE =
  'flex cursor-default select-none items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm outline-none ' +
  'data-[highlighted]:bg-blue-50 data-[highlighted]:text-blue-700 ' +
  'dark:data-[highlighted]:bg-secondary dark:data-[highlighted]:text-blue-300 ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40'

function renderItem(item: MenuItem, i: number) {
  if (isSeparator(item))
    return (
      <ContextMenu.Separator
        key={`sep-${i}`}
        className="my-1 h-px bg-slate-200 dark:bg-border"
      />
    )
  if (isGroupLabel(item))
    return (
      <ContextMenu.Label
        key={`lbl-${i}`}
        className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {item.label}
      </ContextMenu.Label>
    )

  const it: MenuAction = item

  if (it.submenu?.length) {
    return (
      <ContextMenu.Sub key={`sub-${i}-${it.label}`}>
        <ContextMenu.SubTrigger
          className={clsx(ITEM_BASE, it.destructive && 'text-red-600')}
          disabled={it.disabled}
        >
          <span className="flex items-center gap-2">
            {it.icon}
            {it.label}
          </span>
          <span aria-hidden>›</span>
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent
            className={CONTENT_CLS}
            sideOffset={2}
            alignOffset={-4}
          >
            {it.submenu.map(renderItem)}
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
    )
  }

  return (
    <ContextMenu.Item
      key={`it-${i}-${it.label}`}
      onSelect={it.onSelect}
      disabled={it.disabled}
      className={clsx(ITEM_BASE, it.destructive && 'text-red-600')}
    >
      <span className="flex items-center gap-2">
        {it.icon}
        {it.label}
      </span>
      {it.shortcut && (
        <span className="ml-auto text-xs text-muted-foreground">{it.shortcut}</span>
      )}
    </ContextMenu.Item>
  )
}

export function TaskContextMenu({
  trigger,
  items,
}: {
  trigger: ReactNode
  items: MenuItem[]
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{trigger}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={CONTENT_CLS}
          collisionPadding={8}
          avoidCollisions
        >
          {items.map(renderItem)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
