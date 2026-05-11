/**
 * Wave R3.0 Fase 4.2 · BI Export Connector — OData v4 minimal helpers.
 *
 * Implementación originalmente reducida (PR #192) y extendida con
 * features Power BI-friendly (Wave P21-C):
 *   - Auth dual: header `Authorization: Bearer <ApiKey>` o query
 *     `?$apikey=<plain>` (Tableau no permite headers en algunos planes).
 *   - Parser mínimo de `$filter` ⇒ donde de Prisma. Soporta:
 *       eq, ne, gt, ge, lt, le contra un campo literal y un valor
 *       string/number/datetime/boolean. Operador `and` permitido para
 *       encadenar 2+ predicados. Sin `or`, sin paréntesis anidados,
 *       sin funciones (`contains`, `startswith`).
 *   - `$top` / `$skip` numéricos.
 *   - `$select` (Wave P21-C) → proyección server-side de columnas.
 *   - `$orderby` (Wave P21-C) → orden ASC/DESC por uno o más campos.
 *   - `$count=true` (Wave P21-C) → incluye `@odata.count` con el total
 *     antes de top/skip.
 *   - `$expand` (Wave P21-C) → expansión mínima de 1 nivel sobre
 *     navegaciones whitelisted (Project→Tasks, Sprint→Project).
 *
 * Backward-compat: clientes del PR #192 que no envíen las nuevas
 * options siguen recibiendo el shape original con todos los campos
 * del entity (no breaking).
 *
 * Limitaciones documentadas (no $expand multinivel, no funciones
 * `contains/startswith/$search`, no `or`/paréntesis en $filter). Si
 * Power BI requiere alguna de estas, agregar como follow-up.
 *
 * Errores: devolvemos JSON shape `{ "error": { "code", "message" } }`
 * compatible OData v4 §19.2.
 */

import 'server-only'
import type { NextRequest } from 'next/server'
import { authenticateV2Request } from '@/lib/api/v2-auth'
import type { V2Scope } from '@/lib/api/v2-scopes'

// ─────────────────────────────────────────────────────────────────
// Auth dual (header Bearer o ?$apikey=)
// ─────────────────────────────────────────────────────────────────

/**
 * Algunos clientes (Tableau / Power Query antiguo) no permiten enviar
 * `Authorization: Bearer`. Para esos casos aceptamos `?$apikey=<plain>`
 * y lo promovemos a header antes de delegar a `authenticateV2Request`.
 */
export async function odataAuth(
  request: NextRequest,
  scope: V2Scope,
): Promise<
  | { ok: true; workspaceId: string }
  | { ok: false; response: Response }
> {
  let effectiveRequest: NextRequest | Request = request
  const url = new URL(request.url)
  const queryKey = url.searchParams.get('$apikey') ?? url.searchParams.get('apikey')

  if (queryKey && !request.headers.get('authorization')) {
    const cloned = new Headers(request.headers)
    cloned.set('Authorization', `Bearer ${queryKey}`)
    effectiveRequest = new Request(request.url, {
      method: request.method,
      headers: cloned,
    })
  }

  const auth = await authenticateV2Request(effectiveRequest, scope)
  if (!auth.ok) {
    const status =
      auth.code === 'INVALID_KEY' ? 401 : auth.code === 'INSUFFICIENT_SCOPE' ? 403 : 429
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'OData-Version': '4.0',
    }
    if (auth.code === 'RATE_LIMITED' && typeof auth.retryAfterMs === 'number') {
      headers['Retry-After'] = String(Math.ceil(auth.retryAfterMs / 1000))
    }
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: { code: auth.code, message: auth.message } }),
        { status, headers },
      ),
    }
  }
  return { ok: true, workspaceId: auth.apiKey.workspaceId }
}

// ─────────────────────────────────────────────────────────────────
// Response helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Headers OData v4 estándar. Power BI Desktop espera:
 *   - `OData-Version: 4.0` (RFC sin esto rechaza el feed).
 *   - `Content-Type: application/json; odata.metadata=minimal` — el
 *     `metadata=minimal` es el default del protocolo y reduce ruido
 *     versus `full`. Power BI Desktop acepta `minimal`, `none` y
 *     `full`; usamos `minimal` que es lo recomendado.
 *   - `charset=utf-8` (preserve compat).
 */
const ODATA_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; odata.metadata=minimal; charset=utf-8',
  'Cache-Control': 'no-store',
  'OData-Version': '4.0',
  'OData-MaxVersion': '4.0',
  'X-API-Version': 'v2-odata',
}

