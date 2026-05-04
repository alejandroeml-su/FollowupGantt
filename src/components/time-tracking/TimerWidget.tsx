'use client'

/**
 * Ola P1 · Equipo 4 — Widget flotante para iniciar/detener timer en
 * el contexto de una tarea. Pensado para montarse dentro del
 * `TaskDrawer` (drawer-only por ahora; futura iteración considerará un
 * botón global en el AppShell para reanudar el timer desde cualquier
 * vista).
 *
 * Estados:
 *   1. Sin timer activo o el timer activo es de OTRA tarea →
 *      muestra "Iniciar timer".
 *   2. Timer activo de ESTA tarea → muestra contador en vivo (mm:ss),
 *      "Detener" y "Cancelar".
 *
 * El contador se calcula con `Date.now() - startedAt` y se refresca
 * cada 1s con setInterval. No persistimos el contador — al recargar
 * la página el componente lee `getActiveTimerForUser` y lo recompone.
 */

import { useEffect, useState, useTransition } from 'react'
import { Play, Square, X } from 'lucide-react'
import { clsx } from 'clsx'
import { toast } from '@/components/interactions/Toaster'
import {
  startTimer,
  stopTimer,
  cancelActiveTimer,
  type SerializedTimeEntry,
} from '@/lib/actions/time-entries'

export type TimerWidgetProps = {
  taskId: string
  userId: string
  /**
   * Timer activo del usuario al momento del SSR/load. Si es de esta
   * misma tarea, el widget arranca en modo "running"; si es de otra
   * tarea o `null`, arranca en modo "idle".
   */
  initialActive?: SerializedTimeEntry | null
  /** Hook opcional para refrescar la lista de entries del padre. */
  onChange?: () => void
}

function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

function parseErrorCode(msg: string): string | null {
  const match = msg.match(/^\[([A-Z_]+)\]\s*(.*)$/)
  return match ? match[2] || match[1] : null
}

export function TimerWidget({
  taskId,
  userId,
  initialActive,
  onChange,
}: TimerWidgetProps) {
  // Trackeamos el timer activo SOLO cuando es de esta misma tarea.
  // Si pertenece a otra, mostramos un aviso pero el botón "Iniciar"
  // queda deshabilitado para evitar [TIMER_ALREADY_RUNNING].
  const [active, setActive] = useState<SerializedTimeEntry | null>(
    initialActive && initialActive.taskId === taskId ? initialActive : null,
  )
  const otherTaskActive =
    initialActive && initialActive.taskId !== taskId ? initialActive : null

  // `seconds` lo recalcula el efecto cada 1s (única lectura de Date.now,
  // que es impura y por tanto no puede vivir en el render-body bajo la
  // regla react-hooks/purity). Cuando `active` cambia a null, el efecto
  // se reejecuta y resetea `seconds` a 0 (la única setState dentro de
  // este efecto está envuelta por una guarda funcional para evitar el
  // anti-pattern de cascading-renders sincrónico).
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!active) {
      const reset = setTimeout(() => setSeconds(0), 0)
      return () => clearTimeout(reset)
    }
    const startMs = new Date(active.startedAt).getTime()
    const compute = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)))
    compute()
    const id = setInterval(compute, 1000)
    return () => clearInterval(id)
  }, [active])

  const [pending, startTx] = useTransition()

  function handleStart() {
    if (otherTaskActive) {
      toast.error('Ya tienes un timer activo en otra tarea. Deténlo primero.')
      return
    }
    startTx(async () => {
      try {
        const created = await startTimer({ taskId, userId })
        setActive(created)
        toast.success('Timer iniciado')
        onChange?.()
      } catch (e) {
        toast.error(parseErrorCode((e as Error).message) ?? 'Error al iniciar timer')
      }
    })
  }

  function handleStop() {
    if (!active) return
    const entryId = active.id
    startTx(async () => {
      try {
        await stopTimer({ entryId })
        setActive(null)
        toast.success('Timer detenido')
        onChange?.()
      } catch (e) {
        toast.error(parseErrorCode((e as Error).message) ?? 'Error al detener timer')
      }
    })
  }

  function handleCancel() {
    startTx(async () => {
      try {
        await cancelActiveTimer({ userId })
        setActive(null)
        toast.info('Timer cancelado')
        onChange?.()
      } catch (e) {
        toast.error(parseErrorCode((e as Error).message) ?? 'Error al cancelar timer')
      }
    })
  }

  if (active) {
    return (
      <div
        data-testid="timer-widget-running"
        className={clsx(
          'flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm',
        )}
        role="status"
        aria-live="polite"
      >
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span
          className="font-mono tabular-nums text-emerald-200"
          aria-label={`Tiempo transcurrido ${formatHMS(seconds)}`}
        >
          {formatHMS(seconds)}
        </span>
        <button
          type="button"
          onClick={handleStop}
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-red-500/20 px-2 py-1 text-xs font-medium text-red-200 hover:bg-red-500/30 disabled:opacity-50"
        >
          <Square className="h-3 w-3" aria-hidden /> Detener
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
        >
          <X className="h-3 w-3" aria-hidden /> Cancelar
        </button>
      </div>
    )
  }

  return (
    <div
      data-testid="timer-widget-idle"
      className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
    >
      <button
        type="button"
        onClick={handleStart}
        disabled={pending || Boolean(otherTaskActive)}
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
          otherTaskActive
            ? 'cursor-not-allowed bg-secondary text-muted-foreground'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
      >
        <Play className="h-3 w-3" aria-hidden /> Iniciar timer
      </button>
      {otherTaskActive ? (
        <span className="text-xs text-muted-foreground">
          Timer activo en otra tarea
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          Registra tu tiempo de trabajo
        </span>
      )}
    </div>
  )
}
