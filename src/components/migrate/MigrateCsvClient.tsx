'use client'

/**
 * Wave P16-B · Migration Assistant Client.
 *
 * Flujo:
 *   1. Upload CSV (input file).
 *   2. Parse CSV con papaparse client-side.
 *   3. Preview de los primeros 20 rows con auto-mapping de columnas.
 *   4. Mapper editable para renombrar columnas (dropdown por columna).
 *   5. Botón "Importar N tasks" → server action `importTasksFromCsv`.
 *   6. Render del resultado (imported / skipped / warnings).
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, FileUp, Loader2, X } from 'lucide-react'
import Papa from 'papaparse'
import {
  importTasksFromCsv,
  type ImportTasksFromCsvResult,
} from '@/lib/actions/migrate-csv'
import { MAX_CSV_ROWS } from '@/lib/migrate/csv-mappers'

interface Props {
  projectId: string
  projectName: string
}

const PREVIEW_ROWS = 20

/** Campos canónicos a los que mapeamos columnas del CSV. */
const CANONICAL_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'estimate',
  'assignee_email',
  'tags',
  '__skip__',
] as const
type CanonicalField = (typeof CANONICAL_FIELDS)[number]

const FIELD_LABELS: Record<CanonicalField, string> = {
  title: 'Título *',
  description: 'Descripción',
  status: 'Estado',
  priority: 'Prioridad',
  estimate: 'Estimación / Story Points',
  assignee_email: 'Email del responsable',
  tags: 'Etiquetas (comma-separated)',
  __skip__: '— No importar —',
}

/**
 * Heurística de auto-mapping: para una cabecera del CSV detecta a qué
 * campo canónico corresponde. Si no detecta nada, devuelve __skip__.
 */
function autoMap(header: string): CanonicalField {
  const k = header.trim().toLowerCase()
  if (!k) return '__skip__'
  if (
    k === 'title' ||
    k === 'name' ||
    k === 'summary' ||
    k === 'subject' ||
    k === 'task' ||
    k === 'task name'
  )
    return 'title'
  if (k === 'description' || k === 'desc' || k === 'details' || k === 'notes')
    return 'description'
  if (k === 'status' || k === 'state' || k === 'column') return 'status'
  if (k === 'priority' || k === 'severity' || k === 'urgency') return 'priority'
  if (
    k === 'estimate' ||
    k === 'story points' ||
    k === 'storypoints' ||
    k === 'sp' ||
    k === 'points'
  )
    return 'estimate'
  if (
    k === 'assignee_email' ||
    k === 'assignee' ||
    k === 'email' ||
    k === 'owner email' ||
    k === 'assigned to'
  )
    return 'assignee_email'
  if (k === 'tags' || k === 'labels' || k === 'categories') return 'tags'
  return '__skip__'
}

type RawRow = Record<string, unknown>