/**
 * Headers para responses XML ($metadata, service document XML variant).
 * Power BI Desktop tolera ambos JSON y XML; usamos XML para `$metadata`.
 */
export const ODATA_XML_HEADERS: Record<string, string> = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'no-store',
  'OData-Version': '4.0',
  'OData-MaxVersion': '4.0',
  'X-API-Version': 'v2-odata',
}

/**
 * Construye el `@odata.context` URL apuntando al `$metadata` correcto.
 * Cuando se aplica `$select`, OData v4 §10.10 sugiere serializar la
 * lista de propiedades entre paréntesis en el context.
 */
function buildContext(
  request: NextRequest,
  entitySet: string,
  selectFields?: readonly string[] | null,
): string {
  const url = new URL(request.url)
  const base = `${url.origin}/api/v2/odata`
  const projection =
    selectFields && selectFields.length > 0 ? `(${selectFields.join(',')})` : ''
  return `${base}/$metadata#${entitySet}${projection}`
}

export function odataOk<T>(
  request: NextRequest,
  entitySet: string,
  value: T[],
  opts?: {
    count?: number
    nextLink?: string
    selectFields?: readonly string[] | null
  },
): Response {
  const body: Record<string, unknown> = {
    '@odata.context': buildContext(request, entitySet, opts?.selectFields ?? null),
    value,
  }
  if (typeof opts?.count === 'number') {
    body['@odata.count'] = opts.count
  }
  if (opts?.nextLink) {
    body['@odata.nextLink'] = opts.nextLink
  }
  return new Response(JSON.stringify(body), { status: 200, headers: ODATA_HEADERS })
}

export function odataError(
  code: string,
  message: string,
  status: number = 400,
): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: ODATA_HEADERS },
  )
}

// ─────────────────────────────────────────────────────────────────
// $top / $skip
// ─────────────────────────────────────────────────────────────────

export interface OdataPagination {
  top: number
  skip: number
}

const DEFAULT_TOP = 100
const MAX_TOP = 1000

export function parseTopSkip(url: URL): OdataPagination {
  let top = DEFAULT_TOP
  let skip = 0
  const rawTop = url.searchParams.get('$top')
  if (rawTop !== null) {
    const n = Number(rawTop)
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
      top = Math.min(MAX_TOP, n)
    }
  }
  const rawSkip = url.searchParams.get('$skip')
  if (rawSkip !== null) {
    const n = Number(rawSkip)
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 0) {
      skip = n
    }
  }
  return { top, skip }
}

// ─────────────────────────────────────────────────────────────────
// $filter parser
// ─────────────────────────────────────────────────────────────────

const COMPARISON_OPS = ['eq', 'ne', 'gt', 'ge', 'lt', 'le'] as const
type CompareOp = (typeof COMPARISON_OPS)[number]

const PRISMA_OP: Record<CompareOp, string> = {
  eq: 'equals',
  ne: 'not',
  gt: 'gt',
  ge: 'gte',
  lt: 'lt',
  le: 'lte',
}

export interface FieldSpec {
  /** Tipo en el modelo Prisma. Determina cómo parsear el literal. */
  type: 'string' | 'int' | 'float' | 'datetime' | 'boolean'
  /** Nombre del campo Prisma (puede diferir del nombre OData). */
  prismaField?: string
}

/** Mapa nombre-OData → spec. Solo los campos aquí declarados son
 * filtrables; los demás se rechazan con `INVALID_INPUT`. */
export type FilterFieldMap = Record<string, FieldSpec>

interface ParsedClause {
  field: string
  op: CompareOp
  literal: string
}

/**
 * Tokeniza un literal OData manteniendo strings entre comillas simples
 * juntos. La gramática reducida que aceptamos es:
 *   <field> <op> <literal>  ( and <field> <op> <literal> )*
 *
 * Reglas de literal:
 *   - String:  `'foo'`  (comillas simples escapadas como `''`).
 *   - Number:  decimal (`42`, `3.14`).
 *   - DateTime ISO: sin comillas (`2026-05-09T00:00:00Z`) o con prefijo
 *                  `datetime'...'` (legacy V2 dialect).
 *   - Boolean: `true` / `false`.
 */
