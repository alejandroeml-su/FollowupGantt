'use client'

/**
 * Wave R5-Extended · CMDB avanzado · `/cmdb/import` · Client form.
 *
 * Form simple para pegar CSV o subir archivo `.csv`. Llama al server
 * action `bulkImportCIs(csvText)` que valida fila-por-fila y crea todo
 * dentro de UNA transacción (si una fila falla, no se crea nada).
 *
 * UX:
 *   - Botón "Cargar archivo .csv" → reemplaza el contenido del textarea.
 *   - Botón "Validar e importar" → llama al action.
 *   - Reporte tabular: ok / error con mensaje específico por fila.
 *   - Resumen total: created / failed.
 *
 * Columnas esperadas (case-sensitive, primera fila):
 *   name,type,status,criticality,description,ownerEmail
 */

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { clsx } from 'clsx'
import {
  bulkImportCIs,
  type BulkImportResult,
  type CsvImportRowResult,
} from '@/lib/actions/cmdb'

const EXAMPLE_CSV = `name,type,status,criticality,description,ownerEmail
Servidor de Reportes,SERVER,ACTIVE,HIGH,VM Win Server 2022 para BI,emartinez@complejoavante.com
Base Bookings,DATABASE,ACTIVE,CRITICAL,Postgres operacional reservas,emartinez@complejoavante.com
Switch Core,NETWORK_DEVICE,ACTIVE,CRITICAL,Cisco Catalyst 9300 piso 5,
`

export function CmdbImportClient() {
  const [csv, setCsv] = useState('')
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement | null>(null)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 1024 * 1024) {
      setError('Archivo > 1MB. Divide el import en lotes más pequeños.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setCsv(text)
      setError(null)
      setResult(null)
    }
    reader.readAsText(f, 'utf-8')
  }

  function submit() {
    setError(null)
    setResult(null)
    if (!csv.trim()) {
      setError('Pega un CSV o sube un archivo antes de importar.')
      return
    }
    startTransition(() => {
      ;(async () => {
        try {
          const r = await bulkImportCIs(csv)
          setResult(r)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Error inesperado')
        }
      })()
    })
  }

  function loadExample() {
    setCsv(EXAMPLE_CSV)
    setResult(null)
    setError(null)
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div className="flex items-start gap-3">
          <Link
            href="/cmdb"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> CMDB
          </Link>
          <div>
            <h1 className="inline-flex items-center gap-2 text-xl font-bold text-foreground">
              <Upload className="h-5 w-5 text-emerald-400" /> Importar CIs (Bulk)
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pega un CSV o sube un archivo. Una sola transacción —{' '}
              <strong>si alguna fila falla, no se crea ningún CI</strong>.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-[1100px] space-y-5">
          {/* Instrucciones */}
          <section className="rounded-md border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-foreground">
              Formato esperado
            </h2>
            <p>
              Primera fila como header. Columnas:{' '}
              <code className="rounded bg-subtle/60 px-1 py-0.5 font-mono">
                name,type,status,criticality,description,ownerEmail
              </code>
              . Sólo{' '}
              <code className="rounded bg-subtle/60 px-1 py-0.5 font-mono">
                name
              </code>{' '}
              es obligatorio.
            </p>
            <ul className="ml-4 mt-2 list-disc space-y-0.5">
              <li>
                <code className="rounded bg-subtle/60 px-1 font-mono">type</code>
                : SERVICE, APPLICATION, SERVER, DATABASE, NETWORK_DEVICE,
                ENDPOINT, DOCUMENT, BUSINESS_PROCESS, CONTRACT, OTHER (default).
              </li>
              <li>
                <code className="rounded bg-subtle/60 px-1 font-mono">status</code>
                : PLANNED, ACTIVE (default), MAINTENANCE, RETIRED, INCIDENT.
              </li>
              <li>
                <code className="rounded bg-subtle/60 px-1 font-mono">
                  criticality
                </code>
                : LOW, MEDIUM (default), HIGH, CRITICAL.
              </li>
              <li>
                <code className="rounded bg-subtle/60 px-1 font-mono">
                  ownerEmail
                </code>
                : email del usuario en Sync; debe existir y estar activo.
              </li>
            </ul>
            <button
              type="button"
              onClick={loadExample}
              disabled={pending}
              className="mt-3 inline-flex items-center rounded border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground hover:bg-subtle disabled:opacity-50"
            >
              Cargar ejemplo
            </button>
          </section>

          {/* CSV input */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                CSV
              </h2>
              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-subtle disabled:opacity-50"
                >
                  <Upload className="h-3 w-3" /> Cargar archivo .csv
                </button>
              </div>
            </div>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={12}
              spellCheck={false}
              placeholder="Pega el CSV aquí…"
              disabled={pending}
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={pending || !csv.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/25 disabled:opacity-50"
              >
                {pending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                Validar e importar
              </button>
            </div>
          </section>

          {/* Errores generales */}
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
            >
              {error}
            </div>
          ) : null}

          {/* Resultado */}
          {result ? (
            <section className="space-y-2">
              <div
                className={clsx(
                  'rounded-md border px-3 py-2 text-xs font-medium',
                  result.failed === 0
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-200',
                )}
              >
                {result.failed === 0 ? (
                  <span>
                    <CheckCircle2 className="mr-1 inline h-3 w-3" /> Import
                    exitoso: {result.created} CI(s) creado(s).
                  </span>
                ) : (
                  <span>
                    <XCircle className="mr-1 inline h-3 w-3" /> Import
                    rechazado: {result.failed} fila(s) con error · 0 CIs
                    creados (rollback).
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-subtle/40 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">
                        Fila
                      </th>
                      <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">
                        Estado
                      </th>
                      <th className="px-3 py-2 text-left font-medium uppercase tracking-wider">
                        Resultado
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.rows.map((r) => (
                      <ResultRow key={r.rowIndex + '-' + r.status} row={r} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ResultRow({ row }: { row: CsvImportRowResult }) {
  if (row.status === 'ok') {
    return (
      <tr className="bg-card">
        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
          {row.rowIndex}
        </td>
        <td className="px-3 py-2">
          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200">
            <CheckCircle2 className="h-3 w-3" /> OK
          </span>
        </td>
        <td className="px-3 py-2 text-foreground">
          <span className="font-mono text-[10px] text-muted-foreground">
            {row.code}
          </span>{' '}
          · {row.name}
        </td>
      </tr>
    )
  }
  return (
    <tr className="bg-card">
      <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
        {row.rowIndex}
      </td>
      <td className="px-3 py-2">
        <span className="inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-200">
          <XCircle className="h-3 w-3" /> Error
        </span>
      </td>
      <td className="px-3 py-2 text-foreground">
        {row.rawName ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            “{row.rawName}”
          </span>
        ) : null}{' '}
        <span className="text-rose-200">{row.message}</span>
      </td>
    </tr>
  )
}
