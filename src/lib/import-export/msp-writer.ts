/**
 * HU-4.3 · Helper puro para escribir un proyecto en formato
 * Microsoft Project XML 2003+ (D11 source-of-truth de import/export).
 *
 * El writer es independiente de Prisma: recibe estructuras planas
 * (`MspExportTask`, `MspExportDep`, `MspExportResource`) y devuelve un
 * string XML serializado con la cabecera estándar. Toda la lógica de
 * conversión a tipos MSP (LinkLag en décimas de minuto, OutlineNumber
 * recursivo, Priority numérica) vive aquí para que sea fácilmente
 * testeable sin tocar la base de datos.
 *
 * Decisiones aplicadas:
 *  - D11 · MSP XML 2003+ es el formato canónico de interop.
 *  - D19 · Lead negativo (LinkLag<0) está permitido. No clamp.
 *  - D20 · El parser usa `parseTagValue: false`; aquí el writer fuerza
 *    los tipos numéricos como `number` (no string) y deja que XMLBuilder
 *    los serialice. Booleans se serializan como 0/1 (convención MSP).
 *
 * Convenciones MSP que respetamos:
 *  - `LinkLag` se expresa en décimas de minuto (8h × 60 × 10 = 4800 por
 *    día, asumiendo jornada de 8h. Mismo factor que el reader cuando se
 *    invierta la operación).
 *  - `LagFormat: 7` = días (constante MSP).
 *  - `Type` en PredecessorLink: 0=FF, 1=FS, 2=SS, 3=SF (orden estándar
 *    publicado en MS Project Schema 2003).
 *  - `Priority` numérica 0-1000: mapeo LOW=125, MEDIUM=500, HIGH=750,
 *    CRITICAL=900. MSP estándar suele usar 500 como default.
 *  - `OutlineNumber`: representación jerárquica "1.2.3" calculada por
 *    índice ordinal entre hermanos (no usa el `position` real, sino el
 *    orden de aparición en el array tras agrupar por parent).
 */

import { XMLBuilder } from 'fast-xml-parser'

// ───────────────────────── Tipos del input ─────────────────────────

export interface MspExportTask {
  id: string
  /** UID sintético generado por el caller (1, 2, 3...). MSP requiere unicidad por proyecto. */
  uid: number
  title: string
  startDate: Date
  endDate: Date
  isMilestone: boolean
  parentId: string | null
  /** 0-100. */
  progress: number
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  /** Posición libre dentro del set; el writer usa el orden del array. */
  position: number
}

export interface MspExportDep {
  predecessorId: string
  successorId: string
  type: 'FS' | 'SS' | 'FF' | 'SF'
  /** Días enteros (positivos = lag, negativos = lead — D19). */
  lagDays: number
}

export interface MspExportResource {
  uid: number
  email: string
  name: string
}

export interface BuildMspInput {
  projectName: string
  tasks: MspExportTask[]
  deps: MspExportDep[]
  resources: MspExportResource[]
  /** Override opcional para tests deterministas. */
  creationDate?: Date
}

// ───────────────────────── Constantes de mapping ─────────────────────────

/**
 * Décimas de minuto por día asumiendo jornada de 8 horas.
 * 8h × 60 min × 10 décimas = 4800. Mismo factor en el sentido inverso al
 * importar; mantenerlo aquí en una constante hace trivial cualquier
 * cambio futuro a calendarios distintos (HU-P1.5).
 */
const LAG_TENTHS_PER_DAY = 4800

/** Tipo PredecessorLink en MSP XML (orden FF, FS, SS, SF). */
const DEP_TYPE_TO_MSP: Record<MspExportDep['type'], 0 | 1 | 2 | 3> = {
  FF: 0,
  FS: 1,
  SS: 2,
  SF: 3,
}

/** Priority numérica 0-1000 (MSP). */
const PRIORITY_TO_MSP: Record<MspExportTask['priority'], number> = {
  LOW: 125,
  MEDIUM: 500,
  HIGH: 750,
  CRITICAL: 900,
}

