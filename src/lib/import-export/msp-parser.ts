/**
 * HU-4.1 · Parser puro de MS Project XML 2003+ (D11).
 *
 * El parser es independiente de Prisma: recibe un string XML y devuelve
 * estructuras planas (`MspTaskRow`, `MspDepRow`, `MspResourceRow`) más
 * `warnings/errors` tipados. Lo consumen tanto el endpoint REST
 * `/api/import/preview` (preflight, no toca BD) como la server action
 * `importMspXml` (commit transaccional all-or-nothing — D5).
 *
 * Decisiones aplicadas:
 *  - D11 · MSP XML 2003+ es source-of-truth. Pre-2003 (root distinto al
 *    namespace oficial) → `[INVALID_FILE]`. Archivos `.mpp` binarios el
 *    parser no los toca: el caller los rechaza por extensión.
 *  - D13 · NO crear `User` desde Resources sin match. Warning + skip al
 *    asignar (la action es la que resuelve el lookup contra BD).
 *  - D15 · Slack negativo NO bloquea import — la action emite warning
 *    `[NEGATIVE_FLOAT_POST_IMPORT]` después del commit.
 *  - D17 · Tope 5 MB se valida en route/action, no aquí.
 *  - D19 · Lead negativo (`LinkLag<0`) se preserva. Solo se clamp si el
 *    valor en días excede `LAG_LIMITS`.
 *  - D20 · `parseTagValue: false` obligatorio. fast-xml-parser puede
 *    convertir "1" → 1 silenciosamente y eso rompe el contrato con
 *    `cellToString`/zod; preferimos coerción explícita vía `z.coerce`.
 *
 * Convenciones MSP que respetamos (alineadas con `msp-writer.ts`):
 *  - `LinkLag` en décimas de minuto sobre días laborales (4800 / día).
 *  - Tipos de PredecessorLink: 0=FF, 1=FS, 2=SS, 3=SF.
 *  - `Priority` 0-1000 → enum vía `mspPriorityToEnum`.
 *  - `OutlineNumber` "1.2.3" determina la jerarquía; usamos prefijo para
 *    resolver `parentExternalId` sin construir un árbol explícito.
 */

import { XMLParser } from 'fast-xml-parser'
import { z } from 'zod'
import { wouldCreateCycle, type DependencyEdge } from '@/lib/scheduling/cycle'
import {
  LAG_LIMITS,
  MAX_DEPS_PER_IMPORT,
  MAX_TASKS_PER_IMPORT,
  MSP_DEPENDENCY_TYPE_MAP,
  MSP_LAG_TO_DAYS_FACTOR,
  mspPriorityToEnum,
  type ImportError,
  type ImportWarning,
  type PriorityKey,
} from './MAPPING'

// ───────────────────────── Tipos públicos ─────────────────────────

export interface MspTaskRow {
  /** UID original MSP (numérico, único por proyecto). */
  uid: number
  /** Identificador estable usado para lookups: `msp-uid-${UID}`. */
  externalId: string
  title: string
  startDate: Date
  endDate: Date
  isMilestone: boolean
  parentExternalId: string | null
  outlineNumber: string
  outlineLevel: number
  /** 0-100. */
  progress: number
  priority: PriorityKey
  description: string | null
  referenceUrl: string | null
  /** ID secuencial 1-based asignado por MSP (no es el UID). Usado solo en errores. */
  mspId: number
}

export interface MspDepRow {
  predecessorExternalId: string
  successorExternalId: string
  type: 'FS' | 'SS' | 'FF' | 'SF'
  /** Días enteros tras conversión y clamp (D19 preserva lead negativo). */
  lagDays: number
}

export interface MspResourceRow {
  uid: number
  email: string | null
  name: string
  /** Tasks (externalId) en las que figura asignado. */
  assignedTaskExternalIds: string[]
}

export interface ParsedMsp {
  projectName: string | null
  tasks: MspTaskRow[]
  deps: MspDepRow[]
  resources: MspResourceRow[]
  warnings: ImportWarning[]
  errors: ImportError[]
}

// ───────────────────────── Schemas zod (parsed XML) ─────────────────────────

/**
 * Schemas tras el parse de fast-xml-parser. Como `parseTagValue: false`
 * obliga a que todo llegue como string, usamos `z.coerce` para los
 * numéricos y validamos rangos. Los campos opcionales del XML que no
 * están presentes simplemente se omiten (zod los marca como undefined
 * y los defaulteamos al transformar).
 */
