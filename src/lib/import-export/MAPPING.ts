/**
 * HU-4.5 · MAPEO CANÓNICO MSP / Excel ↔ FollowupGantt.
 *
 * Documentación en código (TypeScript) en lugar de `.md` por convención
 * del proyecto. Este archivo es la fuente única de verdad para los
 * convertidores de import/export y la base de los tests round-trip.
 *
 * Si cambias una constante aquí, debes:
 *   1. Sincronizar los tests `tests/unit/excel-*.test.ts`.
 *   2. Actualizar el writer (`excel-writer.ts`) y el parser
 *      (`excel-parser.ts`).
 *   3. Notificar al equipo: cualquier consumidor externo (Power Query,
 *      scripts MSP) puede romperse.
 *
 * ──────────────────────────────────────────────────────────────────
 * 1. ESQUEMA DE HOJAS — el archivo `.xlsx` canónico tiene 3 hojas
 *    en orden estricto:
 *
 *    Hoja 1: "Tareas"
 *      mnemonic | title | parent_mnemonic | start_date | end_date |
 *      duration_days | is_milestone | progress | priority |
 *      assignee_email | tags | description
 *
 *    Hoja 2: "Dependencias"
 *      predecessor_mnemonic | successor_mnemonic | type | lag_days
 *
 *    Hoja 3: "Recursos"
 *      email | name | role
 *
 * ──────────────────────────────────────────────────────────────────
 * 2. MAPEO MSP (Microsoft Project) ↔ FollowupGantt
 *
 *    MSP TaskUID         ↔  Task.id (UUID generado en import)
 *    MSP UniqueID        ↔  Task.mnemonic (string `[A-Z0-9-]{1,40}`)
 *    MSP Name            ↔  Task.title
 *    MSP OutlineParent   ↔  Task.parentId (resuelto vía `parent_mnemonic`)
 *    MSP Start           ↔  Task.startDate (UTC, sin hora)
 *    MSP Finish          ↔  Task.endDate (UTC, sin hora; INCLUSIVO)
 *    MSP Milestone       ↔  Task.isMilestone
 *    MSP PercentComplete ↔  Task.progress (0..100)
 *    MSP Priority        ↔  Task.priority (vía `PRIORITY_MAP`)
 *    MSP ResourceNames   ↔  Task.assignee (resuelto vía email)
 *    MSP Notes           ↔  Task.description
 *
 *    MSP PredecessorLink ↔  TaskDependency
 *    MSP LinkType        ↔  TaskDependency.type (vía
 *                            `MSP_DEPENDENCY_TYPE_MAP`)
 *    MSP LinkLag         ↔  TaskDependency.lagDays (décimas de minuto
 *                            por día laboral, ver `MSP_LAG_TO_DAYS_FACTOR`)
 *
 * ──────────────────────────────────────────────────────────────────
 * 3. CÓDIGOS DE ERROR / WARNING (importadores)
 *
 *    [INVALID_FILE]         — extensión o MIME no soportado.
 *    [FILE_TOO_LARGE]       — supera 5 MB (D17).
 *    [EXCEL_PARSE]          — exceljs no pudo abrir el workbook.
 *    [INVALID_ROW]          — zod falló al validar una fila.
 *    [DUPLICATE_MNEMONIC]   — dos tareas con el mismo mnemonic.
 *    [INVALID_PARENT_REF]   — parent_mnemonic apunta a una tarea
 *                              inexistente (warning: se promueve a raíz).
 *    [CYCLE_DETECTED]       — la dependencia cerraría un ciclo.
 *    [ORPHAN_DEPENDENCY]    — predecessor o successor inexistentes
 *                              (error: se aborta la fila).
 *    [RESOURCE_NO_MATCH]    — assignee_email sin User correspondiente
 *                              (warning: se importa sin assignee).
 *    [LAG_CLAMPED]          — lag_days fuera de [-30, 365] (warning:
 *                              se acota al rango).
 */

// ───────────────────────── Mapeo de tipos de dependencia ─────────────────────────

/**
 * MSP usa enteros 0-3 para los tipos de dependencia. La asignación
 * sigue la documentación oficial de MSP XML schema (`<LinkType>`):
 *   0 → Finish-to-Finish
 *   1 → Finish-to-Start (default)
 *   2 → Start-to-Start
 *   3 → Start-to-Finish
 *
 * En FollowupGantt usamos las siglas 2-letter en Excel y los valores
 * Prisma (`FINISH_TO_START`, etc.) en BD.
 */
export const MSP_DEPENDENCY_TYPE_MAP = {
  0: 'FF',
  1: 'FS',
  2: 'SS',
  3: 'SF',
} as const

