/**
 * R4 · US-7.4 · Email ClickApp — Generador de alias de proyecto.
 *
 * Cada proyecto recibe un alias único de la forma:
 *   `inbox+<slug>@<INBOUND_EMAIL_DOMAIN>`
 *
 * El `slug` se deriva del nombre del proyecto: lowercase, sin acentos,
 * sólo `[a-z0-9-]`, max 32 chars. Si colisiona con otro proyecto
 * (improbable pero posible si dos proyectos tienen nombres similares),
 * el caller debe reintentar con un sufijo numérico — `buildSlugCandidate`
 * acepta un `attempt` que añade `-N`.
 */

const ACCENT_MAP: Record<string, string> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a', å: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ñ: 'n', ç: 'c',
}

export function buildSlugCandidate(projectName: string, attempt = 0): string {
  const normalized = (projectName || 'proyecto')
    .toLowerCase()
    .split('')
    .map((c) => ACCENT_MAP[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'proyecto'

  if (attempt <= 0) return normalized
  // Reserva espacio para `-N` (1-3 dígitos) sin pasar de 32 chars totales.
  const suffix = `-${attempt}`
  const base = normalized.slice(0, 32 - suffix.length).replace(/-+$/g, '')
  return `${base}${suffix}`
}

/**
 * Devuelve el dominio configurado para emails entrantes. Default a un
 * placeholder visible para que la UI muestre el alias incluso si la env
 * var no está seteada (más útil para el operador que un string vacío).
 */
export function getInboundEmailDomain(): string {
  return process.env.INBOUND_EMAIL_DOMAIN || 'sync.complejoavante.com'
}

/**
 * Construye el alias completo dado un slug. NO valida unicidad — eso es
 * responsabilidad del caller (Prisma `@unique` lo rechaza al insertar).
 */
export function buildAliasFromSlug(slug: string): string {
  return `inbox+${slug}@${getInboundEmailDomain()}`
}
