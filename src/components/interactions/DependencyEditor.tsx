'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState, useTransition } from 'react'
import { X as CloseIcon, Minus, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from './Toaster'
import {
  updateDependency,
  deleteDependency,
} from '@/lib/actions/dependencies'

/**
 * HU-1.4 · Editor de dependencias.
 *
 * Dialog Radix anclado vía coordenadas del click derecho. Permite cambiar
 * el tipo (segmented control FS/SS/FF/SF) y el lag (-30 .. 365 días) y
 * dispara `updateDependency` en el server. Soporta también la eliminación
 * con confirmación inline.
 *
 * Convenciones del proyecto:
 *  - Errores tipados parseados con regex `[CODE] detalle`.
 *  - Toast verde en éxito, rojo en error con código en el mensaje.
 *  - Anuncia cambios vía la región a11y-live de la página.
 *  - ESC cierra; Radix maneja focus trap.
 *  - Las flechas del segmented control (←/→) navegan tipo (rovinground tabIndex).
 */

export type DepType = 'FS' | 'SS' | 'FF' | 'SF'

export type DependencyEditorPayload = {
  id: string
  predecessorId: string
  successorId: string
  type: DepType
  lagDays: number
  predecessor: { mnemonic?: string | null; title: string }
  successor: { mnemonic?: string | null; title: string }
}

type Props = {
  /** Cuando se pasa una dep, el dialog está abierto. `null` lo cierra. */
  dependency: DependencyEditorPayload | null
  /** Coordenadas (clientX/Y) para anclar el dialog cerca del click. */
  position: { x: number; y: number } | null
  onClose: () => void
}

const TYPES: { value: DepType; label: string; hint: string }[] = [
  { value: 'FS', label: 'FS', hint: 'Finish-to-Start' },
  { value: 'SS', label: 'SS', hint: 'Start-to-Start' },
  { value: 'FF', label: 'FF', hint: 'Finish-to-Finish' },
  { value: 'SF', label: 'SF', hint: 'Start-to-Finish' },
]

const LAG_MIN = -30
const LAG_MAX = 365

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

function shortMnem(mn?: string | null): string {
  return mn?.trim() || ''
}

export function DependencyEditor({ dependency, position, onClose }: Props) {
  const open = !!dependency

  // Estado local; reset al abrir.
  const [type, setType] = useState<DepType>(dependency?.type ?? 'FS')
  const [lag, setLag] = useState<number>(dependency?.lagDays ?? 0)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [isPending, startTransition] = useTransition()
  const lagInputRef = useRef<HTMLInputElement>(null)

  /* eslint-disable react-hooks/set-state-in-effect */
  // Sincroniza al abrir con una nueva dep (transición de evento, no derivación).
  useEffect(() => {
    if (dependency) {
      setType(dependency.type)
      setLag(dependency.lagDays)
      setConfirmingDelete(false)
    }
  }, [dependency])
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!dependency) return null

  const lagValid = Number.isInteger(lag) && lag >= LAG_MIN && lag <= LAG_MAX
  const dirty = type !== dependency.type || lag !== dependency.lagDays
  const canSave = dirty && lagValid && !isPending

  const predLabel = shortMnem(dependency.predecessor.mnemonic) || dependency.predecessor.title
  const succLabel = shortMnem(dependency.successor.mnemonic) || dependency.successor.title

  function changeType(next: DepType) {
    setType(next)
  }

  function clampLag(value: number): number {
    if (Number.isNaN(value)) return 0
    if (value < LAG_MIN) return LAG_MIN
    if (value > LAG_MAX) return LAG_MAX
    return Math.trunc(value)
  }

  function handleSave() {
    if (!canSave) return
    // En este punto `dependency` es non-null (early return arriba), pero TS
    // pierde el narrowing al cruzar el closure async.
    const dep = dependency!
    startTransition(async () => {
      try {
        await updateDependency({
          id: dep.id,
          ...(type !== dep.type ? { type } : {}),
          ...(lag !== dep.lagDays ? { lagDays: lag } : {}),
        })
        toast.success(
          type !== dep.type
            ? `Dependencia actualizada a ${type}`
            : `Lag actualizado a ${lag} día${Math.abs(lag) !== 1 ? 's' : ''}`,
        )
        announce(
          `Dependencia ${type} guardada con lag de ${lag} día${Math.abs(lag) !== 1 ? 's' : ''}`,
        )
        onClose()
      } catch (err) {
        const { code, detail } = parseActionError(err)
        const msg =
          code === 'CYCLE_DETECTED'
            ? `Ciclo detectado · ${detail}`
            : code === 'INVALID_LAG'
              ? `Lag inválido · ${detail}`
              : code === 'INVALID_TYPE'
                ? `Tipo inválido · ${detail}`
                : code === 'NOT_FOUND'
                  ? `No encontrada · ${detail}`
                  : code === 'NEGATIVE_FLOAT'
                    ? `Holgura negativa · ${detail}`
                    : detail
        toast.error(msg)
      }
    })
  }

  // Estilo de anclaje: si tenemos posición de click, anclamos la esquina
  // superior izquierda allí (con clamp básico vía maxWidth). Si no, centramos.
  const anchorStyle: React.CSSProperties = position
    ? {
        position: 'fixed',
        left: Math.max(8, Math.min(position.x, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 300)),
        top: Math.max(8, Math.min(position.y, (typeof window !== 'undefined' ? window.innerHeight : 768) - 280)),
      }
    : {
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
      }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            lagInputRef.current?.focus()
          }}
          style={anchorStyle}
          className="z-50 w-[280px] rounded-xl border border-border bg-card p-4 shadow-2xl"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold text-foreground">
                Dependencia
              </Dialog.Title>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {predLabel} → {succLabel}
              </p>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Cerrar"
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {!confirmingDelete ? (
            <>
              <div className="mb-3">
                <span
                  id="dep-type-label"
                  className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Tipo
                </span>
                <div
                  role="radiogroup"
                  aria-labelledby="dep-type-label"
                  className="grid grid-cols-4 overflow-hidden rounded-md border border-border"
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                    e.preventDefault()
                    const idx = TYPES.findIndex((t) => t.value === type)
                    const next =
                      e.key === 'ArrowRight'
                        ? TYPES[(idx + 1) % TYPES.length]
                        : TYPES[(idx - 1 + TYPES.length) % TYPES.length]
                    changeType(next.value)
                  }}
                >
                  {TYPES.map((t) => {
                    const active = type === t.value
                    return (
                      <button
                        key={t.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        title={t.hint}
                        tabIndex={active ? 0 : -1}
                        onClick={() => changeType(t.value)}
                        className={clsx(
                          'h-9 text-xs font-semibold transition-colors',
                          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500',
                          active
                            ? 'bg-indigo-500/20 text-indigo-200'
                            : 'bg-background text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                        )}
                      >
                        {t.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="mb-4">
                <label
                  htmlFor="dep-lag"
                  className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Lag (días)
                </label>
                <div className="flex items-stretch gap-1">
                  <button
                    type="button"
                    aria-label="Disminuir lag"
                    onClick={() => setLag((v) => clampLag(v - 1))}
                    className="rounded-md border border-border bg-background px-2 text-foreground hover:bg-secondary/60"
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <input
                    ref={lagInputRef}
                    id="dep-lag"
                    type="number"
                    inputMode="numeric"
                    min={LAG_MIN}
                    max={LAG_MAX}
                    step={1}
                    value={Number.isNaN(lag) ? '' : lag}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (raw === '' || raw === '-') {
                        // Permitimos input transitorio; la validación del save
                        // bloqueará el envío.
                        setLag(Number.NaN)
                        return
                      }
                      const n = Number(raw)
                      setLag(Number.isFinite(n) ? Math.trunc(n) : Number.NaN)
                    }}
                    onBlur={() =>
                      setLag((v) => (Number.isNaN(v) ? 0 : clampLag(v)))
                    }
                    className={clsx(
                      'w-full rounded-md border bg-background px-2 py-1.5 text-center text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-indigo-500',
                      lagValid ? 'border-border' : 'border-red-500/60',
                    )}
                  />
                  <button
                    type="button"
                    aria-label="Aumentar lag"
                    onClick={() => setLag((v) => clampLag(v + 1))}
                    className="rounded-md border border-border bg-background px-2 text-foreground hover:bg-secondary/60"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p
                  className={clsx(
                    'mt-1 text-[11px]',
                    lagValid ? 'text-muted-foreground' : 'text-red-400',
                  )}
                >
                  Entero entre {LAG_MIN} y {LAG_MAX}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={isPending}
                  className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                >
                  Eliminar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className={clsx(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    canSave
                      ? 'bg-indigo-500 text-white hover:bg-indigo-400'
                      : 'cursor-not-allowed bg-secondary text-muted-foreground',
                  )}
                >
                  {isPending ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </>
          ) : (
            <DeleteConfirm
              onCancel={() => setConfirmingDelete(false)}
              dependency={dependency}
              onAfterDelete={onClose}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Sub-vista del Dialog: confirmación de eliminación. Se renderiza dentro del
 * mismo Dialog.Content para no perder el anclaje ni el focus trap. Usa los
 * ids de `dependency` (predecessorId/successorId) que el wrapper inyecta a
 * través del payload extendido (ver GanttBoardClient).
 */
function DeleteConfirm({
  dependency,
  onCancel,
  onAfterDelete,
}: {
  dependency: DependencyEditorPayload
  onCancel: () => void
  onAfterDelete: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const predLabel =
    shortMnem(dependency.predecessor.mnemonic) || dependency.predecessor.title
  const succLabel =
    shortMnem(dependency.successor.mnemonic) || dependency.successor.title

  function confirm() {
    startTransition(async () => {
      try {
        await deleteDependency({
          predecessorId: dependency.predecessorId,
          successorId: dependency.successorId,
        })
        toast.success('Dependencia eliminada')
        announce('Dependencia eliminada')
        onAfterDelete()
      } catch (err) {
        const { detail } = parseActionError(err)
        toast.error(detail)
      }
    })
  }

  return (
    <div>
      <p className="mb-3 text-sm text-foreground">
        ¿Eliminar la dependencia <strong>{predLabel}</strong> →{' '}
        <strong>{succLabel}</strong>?
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        Esta acción no se puede deshacer.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary/60 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={isPending}
          className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50"
        >
          {isPending ? 'Eliminando…' : 'Eliminar'}
        </button>
      </div>
    </div>
  )
}
