/**
 * Wave R3.0 Fase 4.2 · BI Export Connector — OData v4 minimal helpers.
 *
 * Implementación intencionalmente reducida: solo lo necesario para que
 * Tableau "OData Connector" y PowerBI "Get Data > OData feed" descubran
 * el endpoint y paginen. Incluye:
 *   - Auth dual: header `Authorization: Bearer <ApiKey>` o query
 *     `?$apikey=<plain>` (Tableau no permite headers en algunos planes).
 *   - Parser mínimo de `$filter` ⇒ donde de Prisma. Soporta:
 *       eq, ne, gt, ge, lt, le contra un campo literal y un valor
 *       string/number/datetime/boolean. Operador `and` permitido para
 *       encadenar 2+ predicados. Sin `or`, sin paréntesis anidados,
 *       sin funciones (`contains`, `startswith`).
 *   - `$top` / `$skip` numéricos.
 *
 * Limitaciones documentadas (no $expand, no $select, no $orderby, no
 * $count nested, no $search). Si Tableau/PowerBI piden alguna de estas
 * funcionalidades, agregar como follow-up.
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

const ODATA_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'OData-Version': '4.0',
  'X-API-Version': 'v2-odata',
}

export function odataOk<T>(
  request: NextRequest,
  entitySet: string,
  value: T[],
  opts?: { count?: number; nextLink?: string },
): Response {
  const url = new URL(request.url)
  const base = `${url.origin}/api/v2/odata`
  const body: Record<string, unknown> = {
    '@odata.context': `${base}/$metadata#${entitySet}`,
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
    } else {
      out[key] = v
    }
  }
  return out
}
