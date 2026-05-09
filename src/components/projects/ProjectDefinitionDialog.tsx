'use client'

/**
 * Wave P14 (Project Definition · Mantenimiento) — Diálogo dual:
 *   1. Tab "Definición": editar nombre, descripción, status, methodology,
 *      gerencia/área, manager, budget, fechas.
 *   2. Tab "Miembros": gestionar usuarios (ProjectAssignment) y equipos
 *      (TeamProject) con visibilidad heredada (Wave P13).
 *
 * Server actions usadas:
 *   - updateProjectDefinition (Wave P14)
 *   - addProjectMember / removeProjectMember
 *   - addProjectTeam / removeProjectTeam
 */

import { useMemo, useState, useTransition } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Settings,
  Users as UsersIcon,
  X as CloseIcon,
  Plus,
  Trash2,
  Building2,
  Workflow,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import {
  addProjectMember,
  addProjectTeam,
  removeProjectMember,
  removeProjectTeam,
  updateProjectDefinition,
} from '@/lib/actions/project-definition'
import { toast } from '@/components/interactions/Toaster'
import type { ProjectMethodology, ProjectStatus } from '@prisma/client'

type Tab = 'definition' | 'members'

export interface ProjectDefinitionState {
  id: string
  name: string
  description: string | null
  status: ProjectStatus
  methodology: ProjectMethodology
  areaId: string | null
  managerId: string | null
  budget: number | null
  budgetCurrency: string | null
  members: { id: string; name: string; email: string }[]
  teams: { id: string; name: string; memberCount: number }[]
}

export interface ProjectDefinitionCatalogs {
  gerencias: { id: string; name: string }[]
  areas: { id: string; name: string; gerenciaId: string | null }[]
  users: { id: string; name: string; email: string }[]
  teams: { id: string; name: string }[]
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: ProjectDefinitionState
  catalogs: ProjectDefinitionCatalogs
}

const METHODOLOGY_OPTIONS: {
  value: ProjectMethodology
  label: string
  description: string
}[] = [
  { value: 'SCRUM', label: 'Scrum', description: 'Ágil puro' },
  { value: 'PMI', label: 'PMI', description: 'PMBOK plan-driven' },
  { value: 'HYBRID', label: 'Híbrido', description: 'Combinación' },
]

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'PLANNING', label: 'Planning' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On Hold' },
  { value: 'COMPLETED', label: 'Completed' },
]

