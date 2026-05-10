// EPIC-001 · Mapa central de atajos de teclado (estilo ClickUp).
// Las keys siguen la notación de `react-hotkeys-hook` (mousetrap-compatible).

export const SHORTCUTS = {
  // Globales
  NEW_TASK: 't',
  COMMAND_PALETTE: '/',
  SHORTCUTS_OVERLAY: 'shift+/',
  // Wave P16-C — atajos globales adicionales (estilo Linear / GitHub):
  //  · cmd+k / ctrl+k → Command Palette (alias del `/` original).
  //  · cmd+/ / ctrl+/ → toggle sidebar collapse (rápido para esconder
  //    el panel y enfocarse en el contenido sin perder el mouse).
  //  · cmd+shift+n → modal "Nueva tarea" (atajo para creación rápida
  //    sin tener que navegar al botón en cada vista).
  //  · cmd+? / ? → overlay de atajos (alias de `shift+/`, más
  //    descubrible por usuarios mac que esperan `cmd+?`).
  COMMAND_PALETTE_K: 'mod+k',
  TOGGLE_SIDEBAR: 'mod+/',
  NEW_TASK_MODAL: 'mod+shift+n',
  SHORTCUTS_OVERLAY_HELP: 'mod+/?',

  // Navegación dentro de una vista
  FOCUS_DOWN: 'down',
  FOCUS_UP: 'up',
  COLLAPSE: 'left',
  EXPAND: 'right',
  OPEN_DRAWER: 'enter',
  CLOSE: 'escape',

  // Atajos rápidos para cambiar de vista (g + letra, estilo gmail/linear).
  GOTO_LIST: 'g l',
  GOTO_KANBAN: 'g k',
  GOTO_GANTT: 'g g',
  GOTO_CALENDAR: 'g c',
  GOTO_TABLE: 'g t',
  GOTO_TIMELINE: 'g i',
  GOTO_BRAIN: 'g b',

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

// Prettifier para overlays de ayuda (? ).
// SSR-safe: durante el prerender `navigator` no existe, así que asumimos
// no-Mac y lo corregiremos en el primer render cliente.
export function displayShortcut(raw: string): string {
  const isMac =
    typeof navigator !== 'undefined' &&
    typeof navigator.platform === 'string' &&
    navigator.platform.includes('Mac')
  return raw
    .replace(/mod/gi, isMac ? '⌘' : 'Ctrl')
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
