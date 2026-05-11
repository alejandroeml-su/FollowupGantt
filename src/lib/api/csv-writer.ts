/**
 * Wave R3.0 Fase 4.2 · BI Export Connector.
 *
 * Writer CSV mínimo para los endpoints `/api/v2/exports/**`. No usamos
 * `papaparse` ni `csv-stringify` porque la lógica de escape es trivial y
 * preferimos cero dependencias extra en el bundle del runtime.
 *
 * Reglas RFC 4180:
 *  - Separador: coma (`,`).
 *  - Fin de línea: CRLF (`\r\n`) — compatible con Excel/PowerBI/Tableau.
 *  - Si un valor contiene `,`, `"` o salto de línea ⇒ envolver en comillas.
 *  - Comillas dobles internas se duplican (`"` → `""`).
 *  - `null`/`undefined` se serializan como cadena vacía.
 *  - `Date` se serializa ISO-8601 UTC (toISOString).
 *  - `number`/`boolean` se serializan via `String(...)`.
 *  - Otros objetos se serializan via `JSON.stringify` para evitar `[object Object]`.
 *
 * El BOM UTF-8 (`﻿`) se prepende para que Excel detecte la
 * codificación correctamente al abrir el archivo.
 */

export type CsvCellValue =
  | string
  | number
  | boolean
  | bigint
  | Date
  | null
  | undefined
  | { toString(): string }

export interface CsvColumn<T> {
  /** Cabecera tal como aparecerá en la primera fila. */
  header: string
  /** Función que extrae el valor de una fila. */
  value: (row: T) => CsvCellValue
}

const NEEDS_QUOTE = /[",\r\n]/

function escapeCell(raw: CsvCellValue): string {
  if (raw === null || raw === undefined) return ''
  let text: string
  if (raw instanceof Date) {
    text = Number.isNaN(raw.getTime()) ? '' : raw.toISOString()
  } else if (typeof raw === 'string') {
    text = raw
  } else if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'bigint') {
    text = String(raw)
  } else if (typeof (raw as { toString?: () => string }).toString === 'function') {
    // Decimal de Prisma, BigInt, etc.
    text = (raw as { toString: () => string }).toString()
  } else {
    text = JSON.stringify(raw)
  }
  if (NEEDS_QUOTE.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function csvHeaderRow(columns: ReadonlyArray<CsvColumn<unknown>>): string {
  return columns.map((c) => escapeCell(c.header)).join(',') + '\r\n'
}

export function csvBodyRow<T>(row: T, columns: ReadonlyArray<CsvColumn<T>>): string {
  return columns.map((c) => escapeCell(c.value(row))).join(',') + '\r\n'
}

/**
 * Construye una `Response` streaming con `Content-Type: text/csv` y el
 * filename derivado de `entity-YYYY-MM-DD.csv`.
 *
 * El generador `rows` permite paginar contra Prisma sin materializar
 * todo el dataset en memoria. Cada batch que produzca el generador se
 * empuja al stream.
 */
export function csvResponse<T>(opts: {
  entity: string
  columns: ReadonlyArray<CsvColumn<T>>
  rows: AsyncIterable<T> | Iterable<T>
  /** Opcional: pasar cursor de la última fila para meta-header. */
  nextCursorHeader?: string | null
}): Response {
  const { entity, columns, rows, nextCursorHeader } = opts
  const encoder = new TextEncoder()
  const dateStr = new Date().toISOString().slice(0, 10)
  const filename = `${entity}-${dateStr}.csv`

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // BOM UTF-8 — ayuda a Excel/Power Query a detectar la encoding.
        controller.enqueue(encoder.encode('﻿'))
        controller.enqueue(encoder.encode(csvHeaderRow(columns as ReadonlyArray<CsvColumn<unknown>>)))
        for await (const row of rows as AsyncIterable<T>) {
          controller.enqueue(encoder.encode(csvBodyRow(row, columns)))
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  const headers: Record<string, string> = {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-API-Version': 'v2',
  }
  if (nextCursorHeader) {
    headers['X-Next-Cursor'] = nextCursorHeader
  }

  return new Response(stream, { status: 200, headers })
}

/**
 * Cap maximo por request — si el caller no pasa `?limit=`, devolvemos
 * 5000. Caps superiores deben paginar via `?cursor=<lastId>`.
 */
export const DEFAULT_CSV_LIMIT = 5000
export const MAX_CSV_LIMIT = 5000

/**
 * Helper común para parsear `?cursor=<id>&limit=<n>` con caps del
 * BI connector. Difiere de `parsePagination` (v2-helpers) en que el
 * default es 5000 en vez de 50 (los BI tools quieren bulk).
 */
export function parseCsvPagination(url: URL): { cursor: string | null; limit: number } {
  const cursor = url.searchParams.get('cursor')
  const rawLimit = url.searchParams.get('limit')
  let limit = DEFAULT_CSV_LIMIT
  if (rawLimit) {
    const n = Number(rawLimit)
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 1) {
      limit = Math.min(MAX_CSV_LIMIT, n)
    }
  }
  return { cursor: cursor || null, limit }
}