const PredecessorLinkSchema = z.object({
  PredecessorUID: z.coerce.number().int(),
  Type: z.coerce.number().int().min(0).max(3).default(1),
  LinkLag: z.coerce.number().int().default(0),
  /** LagFormat: 7=days, 4=hours, etc. Hoy solo lo registramos para warnings futuros. */
  LagFormat: z.coerce.number().int().optional(),
  CrossProject: z.coerce.number().int().optional(),
})

const MspTaskSchema = z.object({
  UID: z.coerce.number().int(),
  ID: z.coerce.number().int().optional(),
  Name: z.string().min(1).max(500),
  Start: z.string().min(1),
  Finish: z.string().min(1),
  Milestone: z.coerce.number().int().optional(),
  Summary: z.coerce.number().int().optional(),
  Active: z.coerce.number().int().optional(),
  OutlineLevel: z.coerce.number().int().min(1).optional(),
  OutlineNumber: z.string().optional(),
  PercentComplete: z.coerce.number().int().min(0).max(100).optional(),
  Priority: z.coerce.number().int().min(0).max(1000).optional(),
  Notes: z.string().optional(),
  HyperlinkAddress: z.string().optional(),
  ConstraintType: z.coerce.number().int().optional(),
  CalendarUID: z.coerce.number().int().optional(),
  PredecessorLink: z.array(PredecessorLinkSchema).optional(),
})

const MspResourceSchema = z.object({
  UID: z.coerce.number().int(),
  ID: z.coerce.number().int().optional(),
  Name: z.string().min(1),
  EmailAddress: z.string().optional(),
  /** Type: 0=Material, 1=Work, 2=Cost. Solo Work se mapea (D13). */
  Type: z.coerce.number().int().optional(),
})

const MspAssignmentSchema = z.object({
  UID: z.coerce.number().int().optional(),
  TaskUID: z.coerce.number().int(),
  ResourceUID: z.coerce.number().int(),
})

// ───────────────────────── Helpers públicos ─────────────────────────

/**
 * Strip BOM (U+FEFF) al inicio del string. Cubre UTF-8 y UTF-16
 * representados como string JS (charCode 0xFEFF). Si el archivo entra
 * en UTF-16 binario `Buffer.toString('utf-8')` ya lo decodifica con BOM
 * BMP-coded, así que un solo check basta.
 */
export function stripBom(input: string): string {
  if (input.charCodeAt(0) === 0xfeff) return input.slice(1)
  return input
}

// ───────────────────────── Helpers internos ─────────────────────────

const XMLPARSER_CONFIG = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // D20: nunca convertir "1" en 1. Mantener strings y validar con zod.
  parseTagValue: false,
  parseAttributeValue: false,
  // XXE-safe: deshabilitar entidades. fast-xml-parser tampoco resuelve
  // DTD por defecto, pero ser explícitos protege contra futuros cambios
  // en la lib.
  processEntities: false,
  allowBooleanAttributes: true,
  // Forzar arrays para los nodos repetibles para evitar la rama
  // "objeto vs. array" en cada acceso.
  isArray: (name: string) =>
    name === 'Task' ||
    name === 'Resource' ||
    name === 'Assignment' ||
    name === 'PredecessorLink',
}

const MSP_NAMESPACE = 'http://schemas.microsoft.com/project'

function externalIdFromUid(uid: number): string {
  return `msp-uid-${uid}`
}

/**
 * Parsea fechas del XML MSP. MSP usa `YYYY-MM-DDTHH:mm:ss` sin TZ. Hoy
 * tratamos esos timestamps como UTC (consistente con el writer). Si el
 * string viene con sufijo `Z`/offset también se respeta.
 */
function parseMspDate(s: string): Date | null {
  if (!s) return null
  const trimmed = s.trim()
  if (!trimmed) return null
  // Si no tiene info de TZ y parece un ISO local → tratar como UTC.
  // Date.parse es tolerante; solo rechazamos si NaN.
  const hasTz = /Z$|[+-]\d{2}:?\d{2}$/.test(trimmed)
  const candidate = hasTz ? trimmed : `${trimmed}Z`
  const t = Date.parse(candidate)
  if (Number.isNaN(t)) return null
  return new Date(t)
}

