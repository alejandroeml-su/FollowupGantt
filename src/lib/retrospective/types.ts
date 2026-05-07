/**
 * Wave P9 R2 (HU-9.9) — Tipos + helpers para Sprint Retrospective.
 *
 * Sin server-only. Define el shape canónico del campo Json
 * `Retrospective.data`, el catálogo de formats y helpers puros.
 *
 * Decisión arquitectura: items en Json en lugar de tabla normalizada
 * `RetroItem`. Razón:
 *   - Una retro típica tiene 10-30 items, vive 1-2 semanas, se cierra.
 *   - Operaciones más comunes (toggle vote, agregar item, mover entre
 *     columnas) son micro-mutaciones del payload, no queries cross-retro.
 *   - Los action items que sí son tasks separadas viven en `Task`,
 *     vinculadas con `taskId` en el item Json.
 *
 * Si la app crece a "dame todos los items con vote > N" o "qué retros
 * mencionaron 'velocity'", normalizar a tabla en R3.
 */

export type RetrospectiveFormat =
  | 'FOUR_LS'
  | 'START_STOP_CONTINUE'
  | 'MAD_SAD_GLAD'

export type RetroItem = {
  id: string
  text: string
  /** UserIds que votaron este item. */
  votes: string[]
  /** UserId del autor (puede ser null si se importa de fuente externa). */
  authorId: string | null
  /** Si el equipo decidió convertir el item en Task, aquí va el id.
   *  La Task se crea con type=AGILE_STORY en el mismo proyecto del sprint. */
  taskId?: string | null
}

export type RetroCategory = {
  /** Slug del id de columna (ej. "liked", "lacked"). Se usa como key
   *  en el record `categories` y debe ser estable per format. */
  id: string
  label: string
  items: RetroItem[]
}

export type RetrospectiveData = {
  categories: Record<string, RetroCategory>
}

/** Definición de columnas por format (orden + label canónico es-MX). */
export const FORMAT_DEFINITIONS: Record<
  RetrospectiveFormat,
  ReadonlyArray<{ id: string; label: string; emoji: string; tone: string }>
> = {
  FOUR_LS: [
    { id: 'liked', label: 'Liked (Lo que gustó)', emoji: '👍', tone: 'emerald' },
    { id: 'lacked', label: 'Lacked (Lo que faltó)', emoji: '😕', tone: 'amber' },
    { id: 'learned', label: 'Learned (Aprendizajes)', emoji: '💡', tone: 'indigo' },
    { id: 'longed_for', label: 'Longed-for (Quisiera tener)', emoji: '✨', tone: 'violet' },
  ],
  START_STOP_CONTINUE: [
    { id: 'start', label: 'Empezar', emoji: '▶️', tone: 'emerald' },
    { id: 'stop', label: 'Dejar de hacer', emoji: '⛔', tone: 'rose' },
    { id: 'continue', label: 'Continuar', emoji: '🔁', tone: 'indigo' },
  ],
  MAD_SAD_GLAD: [
    { id: 'mad', label: 'Mad (Frustró)', emoji: '😡', tone: 'rose' },
    { id: 'sad', label: 'Sad (Decepcionó)', emoji: '😢', tone: 'amber' },
    { id: 'glad', label: 'Glad (Alegró)', emoji: '😄', tone: 'emerald' },
  ],
}

export function isValidFormat(value: unknown): value is RetrospectiveFormat {
  return value === 'FOUR_LS' || value === 'START_STOP_CONTINUE' || value === 'MAD_SAD_GLAD'
}

/** Construye un payload `data` vacío con las categorías del format. */
export function emptyData(format: RetrospectiveFormat): RetrospectiveData {
  const cols = FORMAT_DEFINITIONS[format]
  const categories: Record<string, RetroCategory> = {}
  for (const c of cols) {
    categories[c.id] = { id: c.id, label: c.label, items: [] }
  }
  return { categories }
}

/** Genera id estable cliente-side. */
export function generateItemId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `ri-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Sanitiza Json arbitrario al shape `RetrospectiveData`. Defensivo:
 * descarta items mal-formados, dedupe votes, recompone categorías que
 * falten según el format actual.
 *
 * Si un item viejo viaja con categoría que el format ya no incluye,
 * se descarta (evita zombies tras cambio de format).
 */
export function normalizeData(
  raw: unknown,
  format: RetrospectiveFormat,
): RetrospectiveData {
  const def = emptyData(format)
  if (!raw || typeof raw !== 'object') return def
  const r = raw as Record<string, unknown>
  const rawCats = r.categories
  if (!rawCats || typeof rawCats !== 'object') return def

  const validCategoryIds = new Set(
    FORMAT_DEFINITIONS[format].map((c) => c.id),
  )

  for (const [catId, cat] of Object.entries(rawCats)) {
    if (!validCategoryIds.has(catId)) continue
    if (!cat || typeof cat !== 'object') continue
    const cc = cat as { label?: unknown; items?: unknown }
    const items = Array.isArray(cc.items) ? cc.items : []
    const cleanItems: RetroItem[] = []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      if (typeof it.id !== 'string' || typeof it.text !== 'string') continue
      const text = it.text.trim()
      if (!text) continue
      const votes = Array.isArray(it.votes)
        ? Array.from(new Set(it.votes.filter((v): v is string => typeof v === 'string')))
        : []
      cleanItems.push({
        id: it.id,
        text,
        votes,
        authorId: typeof it.authorId === 'string' ? it.authorId : null,
        taskId: typeof it.taskId === 'string' ? it.taskId : null,
      })
    }
    if (def.categories[catId]) {
      def.categories[catId] = { ...def.categories[catId], items: cleanItems }
    }
  }

  return def
}

/** Total de items en todas las categorías. */
export function countItems(data: RetrospectiveData | null | undefined): number {
  if (!data) return 0
  let n = 0
  for (const cat of Object.values(data.categories)) n += cat.items.length
  return n
}

/** Etiqueta humana del format (es-MX). */
export function formatLabel(format: RetrospectiveFormat): string {
  switch (format) {
    case 'FOUR_LS':
      return '4Ls (Liked / Lacked / Learned / Longed-for)'
    case 'START_STOP_CONTINUE':
      return 'Start / Stop / Continue'
    case 'MAD_SAD_GLAD':
      return 'Mad / Sad / Glad'
  }
}
