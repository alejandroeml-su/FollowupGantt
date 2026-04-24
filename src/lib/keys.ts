// EPIC-001 · Mapa central de atajos de teclado (estilo ClickUp).
// Las keys siguen la notación de `react-hotkeys-hook` (mousetrap-compatible).

export const SHORTCUTS = {
  // Globales
  NEW_TASK: 't',
  COMMAND_PALETTE: '/',
  SHORTCUTS_OVERLAY: 'shift+/',

  // Navegación dentro de una vista
  FOCUS_DOWN: 'down',
  FOCUS_UP: 'up',
  COLLAPSE: 'left',
  EXPAND: 'right',
  OPEN_DRAWER: 'enter',
  CLOSE: 'escape',

  // Acciones inline sobre la tarea con foco
  EDIT_TITLE: 'e',
  CHANGE_ASSIGNEE: 'a',
  CHANGE_STATUS: 's',
  CHANGE_DATE: 'd',
  DUPLICATE: 'mod+d',
  COPY_LINK: 'mod+l',
  DELETE: 'mod+backspace',

  // Dentro del Drawer
  NEXT_TASK: 'j',
  PREV_TASK: 'k',
} as const

export type ShortcutKey = keyof typeof SHORTCUTS

// Prettifier para overlays de ayuda (? )
export function displayShortcut(raw: string): string {
  return raw
    .replace(/mod/gi, navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')
    .replace(/\+/g, ' + ')
    .replace(/\bup\b/i, '↑')
    .replace(/\bdown\b/i, '↓')
    .replace(/\bleft\b/i, '←')
    .replace(/\bright\b/i, '→')
    .replace(/\benter\b/i, '↵')
    .replace(/\bescape\b/i, 'Esc')
    .replace(/\bbackspace\b/i, '⌫')
    .toUpperCase()
}

// Helper: ¿el foco está en un input/textarea/contenteditable?
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}