/**
 * Convierte LinkLag MSP (décimas de minuto/día laboral) a días enteros.
 * Redondeo banker: usar `Math.round` para que 4799 → 1d (no 0d).
 */
function lagTenthsToDays(tenths: number): number {
  return Math.round(tenths / MSP_LAG_TO_DAYS_FACTOR)
}

/**
 * Strip de tags HTML y RTF muy básico — solo lo necesario para sanear
 * el campo `Notes` que MSP a veces serializa con markup. No buscamos
 * ser un parser HTML completo, solo evitar guardar `<b>texto</b>` como
 * descripción visible.
 */
function stripMarkup(s: string | undefined | null): string | null {
  if (!s) return null
  // RTF starts with `{\rtf...`. Si detectamos eso, devolvemos la cola
  // tras el último `\` (heurística simple).
  if (s.startsWith('{\\rtf')) {
    const last = s.lastIndexOf('\\')
    const tail = s.slice(last + 1).replace(/[{}]/g, '').trim()
    return tail || null
  }
  // Strip <tags>.
  const noTags = s.replace(/<[^>]+>/g, '')
  const trimmed = noTags.trim()
  return trimmed || null
}

interface ParsedTaskNode {
  uid: number
  mspId: number
  name: string
  start: Date
  end: Date
  isMilestone: boolean
  isSummary: boolean
  outlineLevel: number
  outlineNumber: string
  progress: number
  priority: PriorityKey
  description: string | null
  referenceUrl: string | null
  predecessorLinks: z.infer<typeof PredecessorLinkSchema>[]
  hasConstraint: boolean
  hasCustomCalendar: boolean
  active: boolean
}

/**
 * Resuelve el `parentExternalId` por OutlineNumber. Para "1.2.3" el padre
 * es la tarea con OutlineNumber "1.2"; para "1" no hay padre.
 *
 * Devuelve null si:
 *  - OutlineNumber está vacío.
 *  - No tiene "." (root).
 *  - El padre calculado no existe (edge case: file sucio; lo tratamos
 *    como root y dejamos que el caller emita warning si quiere).
 */
function resolveParentByOutline(
  outlineNumber: string,
  byOutline: Map<string, number>,
): number | null {
  if (!outlineNumber) return null
  const lastDot = outlineNumber.lastIndexOf('.')
  if (lastDot < 0) return null
  const parentOutline = outlineNumber.slice(0, lastDot)
  const parentUid = byOutline.get(parentOutline)
  return parentUid ?? null
}

// ───────────────────────── Parse principal ─────────────────────────

