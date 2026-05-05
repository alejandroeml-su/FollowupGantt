'use client'

/**
 * SkillMatrix (Ola P8 · Equipo P8-1).
 *
 * Tabla Users × Skills con nivel 1-5 editable. Click en celda → cycle
 * 1 → 2 → 3 → 4 → 5 → null (sin skill) → 1. Doble click → setea null
 * directamente. Botón "Añadir skill" abre formulario modal sencillo.
 *
 * Comunicación con server actions:
 *   - `setUserSkillLevel({ userId, skillId, level })`
 *   - `removeUserSkill({ userId, skillId })`
 *   - `createSkill({ name, category? })`
 *
 * Optimistic UI: la mutación dispara router.refresh() después.
 */

import { useState, useTransition } from 'react'
import {
  createSkill,
  removeUserSkill,
  setUserSkillLevel,
} from '@/lib/actions/resources'
import { useRouter } from 'next/navigation'

interface SkillMatrixSkill {
  id: string
  name: string
  category: string | null
}

interface SkillMatrixUser {
  id: string
  name: string
}

export interface SkillMatrixProps {
  users: SkillMatrixUser[]
  skills: SkillMatrixSkill[]
  cells: Array<{
    userId: string
    skillId: string
    level: number | null
  }>
}

const LEVEL_COLORS: Record<number, string> = {
  1: 'bg-slate-700/40 text-slate-200',
  2: 'bg-blue-700/30 text-blue-200',
  3: 'bg-cyan-600/30 text-cyan-100',
  4: 'bg-emerald-600/30 text-emerald-100',
  5: 'bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/60',
}

function nextLevel(current: number | null): number | null {
  if (current === null) return 1
  if (current >= 5) return null
  return current + 1
}

export function SkillMatrix({ users, skills, cells }: SkillMatrixProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const cellByKey = new Map<string, number | null>()
  for (const c of cells) cellByKey.set(`${c.userId}::${c.skillId}`, c.level)

  function changeLevel(userId: string, skillId: string, current: number | null) {
    setErrorMsg(null)
    const next = nextLevel(current)
    startTransition(async () => {
      try {
        if (next === null) {
          await removeUserSkill({ userId, skillId })
        } else {
          await setUserSkillLevel({ userId, skillId, level: next })
        }
        router.refresh()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setErrorMsg(msg)
      }
    })
  }

  function clearLevel(userId: string, skillId: string) {
    setErrorMsg(null)
    startTransition(async () => {
      try {
        await removeUserSkill({ userId, skillId })
        router.refresh()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setErrorMsg(msg)
      }
    })
  }

  function handleAddSkill(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setErrorMsg(null)
    startTransition(async () => {
      try {
        await createSkill({
          name: newName.trim(),
          category: newCategory.trim() || undefined,
        })
        setNewName('')
        setNewCategory('')
        setShowAdd(false)
        router.refresh()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setErrorMsg(msg)
      }
    })
  }

  return (
    <div className="space-y-4" data-testid="skill-matrix">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Skill Matrix</h2>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="rounded-md bg-secondary px-3 py-1.5 text-sm text-foreground hover:bg-secondary/80"
          data-testid="skill-matrix-add-toggle"
        >
          {showAdd ? 'Cancelar' : '+ Añadir skill'}
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={handleAddSkill}
          className="flex flex-wrap gap-2 rounded-md border border-border bg-card/50 p-3"
          data-testid="skill-matrix-add-form"
        >
          <input
            type="text"
            placeholder="Nombre (ej. React, SQL)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="flex-1 min-w-[180px] rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            required
            data-testid="skill-matrix-name"
          />
          <input
            type="text"
            placeholder="Categoría (opcional)"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="min-w-[150px] rounded-md border border-border bg-background px-3 py-1.5 text-sm"
            data-testid="skill-matrix-category"
          />
          <button
            type="submit"
            disabled={isPending || !newName.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            data-testid="skill-matrix-create"
          >
            Crear
          </button>
        </form>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          data-testid="skill-matrix-error"
        >
          {errorMsg}
        </div>
      )}

      {skills.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
          Aún no hay skills definidas. Crea la primera arriba.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-secondary/50 p-2 text-left text-muted-foreground border-b border-r border-border min-w-[160px]">
                  Usuario
                </th>
                {skills.map((s) => (
                  <th
                    key={s.id}
                    className="bg-secondary/40 p-2 text-center text-muted-foreground border-b border-border min-w-[80px]"
                  >
                    <div className="font-medium text-white">{s.name}</div>
                    {s.category && (
                      <div className="text-[10px] text-muted-foreground/70">
                        {s.category}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="sticky left-0 z-10 bg-card p-2 border-b border-r border-border font-medium text-white">
                    {u.name}
                  </td>
                  {skills.map((s) => {
                    const level = cellByKey.get(`${u.id}::${s.id}`) ?? null
                    return (
                      <td
                        key={`${u.id}-${s.id}`}
                        className="border-b border-border p-1 text-center"
                      >
                        <button
                          type="button"
                          onClick={() => changeLevel(u.id, s.id, level)}
                          onDoubleClick={() => clearLevel(u.id, s.id)}
                          className={`w-full rounded-md px-2 py-1 transition-colors ${
                            level
                              ? LEVEL_COLORS[level]
                              : 'bg-transparent text-muted-foreground hover:bg-secondary/30'
                          } ${isPending ? 'opacity-60' : ''}`}
                          aria-label={`${u.name} · ${s.name} · ${level ? `nivel ${level}` : 'sin nivel'}`}
                          data-testid={`skill-cell-${u.id}-${s.id}`}
                          disabled={isPending}
                        >
                          {level ?? '—'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Click para subir nivel (1→5 cíclico). Doble-click para limpiar.
      </p>
    </div>
  )
}