function tokenize(filter: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < filter.length) {
    const ch = filter[i]
    if (ch === ' ' || ch === '\t') {
      i += 1
      continue
    }
    if (ch === "'") {
      // String literal — consumir hasta el cierre, respetando ''.
      let end = i + 1
      while (end < filter.length) {
        if (filter[end] === "'") {
          if (filter[end + 1] === "'") {
            end += 2
            continue
          }
          end += 1
          break
        }
        end += 1
      }
      tokens.push(filter.slice(i, end))
      i = end
      continue
    }
    // Token no-string: corre hasta espacio.
    let end = i
    while (end < filter.length && filter[end] !== ' ' && filter[end] !== '\t') {
      end += 1
    }
    tokens.push(filter.slice(i, end))
    i = end
  }
  return tokens
}

export function parseFilter(
  filter: string,
  fields: FilterFieldMap,
): { ok: true; clauses: ParsedClause[] } | { ok: false; message: string } {
  const tokens = tokenize(filter)
  if (tokens.length === 0) return { ok: true, clauses: [] }

  const clauses: ParsedClause[] = []
  let i = 0
  while (i < tokens.length) {
    if (clauses.length > 0) {
      if (tokens[i].toLowerCase() !== 'and') {
        return {
          ok: false,
          message: `Solo se soporta el operador lógico 'and' en $filter (encontrado: ${tokens[i]})`,
        }
      }
      i += 1
    }
    const field = tokens[i]
    const op = tokens[i + 1]
    const literal = tokens[i + 2]
    if (!field || !op || literal === undefined) {
      return { ok: false, message: 'Cláusula incompleta en $filter (esperado <field> <op> <literal>)' }
    }
    if (!Object.prototype.hasOwnProperty.call(fields, field)) {
      return {
        ok: false,
        message: `Campo no filtrable: ${field}. Campos válidos: ${Object.keys(fields).join(', ')}`,
      }
    }
    const opLower = op.toLowerCase() as CompareOp
    if (!COMPARISON_OPS.includes(opLower)) {
      return {
        ok: false,
        message: `Operador no soportado: ${op}. Use uno de ${COMPARISON_OPS.join(', ')}`,
      }
    }
    clauses.push({ field, op: opLower, literal })
    i += 3
  }
  return { ok: true, clauses }
}

function parseLiteral(spec: FieldSpec, raw: string):
  | { ok: true; value: string | number | boolean | Date }
  | { ok: false; message: string } {
  if (spec.type === 'string') {
    if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
      const inner = raw.slice(1, -1).replace(/''/g, "'")
      return { ok: true, value: inner }
    }
    return { ok: false, message: `Literal string debe ir entre comillas simples (encontrado: ${raw})` }
  }
  if (spec.type === 'int') {
    const n = Number(raw)
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { ok: false, message: `Literal int inválido: ${raw}` }
    }
    return { ok: true, value: n }
  }
  if (spec.type === 'float') {
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      return { ok: false, message: `Literal numérico inválido: ${raw}` }
    }
    return { ok: true, value: n }
  }
  if (spec.type === 'boolean') {
    if (raw === 'true') return { ok: true, value: true }
    if (raw === 'false') return { ok: true, value: false }
    return { ok: false, message: `Literal boolean inválido: ${raw} (use true/false)` }
  }
  if (spec.type === 'datetime') {
    // Soportar `datetime'...'` legacy y forma ISO sin envoltura.
    let iso = raw
    const legacy = /^datetime'(.+)'$/i.exec(raw)
    if (legacy) iso = legacy[1]
    if (iso.startsWith("'") && iso.endsWith("'")) iso = iso.slice(1, -1)
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) {
      return { ok: false, message: `Literal datetime inválido: ${raw}` }
    }
    return { ok: true, value: d }
  }
  return { ok: false, message: `Tipo no soportado en filter` }
}

/**
 * Convierte el `$filter` parseado en un objeto `where` de Prisma.
 * Las cláusulas se combinan con AND.
 */
export function filterToPrismaWhere(
  filter: string | null,
  fields: FilterFieldMap,
): { ok: true; where: Record<string, unknown> } | { ok: false; message: string } {
  if (!filter || !filter.trim()) return { ok: true, where: {} }
  const parsed = parseFilter(filter, fields)
  if (!parsed.ok) return { ok: false, message: parsed.message }

  const where: Record<string, unknown> = {}
  for (const clause of parsed.clauses) {
    const spec = fields[clause.field]
    const lit = parseLiteral(spec, clause.literal)
    if (!lit.ok) {
      return { ok: false, message: lit.message }
    }
    const prismaField = spec.prismaField ?? clause.field
    const prismaOp = PRISMA_OP[clause.op]

    if (clause.op === 'eq') {
      where[prismaField] = lit.value
    } else if (clause.op === 'ne') {
      where[prismaField] = { not: lit.value }
    } else {
      // gt/ge/lt/le — mergear si ya existe (rango).
      const existing = where[prismaField]
      if (existing && typeof existing === 'object' && !Array.isArray(existing) && !(existing instanceof Date)) {
        (existing as Record<string, unknown>)[prismaOp] = lit.value
      } else {
        where[prismaField] = { [prismaOp]: lit.value }
      }
    }
  }
  return { ok: true, where }
}

