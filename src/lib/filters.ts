// Módulo puro para serialización y preservación de filtros entre vistas.
// Parámetros soportados (todos opcionales, múltiples valores con coma):
//   - assignee: userId,...   - status: TODO,IN_PROGRESS,...
//   - priority: LOW,HIGH,... - project: projectId,...
//   - tag: tagName,...       - q: texto libre
//   - month: YYYY-MM         (sólo /gantt)

export const FILTER_KEYS = [
  'assignee',
  'status',
  'priority',
  'project',
  'tag',
  'q',
  'month',
] as const

export type FilterKey = (typeof FILTER_KEYS)[number]
export type FiltersRecord = Partial<Record<FilterKey, string>>

/** Extrae sólo los parámetros reconocidos, descartando ruido. */
export function pickFilters(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): FiltersRecord {
  const out: FiltersRecord = {}
  const get = (k: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(k) ?? undefined
    const v = params[k]
    return Array.isArray(v) ? v[0] : v
  }
  for (const k of FILTER_KEYS) {
    const v = get(k)
    if (v) out[k] = v
  }
  return out
}

export function filtersToQuery(f: FiltersRecord): string {
  const qs = new URLSearchParams()
  for (const k of FILTER_KEYS) {
    const v = f[k]
    if (v) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/** href para navegar a otra vista preservando filtros relevantes. */
export function hrefWithFilters(
  pathname: string,
  filters: FiltersRecord,
): string {
  // `month` sólo tiene sentido en /gantt: lo preservamos sólo si vamos allí
  const applicable = { ...filters }
  if (!pathname.startsWith('/gantt')) delete applicable.month
  return `${pathname}${filtersToQuery(applicable)}`
}
