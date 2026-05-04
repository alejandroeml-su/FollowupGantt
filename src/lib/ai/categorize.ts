/**
 * Ola P5 · Equipo P5-4 · AI Insights — Categorización heurística.
 *
 * Heurística determinista local (sin LLM) que sugiere:
 *   - `suggestedCategory`: etiqueta semántica de "tipo de trabajo"
 *     (DESIGN/RELEASE/BUG/MEETING/DOCS/REFACTOR/TESTING/RESEARCH/
 *      INFRA/SUPPORT/OTHER) inferida por keywords ES/EN.
 *   - `suggestedTaskType`: mapeo a la enum del schema
 *     (AGILE_STORY/PMI_TASK/ITIL_TICKET) basado en la categoría.
 *   - `mentionedEmails`: emails mencionados con `@` para sugerir
 *     assignee/colaboradores (la resolución a `userId` ocurre en el
 *     server action).
 *   - `suggestedTags`: hashtags `#tag` extraídos del texto.
 *   - `confidence`: 0..1 según matches encontrados.
 *   - `reasoning`: lista legible de razones (mostrada en la UI).
 *
 * Diseño:
 *   - Diccionario palabra → categoría con peso. La categoría con mayor
 *     score gana; en empate gana la primera del orden de prioridad
 *     (BUG > RELEASE > DESIGN > … > OTHER) para producir resultados
 *     deterministas.
 *   - Acepta español acentuado y formas comunes (diseño/diseñar/figma).
 *   - No tiene side-effects: misma entrada → misma salida.
 */

export type TaskCategory =
  | 'BUG'
  | 'RELEASE'
  | 'DESIGN'
  | 'MEETING'
  | 'DOCS'
  | 'REFACTOR'
  | 'TESTING'
  | 'RESEARCH'
  | 'INFRA'
  | 'SUPPORT'
  | 'OTHER'

// Mapeo categoría → TaskType del schema. ITIL_TICKET para todo lo de
// soporte/ops; PMI_TASK para entregables formales (diseño, doc, release);
// AGILE_STORY para el resto (default historia).
const CATEGORY_TO_TASK_TYPE: Record<TaskCategory, 'AGILE_STORY' | 'PMI_TASK' | 'ITIL_TICKET'> = {
  BUG: 'ITIL_TICKET',
  RELEASE: 'PMI_TASK',
  DESIGN: 'PMI_TASK',
  MEETING: 'AGILE_STORY',
  DOCS: 'PMI_TASK',
  REFACTOR: 'AGILE_STORY',
  TESTING: 'AGILE_STORY',
  RESEARCH: 'AGILE_STORY',
  INFRA: 'ITIL_TICKET',
  SUPPORT: 'ITIL_TICKET',
  OTHER: 'AGILE_STORY',
}

// Orden de prioridad para desempate determinista: las categorías más
// "fuertes" (que corresponden a señales muy específicas) ganan ante un
// empate de score. Por ejemplo, "fix bug del deploy" → BUG > RELEASE.
const CATEGORY_PRIORITY: TaskCategory[] = [
  'BUG',
  'RELEASE',
  'INFRA',
  'TESTING',
  'DESIGN',
  'DOCS',
  'MEETING',
  'REFACTOR',
  'RESEARCH',
  'SUPPORT',
  'OTHER',
]

// Diccionario palabra clave → categoría. Cada entrada normalizada (sin
// acentos, lowercase). El matcher usa regex de palabra completa para
// evitar falsos positivos como "subir" matcheando "bir".
const KEYWORDS: Record<TaskCategory, string[]> = {
  BUG: [
    'bug',
    'error',
    'errores',
    'fallo',
    'falla',
    'crash',
    'incidente',
    'incidencia',
    'fix',
    'arreglar',
    'corregir',
    'corregido',
    'corrupto',
    'roto',
  ],
  RELEASE: [
    'deploy',
    'despliegue',
    'release',
    'liberacion',
    'liberar',
    'publicar',
    'publish',
    'rollout',
    'lanzamiento',
    'lanzar',
    'production',
    'produccion',
    'go-live',
  ],
  DESIGN: [
    'diseno',
    'disenar',
    'disenado',
    'figma',
    'ux',
    'ui',
    'mockup',
    'wireframe',
    'prototipo',
    'maqueta',
    'maquetacion',
    'storyboard',
    'estilo',
  ],
  MEETING: [
    'reunion',
    'reuniones',
    'meeting',
    'meet',
    'junta',
    'standup',
    'daily',
    'planning',
    'retro',
    'retrospectiva',
    'sync',
    'sincronizacion',
    'comite',
    'kickoff',
  ],
  DOCS: [
    'documentacion',
    'documentar',
    'docs',
    'doc',
    'wiki',
    'manual',
    'guia',
    'readme',
    'changelog',
    'especificacion',
    'spec',
    'rfc',
  ],
  REFACTOR: [
    'refactor',
    'refactorizar',
    'refactorizacion',
    'limpiar',
    'cleanup',
    'reescribir',
    'simplificar',
    'reorganizar',
    'optimizar',
    'modernizar',
  ],
  TESTING: [
    'test',
    'tests',
    'testing',
    'prueba',
    'pruebas',
    'qa',
    'unit',
    'unitario',
    'unitarios',
    'e2e',
    'integration',
    'integracion',
    'cobertura',
    'coverage',
  ],
  RESEARCH: [
    'investigar',
    'investigacion',
    'research',
    'spike',
    'poc',
    'prueba-de-concepto',
    'evaluar',
    'analizar',
    'analisis',
    'discovery',
    'benchmark',
  ],
  INFRA: [
    'infra',
    'infraestructura',
    'devops',
    'kubernetes',
    'k8s',
    'docker',
    'terraform',
    'aws',
    'gcp',
    'azure',
    'cluster',
    'pipeline',
    'ci',
    'cd',
    'cicd',
    'observabilidad',
    'monitoreo',
    'alertas',
  ],
  SUPPORT: [
    'soporte',
    'support',
    'ticket',
    'tickets',
    'mesa',
    'helpdesk',
    'usuario',
    'cliente',
    'sla',
    'escalado',
    'escalamiento',
  ],
  // OTHER no tiene keywords: es el fallback cuando ningún match.
  OTHER: [],
}

