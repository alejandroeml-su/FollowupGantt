'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState, useTransition } from 'react'
import { Camera, X as CloseIcon, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from './Toaster'
import { captureBaseline } from '@/lib/actions/baselines'
import {
  BASELINE_CAP_PER_PROJECT,
  BASELINE_LABEL_MAX,
  BASELINE_WARN_THRESHOLD,
} from '@/lib/scheduling/baseline-snapshot'

/**
 * HU-3.1 · Botón "Capturar línea base" + modal de confirmación.
 *
 * UX:
 *  - El botón vive en la toolbar del Gantt.
 *  - Disabled si no hay proyecto seleccionado o el proyecto no tiene
 *    tareas (taskCount === 0). Tooltip nativo `title` describe la razón.
 *  - Al click abre Dialog Radix con preview del nº de tareas, fecha de
 *    captura y un input opcional `label` (≤80 chars).
 *  - Si `existingCount >= BASELINE_WARN_THRESHOLD`, banner amarillo de
 *    soft cap. Si `existingCount >= BASELINE_CAP_PER_PROJECT`, el botón
 *    primario queda disabled (defensa extra; el server también valida).
 *  - Toast verde al éxito y `announce()` espeja al lector de pantalla.
 *  - Toast rojo al error con código tipado (`[BASELINE_CAP_REACHED]`,
 *    `[PROJECT_EMPTY]`, etc.).
 */

type Props = {
  /** Proyecto activo (filtrado por TaskFiltersBar). `null` deshabilita. */
  projectId: string | null
  projectName?: string | null
  /** Conteo de tareas no archivadas del proyecto. 0 → disabled. */
  taskCount: number
  /** Conteo actual de líneas base del proyecto (para banner soft cap). */
  baselineCount: number
  className?: string
}

function announce(msg: string) {
  if (typeof document === 'undefined') return
  const region = document.getElementById('a11y-live')
  if (!region) return
  region.textContent = ''
  setTimeout(() => (region.textContent = msg), 20)
}

function parseActionError(err: unknown): { code: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/^\[([A-Z_]+)\]\s*(.+)$/)
  return m ? { code: m[1], detail: m[2] } : { code: 'UNKNOWN', detail: msg }
}

function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function CaptureBaselineButton({
  projectId,
  projectName,
  taskCount,
  baselineCount,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [isPending, startTransition] = useTransition()

  // Reset al abrir/cerrar — evita que un label tipeado quede colgado
  // entre aperturas en proyectos distintos. La regla `set-state-in-effect`
  // marca este patrón como cascada, pero aquí es la única forma estable
  // de reaccionar al cierre del Dialog (Radix lo maneja vía onOpenChange,
  // pero perdemos el reset si el cierre viene de Escape o overlay-click).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) setLabel('')
  }, [open])
  /* eslint-enable react-hooks/set-state-in-effect */

  const noProject = !projectId
  const noTasks = !!projectId && taskCount === 0
  const capReached = baselineCount >= BASELINE_CAP_PER_PROJECT
  const nearCap = baselineCount >= BASELINE_WARN_THRESHOLD && !capReached

  const triggerDisabled = noProject || noTasks
  const triggerTitle = noProject
    ? 'Selecciona un proyecto con tareas'
    : noTasks
      ? 'El proyecto no tiene tareas para capturar'
      : 'Capturar el estado actual como línea base'

  const nextVersion = baselineCount + 1

  function onConfirm() {
    if (!projectId || isPending || capReached || noTasks) return
    startTransition(async () => {
      try {
        const created = await captureBaseline({
          projectId,
          label: label.trim() || undefined,
        })
        toast.success(`Línea base v.${created.version} capturada correctamente`)
        announce(
          `Línea base versión ${created.version} capturada con ${taskCount} tarea${
            taskCount !== 1 ? 's' : ''
          }`,
        )
        setOpen(false)
      } catch (err) {
        const { code, detail } = parseActionError(err)
        const msg =
          code === 'BASELINE_CAP_REACHED'
            ? `Máximo de ${BASELINE_CAP_PER_PROJECT} líneas base alcanzado. Limpia versiones antiguas para continuar.`
            : code === 'PROJECT_EMPTY'
              ? 'El proyecto no tiene tareas para capturar.'
              : code === 'NOT_FOUND'
                ? `Proyecto no encontrado · ${detail}`
                : code === 'INVALID_INPUT'
                  ? `Datos inválidos · ${detail}`
                  : `[${code}] ${detail}`
        toast.error(msg)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        data-testid="capture-baseline-button"
        disabled={triggerDisabled}
        title={triggerTitle}
        onClick={() => setOpen(true)}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors',
          'hover:bg-primary/20',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary/10',
          className,
        )}
      >
        <Camera className="h-3.5 w-3.5" />
        Capturar línea base
      </button>

      <Dialog.Root
        open={open}
        onOpenChange={(o) => {
          if (!isPending) setOpen(o)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content
            data-testid="capture-baseline-dialog"
            aria-describedby="capture-baseline-desc"
            className={clsx(
              'fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
              'rounded-xl border border-border bg-card p-5 shadow-2xl',
            )}
          >
            <div className="mb-4 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-foreground">
                  Capturar línea base v.{nextVersion}
                </Dialog.Title>
                {projectName ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {projectName}
                  </p>
                ) : null}
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Cerrar"
                  disabled={isPending}
                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            <p
              id="capture-baseline-desc"
              className="mb-3 text-sm text-foreground/90"
            >
              Se capturarán <strong>{taskCount}</strong> tarea
              {taskCount !== 1 ? 's' : ''} con fecha{' '}
              <strong>{todayLabel()}</strong>.
            </p>

            {nearCap && (
              <div
                role="status"
                className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
              >
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Tienes {baselineCount} líneas base en este proyecto. Considera
                  limpiar versiones obsoletas (límite: {BASELINE_CAP_PER_PROJECT}
                  ).
                </span>
              </div>
            )}

            {capReached && (
              <div
                role="alert"
                className="mb-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
              >
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Máximo de {BASELINE_CAP_PER_PROJECT} líneas base alcanzado.
                  Elimina versiones antiguas para continuar.
                </span>
              </div>
            )}

            <div className="mb-4">
              <label
                htmlFor="baseline-label"
                className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                Etiqueta (opcional)
              </label>
              <input
                id="baseline-label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value.slice(0, BASELINE_LABEL_MAX))}
                maxLength={BASELINE_LABEL_MAX}
                placeholder="Ej. Reaprob. comité Q2"
                disabled={isPending || capReached}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {label.length}/{BASELINE_LABEL_MAX}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={isPending}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary disabled:opacity-50"
                >
                  Cancelar
                </button>
              </Dialog.Close>
              <button
                type="button"
                data-testid="capture-baseline-confirm"
                onClick={onConfirm}
                disabled={isPending || capReached || noTasks}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Camera className="h-3.5 w-3.5" />
                {isPending ? 'Capturando…' : 'Capturar'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}
