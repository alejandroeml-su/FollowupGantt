'use client'

import React, { useState, useTransition } from 'react'
import { Plus, Users, Trash2, UserPlus, Pencil, X } from 'lucide-react'
import {
  createTeam,
  updateTeam,
  deleteTeam,
  addMemberToTeam,
  removeMemberFromTeam,
} from '@/lib/actions'
import { toast } from '@/components/interactions/Toaster'

type Member = { user: { id: string; name: string; email: string } }
type Team = {
  id: string
  name: string
  description: string | null
  members: Member[]
}
type User = { id: string; name: string; email: string }

type Props = {
  teams: Team[]
  users: User[]
}

type TeamFormState = { id?: string; name: string; description: string }

export default function TeamsSettings({ teams, users }: Props) {
  const [isPending, startTransition] = useTransition()

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<TeamFormState>({ name: '', description: '' })

  const [memberModalTeamId, setMemberModalTeamId] = useState<string | null>(null)
  const [memberSelect, setMemberSelect] = useState<string>('')

  // ─── Crear / Editar ───────────────────────────────────────────────
  const openCreate = () => {
    setForm({ name: '', description: '' })
    setFormOpen(true)
  }

  const openEdit = (team: Team) => {
    setForm({ id: team.id, name: team.name, description: team.description || '' })
    setFormOpen(true)
  }

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('name', form.name.trim())
        fd.set('description', form.description.trim())
        if (form.id) {
          fd.set('id', form.id)
          await updateTeam(fd)
          toast.success('Equipo actualizado')
        } else {
          await createTeam(fd)
          toast.success('Equipo creado')
        }
        setFormOpen(false)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar el equipo')
      }
    })
  }

  // ─── Eliminar equipo ──────────────────────────────────────────────
  const handleDeleteTeam = (team: Team) => {
    if (!confirm(`¿Eliminar el equipo "${team.name}"? Esta acción no se puede deshacer.`)) return
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('id', team.id)
        await deleteTeam(fd)
        toast.success('Equipo eliminado')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al eliminar')
      }
    })
  }

  // ─── Miembros ─────────────────────────────────────────────────────
  const openMemberModal = (teamId: string) => {
    setMemberModalTeamId(teamId)
    setMemberSelect('')
  }

  const handleAddMember = () => {
    if (!memberModalTeamId || !memberSelect) return
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('teamId', memberModalTeamId)
        fd.set('userId', memberSelect)
        await addMemberToTeam(fd)
        toast.success('Miembro añadido')
        setMemberModalTeamId(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al añadir miembro')
      }
    })
  }

  const handleRemoveMember = (teamId: string, userId: string, userName: string) => {
    if (!confirm(`¿Quitar a ${userName} del equipo?`)) return
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('teamId', teamId)
        fd.set('userId', userId)
        await removeMemberFromTeam(fd)
        toast.success('Miembro removido')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al remover miembro')
      }
    })
  }

  const activeTeam = memberModalTeamId ? teams.find(t => t.id === memberModalTeamId) : null
  const availableUsers = activeTeam
    ? users.filter(u => !activeTeam.members.some(m => m.user.id === u.id))
    : []

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Equipos de Trabajo
          </h1>
          <p className="text-muted-foreground text-sm">
            Organiza a tus agentes y administradores en células de trabajo.
          </p>
        </div>
        <button
          onClick={openCreate}
          disabled={isPending}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-md disabled:opacity-60"
        >
          <Plus className="h-4 w-4" />
          Nuevo Equipo
        </button>
      </div>

      <div className="grid gap-6">
        {teams.map((team) => (
          <div key={team.id} className="bg-card border border-border rounded-xl shadow-sm overflow-hidden transition-all hover:shadow-md">
            <div className="p-6 border-b border-border flex items-start justify-between bg-muted/20">
              <div className="space-y-1">
                <h3 className="font-bold text-lg text-foreground">{team.name}</h3>
                <p className="text-sm text-muted-foreground">{team.description || 'Sin descripción'}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openMemberModal(team.id)}
                  disabled={isPending}
                  title="Añadir miembro"
                  className="p-2 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                >
                  <UserPlus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => openEdit(team)}
                  disabled={isPending}
                  title="Editar equipo"
                  className="p-2 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => handleDeleteTeam(team)}
                  disabled={isPending}
                  title="Eliminar equipo"
                  className="p-2 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                Miembros ({team.members.length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {team.members.map((m) => (
                  <div key={m.user.id} className="group flex items-center gap-3 p-2 rounded-lg border border-border bg-background/50">
                    <div className="h-7 w-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold">
                      {m.user.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="overflow-hidden flex-1">
                      <p className="text-xs font-medium text-foreground truncate">{m.user.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{m.user.email}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveMember(team.id, m.user.id, m.user.name)}
                      disabled={isPending}
                      title="Quitar del equipo"
                      className="p-1 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {team.members.length === 0 && (
                  <p className="col-span-full text-center py-4 text-xs text-muted-foreground italic">Este equipo no tiene miembros aún.</p>
                )}
              </div>
            </div>
          </div>
        ))}

        {teams.length === 0 && (
          <div className="text-center py-20 bg-muted/20 rounded-xl border-2 border-dashed border-border">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <p className="text-muted-foreground">No hay equipos creados.</p>
          </div>
        )}
      </div>

      {/* ─── Modal Crear/Editar ─────────────────────────────────── */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setFormOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmitForm}
            className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                {form.id ? 'Editar equipo' : 'Nuevo equipo'}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="p-1 rounded-md hover:bg-accent text-muted-foreground"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nombre</label>
              <input
                autoFocus
                type="text"
                value={form.name}
                onChange={(e) => setForm(s => ({ ...s, name: e.target.value }))}
                placeholder="Ej. Célula Backend"
                className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Descripción</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm(s => ({ ...s, description: e.target.value }))}
                rows={3}
                placeholder="Propósito y alcance del equipo"
                className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none resize-none"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-md disabled:opacity-60"
              >
                {form.id ? 'Guardar cambios' : 'Crear equipo'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── Modal Añadir miembro ───────────────────────────────── */}
      {activeTeam && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setMemberModalTeamId(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-primary" />
                Añadir miembro a {activeTeam.name}
              </h2>
              <button
                type="button"
                onClick={() => setMemberModalTeamId(null)}
                className="p-1 rounded-md hover:bg-accent text-muted-foreground"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {availableUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-4 text-center">
                Todos los usuarios ya forman parte de este equipo.
              </p>
            ) : (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Usuario</label>
                <select
                  value={memberSelect}
                  onChange={(e) => setMemberSelect(e.target.value)}
                  className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="">Selecciona un usuario…</option>
                  {availableUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.name} — {u.email}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMemberModalTeamId(null)}
                disabled={isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-accent transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleAddMember}
                disabled={isPending || !memberSelect || availableUsers.length === 0}
                className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-md disabled:opacity-60"
              >
                Añadir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
