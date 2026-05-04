/**
 * Ola P5 · Equipo P5-5 — Slug helpers para PublicForm.
 *
 * Convierte títulos human-readable en slugs URL-safe. Uso típico:
 *   1. Auto-derivar el slug al crear el form (botón "Generar desde título").
 *   2. Validar input manual del usuario para que /forms/<slug> sea estable.
 */

const SLUG_VALID_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

export function isValidSlug(input: string): boolean {
  return SLUG_VALID_RE.test(input)
}

/**
 * Normaliza arbitraria a slug minimal (kebab-case). No garantiza unicidad —
 * el caller debe consultar BD. Devuelve cadena vacía si tras normalizar no
 * queda nada (p.ej. solo símbolos).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
