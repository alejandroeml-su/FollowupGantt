/**
 * Ola P5 · Equipo P5-5 — Interpolación de plantillas para títulos de Task
 * generadas por submissions.
 *
 * Sintaxis: `{nombre_campo}` se reemplaza por el valor del payload. Si el
 * campo no existe o es null, se sustituye por cadena vacía. Se incluyen
 * variables especiales:
 *   - `{slug}` → slug del formulario (inyectado por el caller).
 *   - `{submittedAt}` → ISO timestamp.
 *
 * Diseño deliberado:
 *   - No interpretamos `\{` como escape para mantener el parser trivial.
 *   - El resultado se trunca a 200 chars (límite razonable para `Task.title`).
 */

const PLACEHOLDER_RE = /\{([a-z][a-z0-9_]*)\}/gi

const MAX_TITLE_LENGTH = 200

export interface InterpolationContext {
  payload: Record<string, string | number | null | undefined>
  slug: string
  submittedAt?: Date
}

export function interpolateTemplate(
  template: string,
  ctx: InterpolationContext,
): string {
  const submittedAt = ctx.submittedAt ?? new Date()
  const out = template.replace(PLACEHOLDER_RE, (_match, key: string) => {
    const lower = key.toLowerCase()
    if (lower === 'slug') return ctx.slug
    if (lower === 'submittedat') return submittedAt.toISOString()
    const v = ctx.payload[key]
    if (v === undefined || v === null) return ''
    return String(v)
  })

  // Colapsa whitespace múltiple y trunca.
  const collapsed = out.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= MAX_TITLE_LENGTH) return collapsed
  return `${collapsed.slice(0, MAX_TITLE_LENGTH - 1)}…`
}

/**
 * Devuelve la lista de placeholders detectados en una plantilla. Útil para
 * validar en la UI que todos los `{x}` referenciados existen en el schema.
 */
export function extractPlaceholders(template: string): string[] {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  PLACEHOLDER_RE.lastIndex = 0
  while ((m = PLACEHOLDER_RE.exec(template)) !== null) {
    out.add(m[1].toLowerCase())
  }
  return Array.from(out)
}