// ─────────────────────────────────────────────────────────────────
// Helpers de serialización JSON-friendly
// ─────────────────────────────────────────────────────────────────

/** Convierte Decimals/Dates a tipos serializables por JSON. */
export function odataSerialize<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(row)) {
    const v = row[key]
    if (v === null || v === undefined) {
      out[key] = null
    } else if (v instanceof Date) {
      out[key] = v.toISOString()
    } else if (typeof v === 'object' && typeof (v as { toString?: () => string }).toString === 'function' && v.constructor?.name === 'Decimal') {
      out[key] = Number((v as { toString: () => string }).toString())
    } else if (Array.isArray(v)) {
      // Expansiones (`$expand`) llegan como arrays de subrecords.
      out[key] = v.map((row) =>
        row && typeof row === 'object' && !Array.isArray(row)
          ? odataSerialize(row as Record<string, unknown>)
          : row,
      )
    } else if (typeof v === 'object') {
      out[key] = odataSerialize(v as Record<string, unknown>)
    } else {
      out[key] = v
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────────
// $select — proyección de columnas server-side (Wave P21-C)
// ─────────────────────────────────────────────────────────────────

/**
 * Parsea `$select=col1,col2,col3` y devuelve la lista whitelisted.
 *
 * - Si `$select` no viene → null (significa "todas las columnas" — el
 *   route handler usa el `select` Prisma original).
 * - Si `$select` viene vacío o solo whitespace → error.
 * - Campos no en `allowed` → error `[INVALID_INPUT]`.
 * - Campos duplicados → se dedupean silenciosamente preservando orden.
 * - Permite `$select=*` como atajo para "todas las columnas" (devuelve null).
 */
export function parseSelect(
  raw: string | null,
  allowed: readonly string[],
): { ok: true; fields: string[] | null } | { ok: false; message: string } {
  if (raw === null) return { ok: true, fields: null }
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '*') return { ok: true, fields: null }
  const requested = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
  if (requested.length === 0) {
    return { ok: false, message: '$select vacío. Use $select=col1,col2 o omita el parámetro.' }
  }
  const allowedSet = new Set(allowed)
  const seen = new Set<string>()
  const fields: string[] = []
  for (const f of requested) {
    if (!allowedSet.has(f)) {
      return {
        ok: false,
        message: `Campo no seleccionable: ${f}. Disponibles: ${allowed.join(', ')}`,
      }
    }
    if (!seen.has(f)) {
      seen.add(f)
      fields.push(f)
    }
  }
  return { ok: true, fields }
}

/**
 * Construye el objeto `select` de Prisma desde la lista parseada por
 * `parseSelect`. Si la lista incluye un campo `key`, lo fuerza para
 * mantener el contrato OData (cada entity siempre debe tener `id`).
 */
export function selectToPrisma(
  fields: readonly string[] | null,
  keyField: string = 'id',
): Record<string, true> | null {
  if (!fields || fields.length === 0) return null
  const out: Record<string, true> = {}
  out[keyField] = true
  for (const f of fields) out[f] = true
  return out
}

// ─────────────────────────────────────────────────────────────────
// $orderby — orden ASC/DESC server-side (Wave P21-C)
// ─────────────────────────────────────────────────────────────────

export interface OrderbyClause {
  field: string
  dir: 'asc' | 'desc'
}

/**
 * Parsea `$orderby=col1 desc,col2,col3 asc`. Default direction = `asc`.
 *
 * - Si `$orderby` no viene → null (caller usa default).
 * - Multi-campo soportado separado por coma.
 * - Direction `asc` (default) o `desc` (case-insensitive).
 * - Campos no en `allowed` → error.
 */
export function parseOrderby(
  raw: string | null,
  allowed: readonly string[],
): { ok: true; clauses: OrderbyClause[] | null } | { ok: false; message: string } {
  if (raw === null) return { ok: true, clauses: null }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, clauses: null }
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return { ok: true, clauses: null }
  const clauses: OrderbyClause[] = []
  const allowedSet = new Set(allowed)
  for (const part of parts) {
    const tokens = part.split(/\s+/).filter(Boolean)
    if (tokens.length === 0 || tokens.length > 2) {
      return {
        ok: false,
        message: `Cláusula $orderby inválida: "${part}" (esperado <field> [asc|desc])`,
      }
    }
    const field = tokens[0]
    const dirRaw = (tokens[1] ?? 'asc').toLowerCase()
    if (dirRaw !== 'asc' && dirRaw !== 'desc') {
      return {
        ok: false,
        message: `Direction inválida en $orderby: ${tokens[1]} (use asc o desc)`,
      }
    }
    if (!allowedSet.has(field)) {
      return {
        ok: false,
        message: `Campo no ordenable: ${field}. Disponibles: ${allowed.join(', ')}`,
      }
    }
    clauses.push({ field, dir: dirRaw })
  }
  return { ok: true, clauses }
}

