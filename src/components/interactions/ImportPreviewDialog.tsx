'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { X as CloseIcon, AlertTriangle, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import type {
  ImportError,
  ImportWarning,
} from '@/lib/import-export/MAPPING'

/**
 * HU-4.2 / HU-4.1 · Modal de pre-flight para importación.
 *
 * Generalizado para soportar dos formatos vía prop `format`:
 *   - 'excel': muestra columnas (mnemonic, parent_mnemonic).
 *   - 'msp-xml': muestra columnas (outline, parent_outline) — el mnemonic
 *     se autogenera (`MSP-${uid}`) y no aporta info al usuario.
 *
 * Muestra:
 *  - Conteos (tareas, dependencias, recursos, usuarios resueltos).
 *  - Warnings agrupados (parents inválidos, lag clamped, emails sin
 *    match, constraints/calendarios MSP ignorados) en banner amarillo.
 *  - Errors en banner rojo + botón confirmar disabled.
 *  - Sample 20 filas en tabla compacta.
 *  - Botón confirmar dispara `onConfirm` que la página padre orquesta
 *    via Server Action correspondiente (`importExcel` o `importMspXml`).
 */

export type PreviewFormat = 'excel' | 'msp-xml'

export type PreviewSampleRow = {
  /** Excel: mnemonic; MSP: undefined (se muestra outline en su lugar). */
  mnemonic?: string
  /** MSP: OutlineNumber jerárquico "1.2.3"; Excel: undefined. */
  outline?: string
  title: string
  /** Excel: parent_mnemonic; MSP: parent_outline. Ambos pueden ser null. */
  parent_mnemonic?: string | null
  parent_outline?: string
  start_date: string | Date
  end_date: string | Date
  priority: string
  is_milestone: boolean
  progress: number
}

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'preview'
      counts: {
        tasks: number
        deps: number
        resources: number
        matchedUsers: number
        unmatchedEmails: string[]
      }
      sample: PreviewSampleRow[]
      warnings: ImportWarning[]
    }
  | { status: 'errors'; errors: ImportError[] }
  | { status: 'committing' }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  filename: string | null
  state: PreviewState
  onConfirm: () => void
  onCancel: () => void
  /** Default: 'excel'. */
  format?: PreviewFormat
}

function fmtDate(d: string | Date): string {
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return '—'
  return date.toISOString().slice(0, 10)
}

export function ImportPreviewDialog({
  open,
  onOpenChange,
  filename,
  state,
  onConfirm,
  onCancel,
  format = 'excel',
}: Props) {
  const isCommitting = state.status === 'committing'
  const isLoading = state.status === 'loading'
  const isPreview = state.status === 'preview'
  const hasErrors = state.status === 'errors'

  const isMsp = format === 'msp-xml'
  const titleText = isMsp
    ? 'Vista previa del import (MS Project)'
    : 'Vista previa del import'
  const fileHint = isMsp
    ? 'Selecciona un archivo .xml (MSP 2003+) para continuar.'
    : 'Selecciona un archivo .xlsx para continuar.'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          data-testid="import-preview-dialog"
          className="fixed left-1/2 top-1/2 z-50 w-[min(900px,95vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border bg-background p-6 shadow-2xl"
          aria-describedby="import-preview-desc"
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold">
                {titleText}
              </Dialog.Title>
              <Dialog.Description
                id="import-preview-desc"
                className="mt-1 text-xs text-muted-foreground"
              >
                {filename ? `Archivo: ${filename}` : fileHint}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              aria-label="Cerrar"
            >
              <CloseIcon className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {(isLoading || isCommitting) && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-4 py-6 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              {isLoading
                ? 'Analizando archivo…'
                : 'Importando — modo reemplazar (esto borra y reescribe las tareas del proyecto)…'}
            </div>
          )}

          {hasErrors && (
            <div className="rounded-md border border-red-500/40 bg-red-950/20 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-red-300">
                <AlertTriangle className="h-4 w-4" />
                No se puede importar — corrige los errores y vuelve a intentar
              </div>
              <ul
                data-testid="import-errors-list"
                className="space-y-1 text-xs text-red-200"
              >
                {state.errors.map((e, i) => (
                  <li key={i} className="font-mono">
                    [{e.code}]
                    {e.sheet ? ` ${e.sheet}` : ''}
                    {e.row ? ` fila ${e.row}` : ''}: {e.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {isPreview && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <Metric label="Tareas" value={state.counts.tasks} />
                <Metric label="Dependencias" value={state.counts.deps} />
                <Metric label="Recursos" value={state.counts.resources} />
                <Metric
                  label="Emails resueltos"
                  value={`${state.counts.matchedUsers}/${state.counts.matchedUsers + state.counts.unmatchedEmails.length}`}
                />
              </div>

              {state.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-950/20 p-3">
                  <div className="mb-1 text-xs font-medium text-amber-300">
                    Advertencias ({state.warnings.length})
                  </div>
                  <ul
                    data-testid="import-warnings-list"
                    className="max-h-32 space-y-0.5 overflow-auto text-[11px] text-amber-200"
                  >
                    {state.warnings.map((w, i) => (
                      <li key={i} className="font-mono">
                        [{w.code}]
                        {w.sheet ? ` ${w.sheet}` : ''}
                        {w.row ? ` fila ${w.row}` : ''}: {w.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="overflow-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <Th>{isMsp ? 'outline' : 'mnemonic'}</Th>
                      <Th>title</Th>
                      <Th>{isMsp ? 'padre' : 'parent'}</Th>
                      <Th>start</Th>
                      <Th>end</Th>
                      <Th>prior.</Th>
                      <Th>%</Th>
                      <Th>hito</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.sample.map((t, i) => {
                      const idCol = isMsp
                        ? t.outline ?? '—'
                        : t.mnemonic ?? '—'
                      const parentCol = isMsp
                        ? t.parent_outline || '—'
                        : t.parent_mnemonic ?? '—'
                      const rowKey = isMsp
                        ? `${t.outline ?? ''}-${i}`
                        : t.mnemonic ?? `row-${i}`
                      return (
                        <tr key={rowKey} className="border-t border-border">
                          <Td className="font-mono">{idCol}</Td>
                          <Td>{t.title}</Td>
                          <Td className="font-mono">{parentCol}</Td>
                          <Td>{fmtDate(t.start_date)}</Td>
                          <Td>{fmtDate(t.end_date)}</Td>
                          <Td>{t.priority}</Td>
                          <Td>{t.progress}%</Td>
                          <Td>{t.is_milestone ? 'sí' : 'no'}</Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {state.counts.tasks > state.sample.length && (
                  <div className="bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
                    Mostrando primeras {state.sample.length} de{' '}
                    {state.counts.tasks} tareas.
                  </div>
                )}
              </div>

              <div className="rounded-md border border-amber-500/30 bg-amber-950/10 p-2 text-[11px] text-amber-200">
                Modo: <strong>reemplazar</strong>. La importación borrará todas
                las tareas y dependencias actuales del proyecto antes de
                escribir las nuevas.
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isCommitting}
              className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="import-confirm-button"
              onClick={onConfirm}
              disabled={!isPreview || isCommitting}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {isCommitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Confirmar importación
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  )
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <td className={clsx('px-2 py-1.5', className)}>{children}</td>
}