export function MigrateCsvClient({ projectId, projectName }: Props) {
  const [filename, setFilename] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<RawRow[]>([])
  const [columnMap, setColumnMap] = useState<Record<string, CanonicalField>>({})
  const [parseError, setParseError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<ImportTasksFromCsvResult | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setFilename(null)
    setHeaders([])
    setRows([])
    setColumnMap({})
    setParseError(null)
    setResult(null)
    setServerError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleFile = useCallback((file: File) => {
    setParseError(null)
    setResult(null)
    setServerError(null)
    setFilename(file.name)
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        if (res.errors && res.errors.length > 0) {
          // No bloqueamos por errores leves de parse — sólo los anotamos.
          const fatal = res.errors.find((e) => e.type !== 'FieldMismatch')
          if (fatal) {
            setParseError(`Error al parsear CSV: ${fatal.message}`)
            setRows([])
            setHeaders([])
            return
          }
        }
        const fields = (res.meta.fields ?? []).filter((h) => h && h.length > 0)
        if (fields.length === 0) {
          setParseError(
            'El CSV no tiene encabezados o está vacío. Asegúrate de incluir una primera fila con los nombres de columna.',
          )
          setRows([])
          setHeaders([])
          return
        }
        const data = (res.data || []).filter(
          (r): r is RawRow => !!r && typeof r === 'object',
        )
        setHeaders(fields)
        setRows(data)
        setColumnMap(
          Object.fromEntries(fields.map((h) => [h, autoMap(h)])) as Record<
            string,
            CanonicalField
          >,
        )
      },
      error: (err) => {
        setParseError(`Error al leer archivo: ${err.message}`)
      },
    })
  }, [])

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  // Validación: al menos una columna mapeada a `title`.
  const hasTitleMapped = useMemo(
    () => Object.values(columnMap).includes('title'),
    [columnMap],
  )

  const tooManyRows = rows.length > MAX_CSV_ROWS

  /** Construye el array `ImportCsvRow[]` aplicando el mapping actual. */
  const mappedRowsForImport = useMemo<
    Array<{
      title: string
      description: string | null
      status: string | null
      priority: string | null
      estimate: string | null
      assignee_email: string | null
      tags: string | null
    }>
  >(() => {
    if (!hasTitleMapped) return []
    return rows.map((r) => {
      let title = ''
      let description: string | null = null
      let status: string | null = null
      let priority: string | null = null
      let estimate: string | null = null
      let assignee_email: string | null = null
      let tags: string | null = null
      for (const h of headers) {
        const target = columnMap[h]
        if (!target || target === '__skip__') continue
        const raw = r[h]
        const v = raw === null || raw === undefined ? null : String(raw)
        switch (target) {
          case 'title':
            // Si la columna mapeada a title no aporta valor, queda ''
            // y el server descarta la fila con un warning.
            title = v ?? ''
            break
          case 'description':
            description = v
            break
          case 'status':
            status = v
            break
          case 'priority':
            priority = v
            break
          case 'estimate':
            estimate = v
            break
          case 'assignee_email':
            assignee_email = v
            break
          case 'tags':
            tags = v
            break
        }
      }
      return {
        title,
        description,
        status,
        priority,
        estimate,
        assignee_email,
        tags,
      }
    })
  }, [rows, headers, columnMap, hasTitleMapped])

  const previewRows = useMemo(
    () => mappedRowsForImport.slice(0, PREVIEW_ROWS),
    [mappedRowsForImport],
  )

  const onImport = useCallback(async () => {
    if (!hasTitleMapped) {
      setServerError(
        'Debes mapear al menos una columna del CSV al campo "Título".',
      )
      return
    }
    if (tooManyRows) {
      setServerError(
        `Máximo ${MAX_CSV_ROWS} filas por importación. Tu CSV tiene ${rows.length}.`,
      )
      return
    }
    setServerError(null)
    setResult(null)
    setIsImporting(true)
    try {
      const res = await importTasksFromCsv({
        projectId,
        rows: mappedRowsForImport,
      })
      setResult(res)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsImporting(false)
    }
  }, [projectId, mappedRowsForImport, hasTitleMapped, tooManyRows, rows.length])

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Step 1 · Upload */}
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-2 text-base font-semibold text-foreground">
          1. Sube tu archivo CSV
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Exporta tus tasks desde Jira, Trello, ClickUp o cualquier herramienta como
          CSV. Reconocemos columnas comunes automáticamente: <code>title</code>,{' '}
          <code>description</code>, <code>status</code>, <code>priority</code>,{' '}
          <code>estimate</code>, <code>assignee_email</code>, <code>tags</code>.
          Máximo {MAX_CSV_ROWS} filas por importación.
        </p>
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-subtle">
            <FileUp className="h-4 w-4" />
            Seleccionar CSV
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFileChange}
              className="hidden"
            />
          </label>
          {filename && (
            <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{filename}</span>
              <button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-subtle"
                title="Quitar archivo"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
        {parseError && (
          <p className="mt-3 inline-flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            {parseError}
          </p>
        )}
      </section>

      {/* Step 2 · Mapper */}
      {headers.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 text-base font-semibold text-foreground">
            2. Mapea las columnas
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Asocia cada columna de tu CSV a un campo de Sync. Si no quieres
            importar una columna, elige &quot;No importar&quot;.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {headers.map((h) => (
              <div
                key={h}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
              >
                <span className="truncate text-sm text-foreground" title={h}>
                  <span className="text-muted-foreground">CSV:</span>{' '}
                  <span className="font-mono">{h}</span>
                </span>
                <select
                  value={columnMap[h] ?? '__skip__'}
                  onChange={(e) =>
                    setColumnMap((prev) => ({
                      ...prev,
                      [h]: e.target.value as CanonicalField,
                    }))
                  }
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-emerald-500 focus:outline-none"
                >
                  {CANONICAL_FIELDS.map((f) => (
                    <option key={f} value={f}>
                      {FIELD_LABELS[f]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {!hasTitleMapped && (
            <p className="mt-3 inline-flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              Debes mapear al menos una columna a <strong>Título</strong> para
              poder importar.
            </p>
          )}
        </section>
      )}

      {/* Step 3 · Preview */}
      {previewRows.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 text-base font-semibold text-foreground">
            3. Vista previa ({Math.min(previewRows.length, PREVIEW_ROWS)} de{' '}
            {rows.length} filas)
          </h2>
          <div className="max-h-96 overflow-auto rounded-md border border-border/60">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="sticky top-0 bg-subtle text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">#</th>
                  <th className="px-3 py-2 text-left font-medium">Título</th>
                  <th className="px-3 py-2 text-left font-medium">Estado</th>
                  <th className="px-3 py-2 text-left font-medium">Prioridad</th>
                  <th className="px-3 py-2 text-left font-medium">SP</th>
                  <th className="px-3 py-2 text-left font-medium">Asignado</th>
                  <th className="px-3 py-2 text-left font-medium">Tags</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r, i) => (
                  <tr
                    key={i}
                    className="border-t border-border/40 text-foreground"
                  >
                    <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                    <td
                      className="max-w-xs truncate px-3 py-2"
                      title={r.title ?? ''}
                    >
                      {r.title || (
                        <span className="italic text-red-400">(vacío)</span>
                      )}
                    </td>
                    <td className="px-3 py-2">{r.status || '—'}</td>
                    <td className="px-3 py-2">{r.priority || '—'}</td>
                    <td className="px-3 py-2">{r.estimate || '—'}</td>
                    <td
                      className="max-w-[160px] truncate px-3 py-2"
                      title={r.assignee_email ?? ''}
                    >
                      {r.assignee_email || '—'}
                    </td>
                    <td
                      className="max-w-[160px] truncate px-3 py-2"
                      title={r.tags ?? ''}
                    >
                      {r.tags || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Step 4 · Import button */}
      {rows.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 text-base font-semibold text-foreground">
            4. Importar al proyecto &quot;{projectName}&quot;
          </h2>
          {tooManyRows && (
            <p className="mb-3 inline-flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              Tu CSV tiene {rows.length} filas; el máximo es {MAX_CSV_ROWS}.
              Divide el archivo en varias importaciones.
            </p>
          )}
          <button
            type="button"
            onClick={onImport}
            disabled={
              isImporting || !hasTitleMapped || tooManyRows || rows.length === 0
            }
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <FileUp className="h-4 w-4" />
                Importar {rows.length} task{rows.length === 1 ? '' : 's'}
              </>
            )}
          </button>
          {serverError && (
            <p className="mt-3 inline-flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              {serverError}
            </p>
          )}
        </section>
      )}

      {/* Step 5 · Result */}
      {result && (
        <section className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-6">
          <h2 className="mb-3 inline-flex items-center gap-2 text-base font-semibold text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            Importación completada
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-background p-3 text-center">
              <div className="text-xs text-muted-foreground">Importadas</div>
              <div className="mt-1 text-2xl font-bold text-emerald-400">
                {result.imported}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background p-3 text-center">
              <div className="text-xs text-muted-foreground">Saltadas</div>
              <div className="mt-1 text-2xl font-bold text-foreground">
                {result.skipped}
              </div>
            </div>
            <div className="rounded-md border border-border bg-background p-3 text-center">
              <div className="text-xs text-muted-foreground">Avisos</div>
              <div className="mt-1 text-2xl font-bold text-yellow-400">
                {result.warnings.length}
              </div>
            </div>
          </div>
          {result.warnings.length > 0 && (
            <details className="mt-4 rounded-md border border-border/60 bg-background p-3 text-xs">
              <summary className="cursor-pointer font-medium text-foreground">
                Ver {result.warnings.length} aviso
                {result.warnings.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-4 flex items-center gap-3">
            <a
              href={`/projects/${projectId}`}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-subtle"
            >
              Ir al proyecto
            </a>
            <button
              type="button"
              onClick={reset}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Importar otro archivo
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
