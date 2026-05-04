'use client'

/**
 * Sección que une `TimerWidget` + `ManualEntryDialog` + `TimeEntriesList`
 * para mostrarse dentro del `TaskDrawerContent`. Carga los entries de
 * la tarea en cliente (server action) y los re-cachea cuando se
 * dispara una mutación (start/stop, manual create, delete).
 */

import { useCallback, useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import {
  getEntriesForTask,
  getActiveTimerForUser,
  type SerializedTimeEntry,
} from '@/lib/actions/time-entries'
import { TimerWidget } from './TimerWidget'
import { TimeEntriesList } from './TimeEntriesList'
import { ManualEntryDialog } from './ManualEntryDialog'

type Props = {
  taskId: string
  /** Usuario actual (mismo placeholder que el resto del sistema sin auth real). */
  currentUserId: string
  /** Mapa userId → name para mostrar autores. */
  userNames?: Record<string, string>
}

export function TaskTimeTrackingSection({ taskId, currentUserId, userNames }: Props) {
  const [entries, setEntries] = useState<SerializedTimeEntry[]>([])
  const [activeTimer, setActiveTimer] = useState<SerializedTimeEntry | null>(null)
  const [loaded, setLoaded] = useState(false)
  // Bumping `version` desde callbacks externos (start/stop/manual create)
  // dispara el refetch sin tener que invocar setState sincrónicamente
  // dentro del efecto.
  const [version, setVersion] = useState(0)

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getEntriesForTask(taskId),
      getActiveTimerForUser(currentUserId),
    ])
      .then(([list, active]) => {
        if (cancelled) return
        setEntries(list)
        setActiveTimer(active)
        setLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [taskId, currentUserId, version])

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby={`time-tracking-${taskId}`}
    >
      <header className="flex items-center justify-between">
        <h3
          id={`time-tracking-${taskId}`}
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <Clock className="h-4 w-4 text-emerald-400" aria-hidden />
          Time Tracking
        </h3>
        <ManualEntryDialog
          taskId={taskId}
          userId={currentUserId}
          onCreated={refresh}
        />
      </header>

      <TimerWidget
        taskId={taskId}
        userId={currentUserId}
        initialActive={activeTimer}
        onChange={refresh}
      />

      {loaded ? (
        <TimeEntriesList
          taskId={taskId}
          entries={entries}
          userNames={userNames}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Cargando registros…</p>
      )}
    </section>
  )
}