/**
 * Inverso del mapa anterior, útil al exportar a MSP XML.
 */
export const DEPENDENCY_TYPE_TO_MSP = {
  FF: 0,
  FS: 1,
  SS: 2,
  SF: 3,
} as const

/**
 * Mapeo Excel `type` (2-letras) ↔ Prisma enum.
 */
export const DEP_TYPE_2L_TO_PRISMA = {
  FS: 'FINISH_TO_START',
  SS: 'START_TO_START',
  FF: 'FINISH_TO_FINISH',
  SF: 'START_TO_FINISH',
} as const

export const DEP_TYPE_PRISMA_TO_2L = {
  FINISH_TO_START: 'FS',
  START_TO_START: 'SS',
  FINISH_TO_FINISH: 'FF',
  START_TO_FINISH: 'SF',
} as const

// ───────────────────────── Mapeo de prioridades ─────────────────────────

/**
 * MSP usa una escala 0-1000 para `Priority`. El mapeo a nuestros 4
 * buckets sigue la convención Microsoft sugerida en la documentación
 * (rangos usados por MS Project Server al sincronizar con Outlook):
 *
 *   MSP   0-249  → LOW
 *   MSP 250-499  → MEDIUM
 *   MSP 500-749  → HIGH
 *   MSP 750-1000 → CRITICAL
 *
 * Al exportar usamos el centroide del rango como valor representativo.
 */
export const PRIORITY_MAP = {
  LOW: 0,
  MEDIUM: 500,
  HIGH: 750,
  CRITICAL: 999,
} as const

export type PriorityKey = keyof typeof PRIORITY_MAP

/**
 * Convierte un valor MSP `Priority` (0-1000) al enum FollowupGantt.
 */
export function mspPriorityToEnum(mspValue: number): PriorityKey {
  if (mspValue < 250) return 'LOW'
  if (mspValue < 500) return 'MEDIUM'
  if (mspValue < 750) return 'HIGH'
  return 'CRITICAL'
}

// ───────────────────────── Límites operativos ─────────────────────────

/**
 * `lag_days` se permite en el rango `[-30, 365]`. Valores fuera del
 * rango se acotan al límite y se reporta `[LAG_CLAMPED]` warning. La
 * cota inferior cubre lead-time de 1 mes (compresión típica) y la
 * superior cubre lag de 1 año (esperas de aprobación regulatoria).
 */
export const LAG_LIMITS = { min: -30, max: 365 } as const

/**
 * D17 — Tope absoluto del archivo .xlsx aceptado para import. Mayor a
 * esto y casi seguro hay un problema (descripciones gigantes,
 * imágenes embebidas). Impuesto por API y server action.
 */
export const FILE_SIZE_LIMIT_MB = 5
export const FILE_SIZE_LIMIT_BYTES = FILE_SIZE_LIMIT_MB * 1024 * 1024

/**
 * MSP almacena `LinkLag` en décimas de minuto sobre días laborales:
 *   1 día laboral = 8 h = 480 min = 4800 décimas.
 * Para convertir lag MSP a días dividir por este factor (asumiendo
 * calendario laboral estándar 8h/día). Calendarios custom se difieren
 * a P1.5 según D7.
 */
export const MSP_LAG_TO_DAYS_FACTOR = 4800

/**
 * Regex canónico de `mnemonic`. Documentado aquí para que parser y
 * writer lo compartan. Coincide con el formato `PROJ-1` o `MNEM-DEV-42`.
 */
export const MNEMONIC_REGEX = /^[A-Z0-9-]{1,40}$/

/**
 * Tope superior de tareas que el importer escanea por proyecto. Más
 * allá de esto la UI ya degrada notablemente (HU-4.6 Performance lo
 * abordará en P1). Solo se usa como salvaguarda en parser.
 */
export const MAX_TASKS_PER_IMPORT = 5000

/**
 * Tope superior de dependencias importadas en una sola pasada.
 */
export const MAX_DEPS_PER_IMPORT = 10_000

// ───────────────────────── Tipos auxiliares ─────────────────────────
//
// Los tipos viven en `types.ts` (archivo puro, sin runtime) para no
// arrastrar el grafo de import/export al colectar page-data en
// Turbopack (Next 16). Aquí los re-exportamos con los alias legacy
// (`ImportError`, `ImportWarning`, …) para mantener el contrato con
// los consumidores existentes.

export type {
  ExcelImportError as ImportError,
  ExcelImportErrorCode as ImportErrorCode,
  ExcelImportWarning as ImportWarning,
  ExcelImportWarningCode as ImportWarningCode,
  ImportSource,
} from './types'
