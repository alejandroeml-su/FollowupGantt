import { describe, it, expect } from 'vitest'

// navigator.platform: jsdom expone string vacío por defecto; lo stubeamos
Object.defineProperty(window.navigator, 'platform', {
  value: 'MacIntel',
  configurable: true,
})

import { SHORTCUTS, displayShortcut, isTypingTarget } from '@/lib/keys'

describe('keys · displayShortcut', () => {
  it('traduce mod a ⌘ en Mac', () => {
    expect(displayShortcut('mod+d')).toMatch(/⌘/)
  })

  it('reemplaza flechas por símbolos', () => {
    expect(displayShortcut('down')).toMatch(/↓/)
    expect(displayShortcut('up')).toMatch(/↑/)
    expect(displayShortcut('left')).toMatch(/←/)
    expect(displayShortcut('right')).toMatch(/→/)
  })

  it('uppercase', () => {
    expect(displayShortcut('enter')).toBe('↵')
    expect(displayShortcut('e')).toBe('E')
  })

  it('usa Ctrl fuera de Mac', () => {
    Object.defineProperty(window.navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    })
    expect(displayShortcut('mod+d')).toContain('CTRL')
    Object.defineProperty(window.navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    })
  })
})

describe('keys · isTypingTarget', () => {
  it('true para INPUT/TEXTAREA/SELECT', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const el = document.createElement(tag as keyof HTMLElementTagNameMap)
      expect(isTypingTarget(el)).toBe(true)
    }
  })

  it('true para contenteditable', () => {
    const div = document.createElement('div')
    // jsdom no implementa el getter `isContentEditable` derivado del atributo;
    // lo stubeamos para validar la rama de `isTypingTarget`.
    Object.defineProperty(div, 'isContentEditable', {
      configurable: true,
      get: () => true,
    })
    expect(isTypingTarget(div)).toBe(true)
  })

  it('false para otros elementos', () => {
    const span = document.createElement('span')
    expect(isTypingTarget(span)).toBe(false)
  })

  it('false si target no es HTMLElement', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({} as unknown as EventTarget)).toBe(false)
  })
})

describe('keys · SHORTCUTS map', () => {
  it('contiene los atajos principales del EPIC-001', () => {
    const required: (keyof typeof SHORTCUTS)[] = [
      'NEW_TASK',
      'COMMAND_PALETTE',
      'SHORTCUTS_OVERLAY',
      'FOCUS_DOWN',
      'FOCUS_UP',
      'OPEN_DRAWER',
      'CLOSE',
      'EDIT_TITLE',
      'CHANGE_STATUS',
      'CHANGE_ASSIGNEE',
      'CHANGE_DATE',
      'DUPLICATE',
      'COPY_LINK',
      'DELETE',
      'NEXT_TASK',
      'PREV_TASK',
    ]
    for (const k of required) expect(SHORTCUTS[k]).toBeTruthy()
  })
})