export function parseMspXml(xmlString: string): ParsedMsp {
  const errors: ImportError[] = []
  const warnings: ImportWarning[] = []

  const empty: ParsedMsp = {
    projectName: null,
    tasks: [],
    deps: [],
    resources: [],
    warnings,
    errors,
  }

  const stripped = stripBom(xmlString ?? '')
  if (!stripped.trim()) {
    errors.push({
      code: 'INVALID_FILE',
      detail: 'archivo XML vacío',
      sheet: 'MSP',
    })
    return empty
  }

  // ─── Parse XML ───
  let doc: Record<string, unknown>
  try {
    const parser = new XMLParser(XMLPARSER_CONFIG)
    doc = parser.parse(stripped) as Record<string, unknown>
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    errors.push({
      code: 'INVALID_FILE',
      detail: `XML mal formado: ${detail}`,
      sheet: 'MSP',
    })
    return empty
  }

  const project = doc?.Project as Record<string, unknown> | undefined
  if (!project) {
    errors.push({
      code: 'INVALID_FILE',
      detail: 'falta nodo raíz <Project> (esperado MSP XML 2003+)',
      sheet: 'MSP',
    })
    return empty
  }

  // D11 · validar namespace MSP (rechaza pre-2003 y otros XMLs).
  const xmlns = project['@_xmlns']
  if (xmlns !== MSP_NAMESPACE) {
    errors.push({
      code: 'INVALID_FILE',
      detail: `namespace MSP esperado "${MSP_NAMESPACE}", recibido "${xmlns ?? '(ausente)'}"`,
      sheet: 'MSP',
    })
    return empty
  }

  const projectName =
    (typeof project.Title === 'string' && project.Title) ||
    (typeof project.Name === 'string' && project.Name) ||
    null

  // ─── Tasks ───
  const tasksContainer = project.Tasks as
    | { Task?: unknown[] }
    | undefined
  const rawTasks = (tasksContainer?.Task ?? []) as unknown[]

  if (rawTasks.length > MAX_TASKS_PER_IMPORT) {
    errors.push({
      code: 'INVALID_FILE',
      detail: `el archivo supera el tope de ${MAX_TASKS_PER_IMPORT} tareas`,
      sheet: 'Tareas',
    })
    return { ...empty, projectName }
  }

  const parsedTasks: ParsedTaskNode[] = []
  const seenUids = new Set<number>()
  const seenOutline = new Set<string>()

  for (const raw of rawTasks) {
    const result = MspTaskSchema.safeParse(raw)
    if (!result.success) {
      const issue = result.error.issues[0]
      const uidGuess =
        typeof (raw as { UID?: unknown })?.UID !== 'undefined'
          ? Number((raw as { UID: unknown }).UID)
          : NaN
      errors.push({
        code: 'INVALID_ROW',
        detail: `Task ${Number.isFinite(uidGuess) ? `UID=${uidGuess}` : '(sin UID)'} → ${issue.path.join('.') || 'row'}: ${issue.message}`,
        sheet: 'Tareas',
        row: Number.isFinite(uidGuess) ? uidGuess : undefined,
      })
      continue
    }

    const t = result.data

    // Active=false (MSP "Inactive task") → skip silencioso con warning (D11).
    if (t.Active !== undefined && Number(t.Active) === 0) {
      warnings.push({
        code: 'INACTIVE_TASK_SKIPPED',
        detail: `Task UID=${t.UID} marcada como inactiva — se omite`,
        sheet: 'Tareas',
        row: t.UID,
      })
      continue
    }

    if (seenUids.has(t.UID)) {
      errors.push({
        code: 'DUPLICATE_MNEMONIC',
        detail: `UID duplicado: ${t.UID}`,
        sheet: 'Tareas',
        row: t.UID,
      })
      continue
    }
    seenUids.add(t.UID)

    const start = parseMspDate(t.Start)
    const end = parseMspDate(t.Finish)
    if (!start || !end) {
      errors.push({
        code: 'INVALID_ROW',
        detail: `Task UID=${t.UID} sin Start/Finish válidos`,
        sheet: 'Tareas',
        row: t.UID,
      })
      continue
    }

    const outlineNumber = t.OutlineNumber ?? ''
    if (outlineNumber && seenOutline.has(outlineNumber)) {
      errors.push({
        code: 'INVALID_FILE',
        detail: `OutlineNumber duplicado: ${outlineNumber}`,
        sheet: 'Tareas',
        row: t.UID,
      })
      continue
    }
    if (outlineNumber) seenOutline.add(outlineNumber)

    const isSummary = Number(t.Summary ?? 0) === 1
    const isMilestone = Number(t.Milestone ?? 0) === 1
    const progress = t.PercentComplete ?? 0
    const priority = mspPriorityToEnum(t.Priority ?? 500)
    const hasConstraint =
      t.ConstraintType !== undefined && Number(t.ConstraintType) > 0
    // CalendarUID=1 es el calendario "Standard" del proyecto (mismo que
    // exportamos). Solo registramos warning si la task referencia uno
    // distinto — implica calendarios custom (P1.5 según D7).
    const hasCustomCalendar =
      t.CalendarUID !== undefined && Number(t.CalendarUID) > 1

    parsedTasks.push({
      uid: t.UID,
      mspId: t.ID ?? t.UID,
      name: t.Name,
      start,
      end,
      isMilestone,
      isSummary,
      outlineLevel: t.OutlineLevel ?? 1,
      outlineNumber,
      progress,
      priority,
      description: stripMarkup(t.Notes),
      referenceUrl: t.HyperlinkAddress?.trim() || null,
      predecessorLinks: t.PredecessorLink ?? [],
      hasConstraint,
      hasCustomCalendar,
      active: true,
    })
  }

  // Si se acumularon errores fatales en la fase Tasks, salimos antes de
  // intentar resolver dependencias (su validación cruzada no aporta nada
  // si la lista de tareas está corrupta).
  if (errors.length > 0) {
    return { ...empty, projectName, errors, warnings }
  }

  // ─── Reportar warnings de constraints/calendarios ───
  for (const t of parsedTasks) {
    if (t.hasConstraint) {
      warnings.push({
        code: 'CONSTRAINT_IGNORED',
        detail: `Task UID=${t.uid} tiene ConstraintType — se ignora (deferido a P1.5)`,
        sheet: 'Tareas',
        row: t.uid,
      })
    }
    if (t.hasCustomCalendar) {
      warnings.push({
        code: 'CALENDAR_IGNORED',
        detail: `Task UID=${t.uid} usa calendario custom — se ignora (deferido a P1.5)`,
        sheet: 'Tareas',
        row: t.uid,
      })
    }
  }

  // ─── Resolver jerarquía por OutlineNumber ───
  const uidByOutline = new Map<string, number>()
  for (const t of parsedTasks) {
    if (t.outlineNumber) uidByOutline.set(t.outlineNumber, t.uid)
  }

  const taskRows: MspTaskRow[] = parsedTasks.map((t) => {
    const parentUid = resolveParentByOutline(t.outlineNumber, uidByOutline)
    return {
      uid: t.uid,
      mspId: t.mspId,
      externalId: externalIdFromUid(t.uid),
      title: t.name,
      startDate: t.start,
      endDate: t.end,
      isMilestone: t.isMilestone,
      parentExternalId: parentUid !== null ? externalIdFromUid(parentUid) : null,
      outlineNumber: t.outlineNumber,
      outlineLevel: t.outlineLevel,
      progress: t.progress,
      priority: t.priority,
      description: t.description,
      referenceUrl: t.referenceUrl,
    }
  })

  // ─── Dependencias ───
  const uidExists = new Set(parsedTasks.map((t) => t.uid))
  const depRows: MspDepRow[] = []
  let depCount = 0

  for (const t of parsedTasks) {
    for (const link of t.predecessorLinks) {
      depCount++
      if (depCount > MAX_DEPS_PER_IMPORT) {
        errors.push({
          code: 'INVALID_FILE',
          detail: `el archivo supera el tope de ${MAX_DEPS_PER_IMPORT} dependencias`,
          sheet: 'Dependencias',
        })
        break
      }
      if (!uidExists.has(link.PredecessorUID)) {
        errors.push({
          code: 'ORPHAN_DEPENDENCY',
          detail: `PredecessorUID=${link.PredecessorUID} inexistente (sucesora UID=${t.uid})`,
          sheet: 'Dependencias',
          row: t.uid,
        })
        continue
      }
      const type = MSP_DEPENDENCY_TYPE_MAP[
        link.Type as 0 | 1 | 2 | 3
      ] as 'FF' | 'FS' | 'SS' | 'SF' | undefined
      if (!type) {
        errors.push({
          code: 'INVALID_ROW',
          detail: `Type inválido (${link.Type}) en dep PredecessorUID=${link.PredecessorUID} → UID=${t.uid}`,
          sheet: 'Dependencias',
          row: t.uid,
        })
        continue
      }

      // Lag: convertir décimas → días, luego clamp [-30, 365]. D19 preserva
      // lead negativo pero respeta el tope inferior si excede 30 días.
      const rawLagDays = lagTenthsToDays(link.LinkLag)
      let lagDays = rawLagDays
      if (lagDays < LAG_LIMITS.min || lagDays > LAG_LIMITS.max) {
        const clamped = Math.max(
          LAG_LIMITS.min,
          Math.min(LAG_LIMITS.max, lagDays),
        )
        warnings.push({
          code: 'LAG_CLAMPED',
          detail: `Dep ${link.PredecessorUID} → ${t.uid} lag=${lagDays}d fuera de [${LAG_LIMITS.min}, ${LAG_LIMITS.max}]; ajustado a ${clamped}`,
          sheet: 'Dependencias',
          row: t.uid,
        })
        lagDays = clamped
      }

      depRows.push({
        predecessorExternalId: externalIdFromUid(link.PredecessorUID),
        successorExternalId: externalIdFromUid(t.uid),
        type,
        lagDays,
      })
    }
    if (depCount > MAX_DEPS_PER_IMPORT) break
  }

  // Detección de ciclos sobre las deps acumuladas. Replicamos la
  // estrategia del Excel parser: simulamos inserción incremental para
  // localizar la arista que cierra el ciclo.
  const accumulated: DependencyEdge[] = []
  const okPairs = new Set<string>()
  for (const d of depRows) {
    if (
      wouldCreateCycle(
        accumulated,
        d.predecessorExternalId,
        d.successorExternalId,
      )
    ) {
      errors.push({
        code: 'CYCLE_DETECTED',
        detail: `dependencia ${d.predecessorExternalId} → ${d.successorExternalId} cerraría un ciclo`,
        sheet: 'Dependencias',
      })
      continue
    }
    accumulated.push({
      predecessorId: d.predecessorExternalId,
      successorId: d.successorExternalId,
    })
    okPairs.add(`${d.predecessorExternalId}|${d.successorExternalId}`)
  }
  // Filtrar deps con ciclo del output final.
  const finalDeps = depRows.filter((d) =>
    okPairs.has(`${d.predecessorExternalId}|${d.successorExternalId}`),
  )

  // ─── Resources + Assignments ───
  const resourcesContainer = project.Resources as
    | { Resource?: unknown[] }
    | undefined
  const rawResources = (resourcesContainer?.Resource ?? []) as unknown[]
  const assignmentsContainer = project.Assignments as
    | { Assignment?: unknown[] }
    | undefined
  const rawAssignments = (assignmentsContainer?.Assignment ?? []) as unknown[]

  // Index de asignaciones por TaskUID — para detectar múltiples assignees
  // por tarea (D13 — ignoramos extras con warning).
  const assignmentsByTask = new Map<number, number[]>()
  for (const rawA of rawAssignments) {
    const r = MspAssignmentSchema.safeParse(rawA)
    if (!r.success) continue
    const a = r.data
    const list = assignmentsByTask.get(a.TaskUID) ?? []
    list.push(a.ResourceUID)
    assignmentsByTask.set(a.TaskUID, list)
  }

  const resourceRows: MspResourceRow[] = []
  for (const rawR of rawResources) {
    const r = MspResourceSchema.safeParse(rawR)
    if (!r.success) {
      // Recurso UID=0 reservado por MSP para "Unassigned" — no es error.
      if (
        (rawR as { UID?: unknown })?.UID === '0' ||
        (rawR as { UID?: unknown })?.UID === 0
      ) {
        continue
      }
      const issue = r.error.issues[0]
      warnings.push({
        code: 'RESOURCE_NO_MATCH',
        detail: `Resource inválido: ${issue.path.join('.') || 'row'} ${issue.message}`,
        sheet: 'Recursos',
      })
      continue
    }
    const res = r.data
    if (res.UID === 0) continue // "Unassigned" placeholder.

    // Type=1 = Work; 0=Material, 2=Cost. Ignoramos no-Work.
    const type = res.Type ?? 1
    if (type !== 1) {
      warnings.push({
        code: 'MATERIAL_RESOURCE_IGNORED',
        detail: `Resource UID=${res.UID} (${res.Name}) tipo=${type} — solo se importan Work resources`,
        sheet: 'Recursos',
        row: res.UID,
      })
      continue
    }

    const email = res.EmailAddress?.trim() || null
    // Tasks asignadas a este recurso:
    const assignedUids: number[] = []
    for (const [taskUid, resUids] of assignmentsByTask) {
      const idx = resUids.indexOf(res.UID)
      if (idx === -1) continue
      // Si idx>0, es una asignación extra para esa task → warning ya se
      // reporta abajo, pero la primer asignación sí se respeta.
      if (idx === 0) assignedUids.push(taskUid)
    }

    resourceRows.push({
      uid: res.UID,
      email,
      name: res.Name,
      assignedTaskExternalIds: assignedUids
        .filter((u) => uidExists.has(u))
        .map(externalIdFromUid),
    })
  }

  // Warning por tasks con >1 assignee (D13 — solo se respeta el primero).
  for (const [taskUid, resUids] of assignmentsByTask) {
    if (resUids.length > 1 && uidExists.has(taskUid)) {
      warnings.push({
        code: 'MULTIPLE_ASSIGNMENTS_IGNORED',
        detail: `Task UID=${taskUid} tiene ${resUids.length} asignaciones — solo se importa la primera`,
        sheet: 'Tareas',
        row: taskUid,
      })
    }
  }

  return {
    projectName,
    tasks: taskRows,
    deps: finalDeps,
    resources: resourceRows,
    warnings,
    errors,
  }
}
