'use client'

/**
 * AvailableUsersFilter (Ola P8 · Equipo P8-1).
 *
 * Dropdown que muestra los usuarios disponibles en una fecha dada (con
 * skill+nivel mínimo y horas requeridas opcionales). Pensado para
 * embeber en formularios de tareas como "Asignar a (usuarios disponibles)"
 * SIN modificar TaskForm.tsx (instrucción explícita del Wave P8-1).
 *
 * Uso típico desde el cliente:
 *
 *   <AvailableUsersFilter
 *     date="2026-05-12"
 *     skillId="react"
 *     onSelect={(userId) => setAssigneeId(userId)}
 *   />
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  listAvailableUsers,
  type AvailableUserResult,
} from '@/lib/actions/resources'

export interface AvailableUsersFilterProps {
  /** YYYY-MM-DD UTC. */
  date: string
  skillId?: string
  minLevel?: number
  requiredHours?: number
  projectId?: string
  /** Callback opcional: dispara al elegir un usuario. */
  onSelect?: (user: AvailableUserResult) => void
  /** Si se pasa, fija el placeholder cuando aún no hay fecha válida. */
  placeholderText?: string
  /** Etiqueta visible junto al combobox. */
  label?: string
  /** Marca el control como deshabilitado en su totalidad. */
  disabled?: boolean
}

export function AvailableUsersFilter({
  date,
  skillId,
  minLevel,
  requiredHours,
  projectId,
  onSelect,
  placeholderText = 'Selecciona una fecha primero',
  label = 'Usuarios disponibles',
  disabled = false,
}: AvailableUsersFilterProps) {
  const [results, setResults] = useState<AvailableUserResult[]>([])
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string>('')

  // Snapshot del último request emitido para invalidar respuestas tardías
  // (race-condition: el user cambia la fecha varias veces seguidas).
  const requestIdRef = useRef(0)

  useEffect(() => {
    requestIdRef.current += 1
    const myId = requestIdRef.current
    if (!date || disabled) {
      // Sin fecha o deshabilitado: limpiamos resultados de forma segura.
      // Lanzamos el setState desde dentro de startTransition para evitar
      // cascading renders y cumplir con react-hooks/set-state-in-effect.
      startTransition(() => {
        setResults([])
        setError(null)
      })
      return
    }
    startTransition(async () => {
      try {
        const data = await listAvailableUsers({
          date,
          skillId,
          minLevel,
          requiredHours,
          projectId,
        })
        if (requestIdRef.current === myId) {
          setError(null)
          setResults(data)
        }
      } catch (err) {
        if (requestIdRef.current === myId) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          setResults([])
        }
      }
    })
  }, [date, skillId, minLevel, requiredHours, projectId, disabled])

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const userId = e.target.value
    setSelectedId(userId)
    if (!onSelect) return
    const found = results.find((r) => r.userId === userId)
    if (found) onSelect(found)
  }

  return (
    <div className="space-y-1" data-testid="available-users-filter">
      <label
        htmlFor="available-users-filter-select"
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
        {date && (
          <span className="ml-1 text-foreground/70">· {date}</span>
        )}
      </label>
      <select
        id="available-users-filter-select"
        value={selectedId}
        onChange={handleChange}
        disabled={disabled || isPending || !date}
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground disabled:opacity-50"
        data-testid="available-users-filter-select"
      >
        <option value="">
          {!date
            ? placeholderText
            : isPending
              ? 'Cargando…'
              : results.length === 0
                ? 'Sin usuarios disponibles'
                : `${results.length} disponibles`}
        </option>
        {results.map((r) => (
          <option key={r.userId} value={r.userId}>
            {r.userName}
            {r.level !== null ? ` · nivel ${r.level}` : ''}
            {` · holgura ${r.slack.toFixed(1)}h`}
          </option>
        ))}
      </select>
      {error && (
        <div
          role="alert"
          className="text-[11px] text-red-300"
          data-testid="available-users-filter-error"
        >
          {error}
        </div>
      )}
      {!error && results.length > 0 && (
        <ul
          className="space-y-0.5 text-[11px] text-muted-foreground"
          data-testid="available-users-filter-list"
        >
          {results.slice(0, 5).map((r) => (
            <li key={r.userId} className="flex justify-between">
              <span>{r.userName}</span>
              <span className="font-mono">
                {r.slack.toFixed(1)}h libres
                {r.level !== null ? ` · nv ${r.level}` : ''}
              </span>
            </li>
          ))}
          {results.length > 5 && (
            <li className="italic">+ {results.length - 5} más en el dropdown.</li>
          )}
        </ul>
      )}
    </div>
  )
}