/** LagFormat 7 = días. Otros valores: 4=horas, 5=hours-elapsed, etc. */
const LAG_FORMAT_DAYS = 7

// ───────────────────────── Helpers internos ─────────────────────────

function toIsoNoMs(d: Date): string {
  // MSP estándar usa formato `YYYY-MM-DDTHH:mm:ss` sin milisegundos ni Z.
  // toISOString() retorna `…sss.mmmZ`; truncar al segundo cubre el spec
  // sin necesidad de date-fns.
  return d.toISOString().slice(0, 19)
}

function bool01(v: boolean): 0 | 1 {
  return v ? 1 : 0
}

/**
 * Calcula `OutlineLevel` (profundidad 1-based) y `OutlineNumber` (string
 * jerárquico "1.2.3") por cada task. Asume:
 *  - Las tareas raíz tienen `parentId === null`.
 *  - El orden de aparición en el array `tasks` define el orden entre
 *    hermanos (los callers deben pre-ordenar por `position` o similar).
 *  - Una task ausente como parent (id desconocido) se trata como raíz —
 *    salvaguarda contra datos sucios; no debería pasar en producción.
 */
function computeOutline(tasks: MspExportTask[]): Map<
  string,
  { level: number; number: string; hasChildren: boolean }
> {
  const taskById = new Map<string, MspExportTask>()
  for (const t of tasks) taskById.set(t.id, t)

  // Agrupar hijos por parentId preservando orden de aparición.
  const childrenByParent = new Map<string | null, MspExportTask[]>()
  for (const t of tasks) {
    const key = t.parentId && taskById.has(t.parentId) ? t.parentId : null
    const arr = childrenByParent.get(key) ?? []
    arr.push(t)
    childrenByParent.set(key, arr)
  }

  const result = new Map<
    string,
    { level: number; number: string; hasChildren: boolean }
  >()

  function walk(parentId: string | null, prefix: string, level: number) {
    const kids = childrenByParent.get(parentId) ?? []
    kids.forEach((kid, idx) => {
      const ordinal = idx + 1
      const number = prefix ? `${prefix}.${ordinal}` : String(ordinal)
      const hasChildren = (childrenByParent.get(kid.id) ?? []).length > 0
      result.set(kid.id, { level, number, hasChildren })
      walk(kid.id, number, level + 1)
    })
  }

  walk(null, '', 1)
  return result
}

function slugForName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ───────────────────────── Build principal ─────────────────────────

/**
 * Construye el XML de MS Project a partir de tareas, dependencias y
 * recursos. Retorna el XML completo como string (incluye declaration).
 *
 * Notas de implementación:
 *  - La estructura JSON intermedia respeta el orden de campos del schema
 *    MSP. `XMLBuilder` preserva orden de propiedades del objeto, así que
 *    construirlo en el orden esperado nos da serialización determinista
 *    (clave para el round-trip de tests y para diffs en VCS).
 *  - `PredecessorLink` se inyecta dentro de cada Task sucesora; se usa
 *    array vacío `[]` cuando no hay deps para que `XMLBuilder` no genere
 *    una etiqueta `<PredecessorLink/>` solitaria.
 *  - StartDate/FinishDate del proyecto se calculan como min/max de las
 *    fechas de tasks (fallback al CreationDate si tasks=0).
 */