/** Normaliza el texto: lowercase + remueve acentos. Determinista. */
function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Pre-compila los regex por categoría para no rehacer el RegExp en cada llamada. */
const KEYWORD_REGEXES: Array<{ category: TaskCategory; regex: RegExp; word: string }> = (
  Object.entries(KEYWORDS) as Array<[TaskCategory, string[]]>
).flatMap(([category, words]) =>
  words.map((word) => ({
    category,
    word,
    // Usamos límites lookaround amigables con caracteres no alfanuméricos.
    // Permitimos guiones y puntos como separadores: "ci-cd" → "ci" + "cd".
    regex: new RegExp(`(^|[^a-z0-9])${escapeRegex(word)}([^a-z0-9]|$)`, 'i'),
  })),
)

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Regex para `@email` y `#tag`. Capturamos sólo emails con dominio
// válido para evitar matches accidentales en nombres con `@`.
const MENTION_REGEX = /@([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g
const TAG_REGEX = /#([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ0-9_-]{2,32})/g

export interface CategorizationResult {
  suggestedCategory: TaskCategory
  suggestedTaskType: 'AGILE_STORY' | 'PMI_TASK' | 'ITIL_TICKET'
  confidence: number
  reasoning: string[]
  mentionedEmails: string[]
  suggestedTags: string[]
  matches: Record<TaskCategory, string[]>
}

/**
 * Categoriza una tarea a partir de título + descripción opcional.
 * Determinista: misma entrada → misma salida.
 */
export function categorizeTask(
  title: string,
  description?: string | null,
): CategorizationResult {
  const rawText = `${title ?? ''}\n${description ?? ''}`
  const text = normalize(rawText)

  // Score por categoría = #keywords distintas matcheadas. Mantenemos
  // el listado de palabras encontradas para componer `reasoning`.
  const matches = {
    BUG: [],
    RELEASE: [],
    DESIGN: [],
    MEETING: [],
    DOCS: [],
    REFACTOR: [],
    TESTING: [],
    RESEARCH: [],
    INFRA: [],
    SUPPORT: [],
    OTHER: [],
  } as Record<TaskCategory, string[]>

  for (const { category, regex, word } of KEYWORD_REGEXES) {
    if (regex.test(text)) {
      // De-dup por categoría (si la misma palabra aparece dos veces no
      // contamos doble).
      if (!matches[category].includes(word)) {
        matches[category].push(word)
      }
    }
  }

  // Selección determinista: gana la categoría con más matches; empate →
  // CATEGORY_PRIORITY.
  let bestCategory: TaskCategory = 'OTHER'
  let bestScore = 0
  for (const cat of CATEGORY_PRIORITY) {
    const score = matches[cat].length
    if (score > bestScore) {
      bestScore = score
      bestCategory = cat
    }
  }

  // Confianza: heurística simple = min(1, bestScore / 3). 3 keywords
  // distintas → 100%. 1 → 33%. 0 → 0% (devolvemos OTHER con conf 0).
  const confidence = Math.min(1, bestScore / 3)

  // Mentions y tags se extraen del texto crudo (no normalizado) para
  // preservar el case.
  const mentionedEmails = Array.from(rawText.matchAll(MENTION_REGEX))
    .map((m) => m[1].toLowerCase())
    .filter((v, i, arr) => arr.indexOf(v) === i)

  const suggestedTags = Array.from(rawText.matchAll(TAG_REGEX))
    .map((m) => m[1].toLowerCase())
    .filter((v, i, arr) => arr.indexOf(v) === i)

  const reasoning: string[] = []
  if (bestScore > 0) {
    reasoning.push(
      `Coincidencias para "${bestCategory}": ${matches[bestCategory].join(', ')}`,
    )
  } else {
    reasoning.push('Sin coincidencias claras de categoría')
  }
  if (mentionedEmails.length > 0) {
    reasoning.push(`Menciones detectadas: ${mentionedEmails.join(', ')}`)
  }
  if (suggestedTags.length > 0) {
    reasoning.push(`Etiquetas sugeridas: ${suggestedTags.join(', ')}`)
  }

  return {
    suggestedCategory: bestCategory,
    suggestedTaskType: CATEGORY_TO_TASK_TYPE[bestCategory],
    confidence,
    reasoning,
    mentionedEmails,
    suggestedTags,
    matches,
  }
}

/**
 * Lista de categorías soportadas (útil para UI de filtros).
 */
export function listCategories(): TaskCategory[] {
  return [...CATEGORY_PRIORITY]
}
