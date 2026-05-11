'use client'

import React, { useMemo, useState, useTransition } from 'react'
import {
  Plus,
  User,
  Shield,
  UserPlus,
  Mail,
  Pencil,
  AlertTriangle,
  Building2,
  UserCheck,
  UserX,
  X,
} from 'lucide-react'
import {
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
} from '@/lib/actions'
import { toast } from '@/components/interactions/Toaster'

type UserData = {
  id: string
  name: string
  email: string
  archivedAt: Date | string | null
  gerenciaId: string | null
  gerencia: { id: string; name: string } | null
  roles: { role: { id: string; name: string } }[]
}

type Role = {
  id: string
  name: string
}

type GerenciaOption = {
  id: string
  name: string
  currentManager: { id: string; name: string; email: string } | null
  isAvailable: boolean
}

type Props = {
  initialUsers: UserData[]
  roles: Role[]
  gerencias: GerenciaOption[]
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'create' }
  | { kind: 'edit'; user: UserData }

export default function UsersSettings({
  initialUsers,
  roles,
  gerencias,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [includeInactive, setIncludeInactive] = useState(false)

  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set())
  const [selectedGerenciaId, setSelectedGerenciaId] = useState<string>('')

  const gerenteAreaRoleId = useMemo(
    () => roles.find((r) => r.name === 'GERENTE_AREA')?.id ?? null,
    [roles],
  )
  const isGerenteAreaSelected = !!(
    gerenteAreaRoleId && selectedRoleIds.has(gerenteAreaRoleId)
  )

  // Para edit: la gerencia actual del user editado NO bloquea (no es conflicto consigo mismo).
  const editingUserId = mode.kind === 'edit' ? mode.user.id : null
  const selectedGerencia = gerencias.find((g) => g.id === selectedGerenciaId)
  const gerenciaBlocked =
    isGerenteAreaSelected &&
    !!selectedGerencia &&
    !selectedGerencia.isAvailable &&
    selectedGerencia.currentManager?.id !== editingUserId

  const filteredUsers = useMemo(
    () =>
      includeInactive
        ? initialUsers
        : initialUsers.filter((u) => !u.archivedAt),
    [initialUsers, includeInactive],
  )
  const inactiveCount = initialUsers.filter((u) => u.archivedAt).length

  const resetForm = () => {
    setMode({ kind: 'idle' })
    setSelectedRoleIds(new Set())
    setSelectedGerenciaId('')
  }

  const openCreate = () => {
    setMode({ kind: 'create' })
    setSelectedRoleIds(new Set())
    setSelectedGerenciaId('')
  }

  const openEdit = (user: UserData) => {
    setMode({ kind: 'edit', user })
    setSelectedRoleIds(new Set(user.roles.map((r) => r.role.id)))
    setSelectedGerenciaId(user.gerenciaId ?? '')
  }

  const toggleRole = (roleId: string) => {
    setSelectedRoleIds((prev) => {
      const next = new Set(prev)
      if (next.has(roleId)) next.delete(roleId)
      else next.add(roleId)
      return next
    })
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (isGerenteAreaSelected && !selectedGerenciaId) {
      toast.error('Selecciona una gerencia para el Gerente de Área.')
      return
    }
    if (gerenciaBlocked) {
      toast.error('Esa gerencia ya tiene un Gerente activo. Revoca su rol primero.')
      return
    }

    const formData = new FormData(e.currentTarget)
    if (selectedGerenciaId) {
      formData.set('gerenciaId', selectedGerenciaId)
    }

    startTransition(async () => {
      try {
        if (mode.kind === 'edit') {
          formData.set('id', mode.user.id)
          await updateUser(formData)
          toast.success('Usuario actualizado correctamente')
        } else {
          await createUser(formData)
          toast.success('Usuario creado correctamente')
        }
        resetForm()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al guardar usuario'
        toast.error(msg)
      }
    })
  }

  const handleDeactivate = (user: UserData) => {
    if (!confirm(`¿Desactivar a ${user.name}? Conserva su historial pero no podrá iniciar sesión.`)) return
    const fd = new FormData()
    fd.set('id', user.id)
    startTransition(async () => {
      try {
        await deactivateUser(fd)
        toast.success(`${user.name} desactivado`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al desactivar'
        toast.error(msg)
      }
    })
  }

  const handleReactivate = (user: UserData) => {
    const fd = new FormData()
    fd.set('id', user.id)
    startTransition(async () => {
      try {
        await reactivateUser(fd)
        toast.success(`${user.name} reactivado`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error al reactivar'
        toast.error(msg)
      }
    })
  }

  const showForm = mode.kind !== 'idle'
  const formTitle = mode.kind === 'edit' ? `Editar usuario: ${mode.user.name}` : 'Nuevo Usuario'
  const submitLabel = mode.kind === 'edit' ? 'Guardar cambios' : 'Crear Usuario'

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserPlus className="h-6 w-6 text-primary" />
            Mantenimiento de Usuarios
          </h1>
          <p className="text-muted-foreground text-sm">
            Administra el acceso de los colaboradores y asigna sus perfiles de seguridad.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {inactiveCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="accent-primary"
              />
              Mostrar inactivos ({inactiveCount})
            </label>
          )}
          <button
            onClick={() => (showForm ? resetForm() : openCreate())}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-md"
          >
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {showForm ? 'Cancelar' : 'Nuevo Usuario'}
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="bg-card border border-primary/20 rounded-xl p-6 shadow-lg space-y-4 animate-in fade-in slide-in-from-top-4"
        >
          <h2 className="text-sm font-bold text-foreground">{formTitle}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Nombre Completo</label>
              <input
                name="name"
                required
                defaultValue={mode.kind === 'edit' ? mode.user.name : ''}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                placeholder="Ej. Juan Perez"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Correo Electrónico</label>
              <input
                name="email"
                type="email"
                required
                defaultValue={mode.kind === 'edit' ? mode.user.email : ''}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
                placeholder="juan@empresa.com"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Asignar Roles</label>
            <div className="flex flex-wrap gap-2">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    name="roleIds"
                    value={role.id}
                    checked={selectedRoleIds.has(role.id)}
                    onChange={() => toggleRole(role.id)}
                    className="accent-primary"
                  />
                  <span className="text-xs font-medium text-foreground">{role.name}</span>
                </label>
              ))}
            </div>
          </div>

          {isGerenteAreaSelected && (
            <div className="space-y-1.5 animate-in fade-in slide-in-from-top-2">
              <label className="text-xs font-bold text-muted-foreground uppercase flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                Gerencia a cargo
                <span className="text-red-400">*</span>
              </label>
              <select
                value={selectedGerenciaId}
                onChange={(e) => setSelectedGerenciaId(e.target.value)}
                required
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none"
              >
                <option value="">Selecciona la gerencia que va a dirigir…</option>
                {gerencias.map((g) => {
                  const isCurrentEditing =
                    mode.kind === 'edit' && g.currentManager?.id === mode.user.id
                  const disabled = !g.isAvailable && !isCurrentEditing
                  return (
                    <option key={g.id} value={g.id} disabled={disabled}>
                      {g.name}
                      {g.isAvailable
                        ? ' · disponible'
                        : isCurrentEditing
                          ? ' · gerencia actual'
                          : ` · ocupada por ${g.currentManager?.name ?? 'gerente actual'}`}
                    </option>
                  )
                })}
              </select>
              <p className="text-[11px] text-muted-foreground italic">
                Regla de negocio: solo puede existir <strong>un Gerente de Área activo</strong>{' '}
                por Gerencia.
              </p>
              {gerenciaBlocked && (
                <div className="flex items-start gap-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>
                    {selectedGerencia?.name} ya tiene un Gerente activo (
                    <strong>{selectedGerencia?.currentManager?.name}</strong>). Elige otra gerencia
                    o revoca primero el rol del gerente actual.
                  </span>
                </div>
              )}
            </div>
          )}

          <button
            disabled={isPending || gerenciaBlocked}
            className="w-full py-2 bg-primary text-primary-foreground font-bold rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {isPending ? 'Guardando…' : submitLabel}
          </button>
        </form>
      )}

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-muted/50 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border">
            <tr>
              <th className="px-6 py-4">Usuario</th>
              <th className="px-6 py-4">Roles · Gerencia</th>
              <th className="px-6 py-4">Estado</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredUsers.map((u) => {
              const inactive = !!u.archivedAt
              return (
                <tr
                  key={u.id}
                  className={`hover:bg-muted/20 transition-colors ${inactive ? 'opacity-50' : ''}`}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs border border-primary/20">
                        {u.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground">{u.name}</p>
                        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Mail className="h-2.5 w-2.5" /> {u.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {u.roles.map((r, i) => (
                        <span
                          key={i}
                          className="flex items-center gap-1 text-[10px] font-bold bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20"
                        >
                          <Shield className="h-2.5 w-2.5" />
                          {r.role.name}
                        </span>
                      ))}
                      {u.roles.length === 0 && (
                        <span className="text-[10px] text-muted-foreground italic">Sin roles</span>
                      )}
                      {u.gerencia && (
                        <span className="flex items-center gap-1 text-[10px] font-medium bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20">
                          <Building2 className="h-2.5 w-2.5" />
                          {u.gerencia.name}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {inactive ? (
                      <span className="text-[10px] font-bold bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded border border-rose-500/20">
                        INACTIVO
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20">
                        ACTIVO
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        title="Editar usuario"
                        className="p-2 text-muted-foreground hover:text-primary transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {inactive ? (
                        <button
                          onClick={() => handleReactivate(u)}
                          title="Reactivar usuario"
                          className="p-2 text-muted-foreground hover:text-emerald-400 transition-colors"
                        >
                          <UserCheck className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDeactivate(u)}
                          title="Dar de baja (soft delete)"
                          className="p-2 text-muted-foreground hover:text-rose-400 transition-colors"
                        >
                          <UserX className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filteredUsers.length === 0 && (
          <div className="text-center py-20 bg-muted/20">
            <User className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <p className="text-muted-foreground">
              {includeInactive
                ? 'No hay usuarios registrados.'
                : 'No hay usuarios activos. Marca "Mostrar inactivos" para ver los archivados.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