export function buildMspXml(input: BuildMspInput): string {
  const { projectName, tasks, deps, resources } = input
  const creationDate = input.creationDate ?? new Date()

  // Lookup id → uid para resolver PredecessorLink (cada dep apunta al uid
  // del predecesor, no al id interno de FollowupGantt).
  const uidByTaskId = new Map<string, number>()
  for (const t of tasks) uidByTaskId.set(t.id, t.uid)

  // Group deps by successor para inyectarlas dentro de cada Task.
  const depsBySuccessor = new Map<string, MspExportDep[]>()
  for (const d of deps) {
    const arr = depsBySuccessor.get(d.successorId) ?? []
    arr.push(d)
    depsBySuccessor.set(d.successorId, arr)
  }

  // Calcular OutlineNumber/Level/hasChildren.
  const outline = computeOutline(tasks)

  // Bounds del proyecto.
  let projectStart: Date | null = null
  let projectEnd: Date | null = null
  for (const t of tasks) {
    if (!projectStart || t.startDate < projectStart) projectStart = t.startDate
    if (!projectEnd || t.endDate > projectEnd) projectEnd = t.endDate
  }
  const startIso = toIsoNoMs(projectStart ?? creationDate)
  const finishIso = toIsoNoMs(projectEnd ?? creationDate)

  // ─── Construcción del árbol JSON que se serializa a XML ───
  //
  // Mantener el orden de claves: XMLBuilder respeta insertion-order de
  // las props del objeto. Esto es load-bearing para que el XML sea
  // canónico (tests + diff humano).
  const projectObj = {
    Project: {
      '@_xmlns': 'http://schemas.microsoft.com/project',
      SaveVersion: 14,
      Name: slugForName(projectName) || 'proyecto',
      Title: projectName,
      CreationDate: toIsoNoMs(creationDate),
      StartDate: startIso,
      FinishDate: finishIso,
      CalendarUID: 1,

      Calendars: {
        Calendar: {
          UID: 1,
          Name: 'Standard',
          IsBaseCalendar: 1,
        },
      },

      Resources:
        resources.length === 0
          ? { Resource: [] }
          : {
              Resource: resources.map((r) => ({
                UID: r.uid,
                ID: r.uid,
                Name: r.name,
                EmailAddress: r.email,
                // Type=1 → Work resource (vs. Material=0). Today todos los
                // assignees del Gantt se modelan como Work.
                Type: 1,
              })),
            },

      Tasks: {
        Task: tasks.map((t, idx) => {
          const ord = idx + 1 // ID secuencial 1-based independiente del UID.
          const out = outline.get(t.id) ?? {
            level: 1,
            number: String(ord),
            hasChildren: false,
          }
          const taskDeps = depsBySuccessor.get(t.id) ?? []

          const taskObj: Record<string, unknown> = {
            UID: t.uid,
            ID: ord,
            Name: t.title,
            // Type=1 → Fixed-Duration. Coincide con cómo se modela en el
            // Gantt actual (start/end son la verdad, no esfuerzo).
            Type: 1,
            Start: toIsoNoMs(t.startDate),
            Finish: toIsoNoMs(t.endDate),
            Milestone: bool01(t.isMilestone),
            Summary: bool01(out.hasChildren),
            OutlineLevel: out.level,
            OutlineNumber: out.number,
            PercentComplete: t.progress,
            Priority: PRIORITY_TO_MSP[t.priority],
          }

          if (taskDeps.length > 0) {
            taskObj.PredecessorLink = taskDeps.map((d) => ({
              PredecessorUID: uidByTaskId.get(d.predecessorId) ?? 0,
              Type: DEP_TYPE_TO_MSP[d.type],
              CrossProject: 0,
              LinkLag: d.lagDays * LAG_TENTHS_PER_DAY,
              LagFormat: LAG_FORMAT_DAYS,
            }))
          }

          return taskObj
        }),
      },
    },
  }

  // ─── Serialización ───
  //
  // Config equivalente a la que usará el reader (D20):
  //  - `ignoreAttributes: false` → respetar `@_xmlns`.
  //  - `attributeNamePrefix: '@_'` → consistente con parser.
  //  - `format: true` + `indentBy: '  '` → output legible.
  //  - `suppressEmptyNode: false` → conservar etiquetas vacías para que
  //    MSP no marque el archivo como inválido si una sección queda sin
  //    elementos (p. ej. proyecto sin recursos).
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    indentBy: '  ',
    suppressEmptyNode: false,
    processEntities: true,
  })

  const body = builder.build(projectObj) as string
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`
}