/** Convierte clauses de $orderby al `orderBy` array de Prisma. */
export function orderbyToPrisma(
  clauses: readonly OrderbyClause[] | null,
  defaultOrder: Record<string, 'asc' | 'desc'> = { id: 'asc' },
): Array<Record<string, 'asc' | 'desc'>> | Record<string, 'asc' | 'desc'> {
  if (!clauses || clauses.length === 0) return defaultOrder
  return clauses.map((c) => ({ [c.field]: c.dir }))
}

// ─────────────────────────────────────────────────────────────────
// $count — total inline (Wave P21-C)
// ─────────────────────────────────────────────────────────────────

/**
 * Parsea `$count=true` (OData v4 §11.2.5.5). Power BI lo envía cuando
 * activa "Include count" en el query design.
 *
 * Valores permitidos: `true`, `false` (case-insensitive). Cualquier
 * otro string lanza error explícito en lugar de fallar silenciosamente.
 */
export function parseCount(
  raw: string | null,
): { ok: true; include: boolean } | { ok: false; message: string } {
  if (raw === null) return { ok: true, include: false }
  const v = raw.trim().toLowerCase()
  if (v === 'true') return { ok: true, include: true }
  if (v === 'false') return { ok: true, include: false }
  return { ok: false, message: `$count debe ser true o false (recibido: ${raw})` }
}

// ─────────────────────────────────────────────────────────────────
// $expand — navigaciones whitelisted (Wave P21-C)
// ─────────────────────────────────────────────────────────────────

/**
 * Whitelist por entity → mapa "navProp OData" → "campo Prisma include".
 * Mantenemos solo 1 nivel y un set acotado: Power BI tiene mejor
 * rendimiento con queries separadas que con $expand multinivel.
 */
export type ExpandWhitelist = Record<string, { prismaInclude: string }>

/**
 * Parsea `$expand=Tasks,Project`. Cada navProp se valida contra el
 * whitelist del entity. Si la lista está vacía → null (no include).
 */
export function parseExpand(
  raw: string | null,
  whitelist: ExpandWhitelist,
): { ok: true; navs: string[] | null } | { ok: false; message: string } {
  if (raw === null) return { ok: true, navs: null }
  const trimmed = raw.trim()
  if (trimmed === '') return { ok: true, navs: null }
  const requested = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
  if (requested.length === 0) return { ok: true, navs: null }
  const allowed = Object.keys(whitelist)
  const navs: string[] = []
  for (const r of requested) {
    // Reject sub-options ($expand=Tasks($top=5)) — sin soporte multinivel.
    if (r.includes('(')) {
      return {
        ok: false,
        message: `$expand con sub-options no soportado: ${r}. Use $expand=NavProp simple.`,
      }
    }
    if (!Object.prototype.hasOwnProperty.call(whitelist, r)) {
      return {
        ok: false,
        message: `Navegación no expandible: ${r}. Disponibles: ${allowed.join(', ') || '(ninguna)'}`,
      }
    }
    navs.push(r)
  }
  return { ok: true, navs }
}

/** Convierte $expand parseado al objeto `include` de Prisma. */
export function expandToPrismaInclude(
  navs: readonly string[] | null,
  whitelist: ExpandWhitelist,
): Record<string, true> | null {
  if (!navs || navs.length === 0) return null
  const include: Record<string, true> = {}
  for (const nav of navs) {
    const spec = whitelist[nav]
    if (spec) include[spec.prismaInclude] = true
  }
  return include
}