export function ProjectDefinitionDialog({
  open,
  onOpenChange,
  initial,
  catalogs,
}: Props): React.JSX.Element {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('definition')
  const [pending, startTransition] = useTransition()

  // Definition fields
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description ?? '')
  const [status, setStatus] = useState<ProjectStatus>(initial.status)
  const [methodology, setMethodology] = useState<ProjectMethodology>(
    initial.methodology,
  )
  const [areaId, setAreaId] = useState(initial.areaId ?? '')
  const initialGerenciaId = useMemo(() => {
    if (!initial.areaId) return ''
    return catalogs.areas.find((a) => a.id === initial.areaId)?.gerenciaId ?? ''
  }, [initial.areaId, catalogs.areas])
  const [gerenciaId, setGerenciaId] = useState(initialGerenciaId)
  const [managerId, setManagerId] = useState(initial.managerId ?? '')
  const [budget, setBudget] = useState<number | ''>(
    initial.budget !== null ? initial.budget : '',
  )

  // Members tabs state
  const [members, setMembers] = useState(initial.members)
  const [teams, setTeams] = useState(initial.teams)
  const [memberToAdd, setMemberToAdd] = useState('')
  const [teamToAdd, setTeamToAdd] = useState('')

  const visibleAreas = useMemo(
    () =>
      gerenciaId
        ? catalogs.areas.filter((a) => a.gerenciaId === gerenciaId)
        : catalogs.areas,
    [catalogs.areas, gerenciaId],
  )
  const availableUsers = catalogs.users.filter(
    (u) => !members.some((m) => m.id === u.id),
  )
  const availableTeams = catalogs.teams.filter(
    (t) => !teams.some((tt) => tt.id === t.id),
  )

  const saveDefinition = () => {
    if (!name.trim()) {
      toast.error('El nombre es requerido')
      return
    }
    startTransition(async () => {
      try {
        await updateProjectDefinition({
          projectId: initial.id,
          name,
          description,
          status,
          methodology,
          areaId: areaId || null,
          managerId: managerId || null,
          budget: typeof budget === 'number' ? budget : null,
          budgetCurrency: typeof budget === 'number' ? 'USD' : null,
        })
        toast.success('Definición actualizada')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const handleAddMember = () => {
    if (!memberToAdd) return
    const u = catalogs.users.find((x) => x.id === memberToAdd)
    if (!u) return
    startTransition(async () => {
      try {
        await addProjectMember({ projectId: initial.id, userId: u.id })
        setMembers((prev) => [...prev, u])
        setMemberToAdd('')
        toast.success(`${u.name} agregado al proyecto`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const handleRemoveMember = (userId: string) => {
    startTransition(async () => {
      try {
        await removeProjectMember({ projectId: initial.id, userId })
        setMembers((prev) => prev.filter((m) => m.id !== userId))
        toast.success('Miembro removido')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const handleAddTeam = () => {
    if (!teamToAdd) return
    const t = catalogs.teams.find((x) => x.id === teamToAdd)
    if (!t) return
    startTransition(async () => {
      try {
        await addProjectTeam({ projectId: initial.id, teamId: t.id })
        setTeams((prev) => [...prev, { ...t, memberCount: 0 }])
        setTeamToAdd('')
        toast.success(`Equipo ${t.name} agregado`)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  const handleRemoveTeam = (teamId: string) => {
    startTransition(async () => {
      try {
        await removeProjectTeam({ projectId: initial.id, teamId })
        setTeams((prev) => prev.filter((t) => t.id !== teamId))
        toast.success('Equipo removido')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(800px,94vw)] max-h-[92vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl">
          <div className="flex items-start justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Settings className="h-5 w-5 text-indigo-400" />
              Definición del proyecto · {initial.name}
            </Dialog.Title>
            <Dialog.Close className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
              <CloseIcon className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <div className="flex gap-1 border-b border-border mb-4">
            <button
              type="button"
              onClick={() => setTab('definition')}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === 'definition'
                  ? 'border-indigo-500 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Workflow className="inline h-3.5 w-3.5 mr-1" />
              Definición
            </button>
            <button
              type="button"
              onClick={() => setTab('members')}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === 'members'
                  ? 'border-indigo-500 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <UsersIcon className="inline h-3.5 w-3.5 mr-1" />
              Miembros ({members.length} usuarios · {teams.length} equipos)
            </button>
          </div>

          {tab === 'definition' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Nombre del proyecto <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Descripción
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    <Building2 className="inline h-3 w-3 mr-1" />
                    Gerencia
                  </label>
                  <select
                    value={gerenciaId}
                    onChange={(e) => {
                      setGerenciaId(e.target.value)
                      setAreaId('')
                    }}
                    className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground"
                  >
                    <option value="">— Sin gerencia —</option>
                    {catalogs.gerencias.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Área
                  </label>
                  <select
                    value={areaId}
                    onChange={(e) => setAreaId(e.target.value)}
                    disabled={!gerenciaId}
                    className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground disabled:opacity-50"
                  >
                    <option value="">— Sin área —</option>
                    {visibleAreas.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Metodología <span className="text-rose-400">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {METHODOLOGY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMethodology(opt.value)}
                      className={clsx(
                        'rounded-md border px-3 py-2 text-left transition-colors',
                        methodology === opt.value
                          ? 'border-indigo-500/60 bg-indigo-500/10'
                          : 'border-border bg-background hover:bg-subtle',
                      )}
                    >
                      <div className="text-sm font-medium text-foreground">
                        {opt.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {opt.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Status
                  </label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                    className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Manager (PM)
                  </label>
                  <select
                    value={managerId}
                    onChange={(e) => setManagerId(e.target.value)}
                    className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground"
                  >
                    <option value="">— Sin manager —</option>
                    {catalogs.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Budget USD
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={budget}
                    onChange={(e) =>
                      setBudget(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-subtle"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={saveDefinition}
                  disabled={pending}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Guardar definición
                </button>
              </div>
            </div>
          )}

          {tab === 'members' && (
            <div className="space-y-6">
              {/* Usuarios */}
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  Usuarios asignados ({members.length})
                </h3>
                <div className="flex gap-2 mb-3">
                  <select
                    value={memberToAdd}
                    onChange={(e) => setMemberToAdd(e.target.value)}
                    className="flex-1 rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground"
                  >
                    <option value="">— Selecciona un usuario para agregar —</option>
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · {u.email}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddMember}
                    disabled={pending || !memberToAdd}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar
                  </button>
                </div>
                <ul className="divide-y divide-border/60 rounded-md border border-border">
                  {members.length === 0 && (
                    <li className="px-3 py-3 text-xs text-muted-foreground text-center">
                      Sin usuarios asignados directamente
                    </li>
                  )}
                  {members.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {m.name}
                        </div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.id)}
                        disabled={pending}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
                        aria-label="Remover"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Equipos */}
              <section>
                <h3 className="text-sm font-semibold text-foreground mb-2">
                  Equipos asignados ({teams.length}) · visibilidad heredada por
                  miembros
                </h3>
                <div className="flex gap-2 mb-3">
                  <select
                    value={teamToAdd}
                    onChange={(e) => setTeamToAdd(e.target.value)}
                    className="flex-1 rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground"
                  >
                    <option value="">— Selecciona un equipo —</option>
                    {availableTeams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddTeam}
                    disabled={pending || !teamToAdd}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar
                  </button>
                </div>
                <ul className="divide-y divide-border/60 rounded-md border border-border">
                  {teams.length === 0 && (
                    <li className="px-3 py-3 text-xs text-muted-foreground text-center">
                      Sin equipos asignados
                    </li>
                  )}
                  {teams.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between px-3 py-2"
                    >
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {t.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t.memberCount} miembro{t.memberCount === 1 ? '' : 's'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveTeam(t.id)}
                        disabled={pending}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-50"
                        aria-label="Remover"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * Trigger button standalone — útil para insertar desde un Server Component
 * (Project Detail page) que ya pre-cargó el estado y los catálogos.
 */
export function ProjectDefinitionTrigger(props: {
  initial: ProjectDefinitionState
  catalogs: ProjectDefinitionCatalogs
  label?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-subtle"
      >
        <Settings className="h-3.5 w-3.5" />
        {props.label ?? 'Definición & Miembros'}
      </button>
      <ProjectDefinitionDialog
        open={open}
        onOpenChange={setOpen}
        initial={props.initial}
        catalogs={props.catalogs}
      />
    </>
  )
}
