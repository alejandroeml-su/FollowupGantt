/**
 * Wave P9 · Agile Maturity — Paleta de colores curada para Epics.
 *
 * Diseño @UIUX: 8 colores que cumplen WCAG 2.2 AA tanto sobre fondos
 * claros (light mode) como oscuros (dark mode) cuando se usan con
 * variants /15 (background pill), /80 (border) y el color directo
 * para texto. Evitamos color picker libre porque:
 *   - Riesgo a11y de elegir colores con bajo contraste.
 *   - Coherencia visual del tablero — un mar de colores arbitrarios
 *     genera ruido cognitivo (heurística Nielsen #8 "minimalist").
 *
 * Convención de uso en componentes:
 *   - dot: `style={{ backgroundColor: epic.color }}` en h-1.5 w-1.5.
 *   - badge text + bg: usar opacity helpers (e.g. con CSS-in-JS o
 *     `${epic.color}33` para bg ~20% y `${epic.color}` para text).
 *   - Border: `${epic.color}66` (40%).
 */

export type EpicColorOption = {
  /** Slug semántico estable. Sirve para i18n y accesibilidad
   *  (`aria-label="Color: indigo"`). */
  slug: string
  /** Etiqueta legible (es-MX). */
  label: string
  /** Hex de 6 caracteres. */
  hex: string
  /** Sugerencia semántica de cuándo usarlo. */
  hint?: string
}

export const EPIC_COLOR_PALETTE: readonly EpicColorOption[] = [
  { slug: 'indigo', label: 'Indigo', hex: '#818cf8', hint: 'Iniciativa estándar (default)' },
  { slug: 'sky', label: 'Sky', hex: '#38bdf8', hint: 'Investigación / Discovery' },
  { slug: 'emerald', label: 'Emerald', hex: '#34d399', hint: 'Crecimiento / Mejora' },
  { slug: 'amber', label: 'Amber', hex: '#fbbf24', hint: 'Riesgo / Atención' },
  { slug: 'rose', label: 'Rose', hex: '#fb7185', hint: 'Urgente / Hotfix' },
  { slug: 'violet', label: 'Violet', hex: '#a78bfa', hint: 'Estratégico' },
  { slug: 'teal', label: 'Teal', hex: '#2dd4bf', hint: 'Sostenimiento' },
  { slug: 'slate', label: 'Slate', hex: '#94a3b8', hint: 'Backlog / Idea' },
] as const

export const DEFAULT_EPIC_COLOR = '#818cf8'

/** Validador de hex de 6 dígitos (igual al server-side `assertValidColor`). */
export const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

export function isValidEpicColor(hex: string): boolean {
  return HEX_COLOR_REGEX.test(hex)
}
