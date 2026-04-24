'use client'

import React, { useTransition, useState } from 'react'
import { Plus, User, Trash2, Shield, UserPlus, Mail, Fingerprint } from 'lucide-react'
import { createUser, deleteUser } from '@/lib/actions'
import { toast } from '@/components/interactions/Toaster'

type UserData = {
  id: string
  name: string
  email: string
  roles: { role: { name: string } }[]
}

type Role = {
  id: string
  name: string
}

type Props = {
  initialUsers: UserData[]
  roles: Role[]
}

export default function UsersSettings({ initialUsers, roles }: Props) {
  const [isPending, startTransition] = useTransition()
  const [showAdd, setShowAdd] = useState(false)

  const handleAdd = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await createUser(formData)
        toast.success('Usuario creado correctamente')
        setShowAdd(false)
      } catch (err) {
        toast.error('Error al crear usuario')
      }
    })
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserPlus className="h-6 w-6 text-primary" />
            Mantenimiento de Usuarios
          </h1>
          <p className="text-muted-foreground text-sm">
            Administra el acceso de los colaboradores y asigna sus perfiles de seguridad.
          </p>
        </div>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-md"
        >
          <Plus className="h-4 w-4" />
          {showAdd ? 'Cancelar' : 'Nuevo Usuario'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-card border border-primary/20 rounded-xl p-6 shadow-lg space-y-4 animate-in fade-in slide-in-from-top-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Nombre Completo</label>
              <input name="name" required className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="Ej. Juan Perez" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground uppercase">Correo Electrónico</label>
              <input name="email" type="email" required className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary outline-none" placeholder="juan@empresa.com" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground uppercase">Asignar Roles</label>
            <div className="flex flex-wrap gap-2">
              {roles.map(role => (
                <label key={role.id} className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 cursor-pointer transition-colors">
                  <input type="checkbox" name="roleIds" value={role.id} className="accent-primary" />
                  <span className="text-xs font-medium text-foreground">{role.name}</span>
                </label>
              ))}
            </div>
          </div>
          <button disabled={isPending} className="w-full py-2 bg-primary text-primary-foreground font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-all">
            {isPending ? 'Guardando...' : 'Guardar Usuario'}
          </button>
        </form>
      )}

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-muted/50 text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border">
            <tr>
              <th className="px-6 py-4">Usuario</th>
              <th className="px-6 py-4">Roles Asignados</th>
              <th className="px-6 py-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {initialUsers.map((u) => (
              <tr key={u.id} className="hover:bg-muted/20 transition-colors">
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
                  <div className="flex flex-wrap gap-1.5">
                    {u.roles.map((r, i) => (
                      <span key={i} className="flex items-center gap-1 text-[10px] font-bold bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/20">
                        <Shield className="h-2.5 w-2.5" />
                        {r.role.name}
                      </span>
                    ))}
                    {u.roles.length === 0 && <span className="text-[10px] text-muted-foreground italic">Sin roles</span>}
                  </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button className="p-2 text-muted-foreground hover:text-primary transition-colors">
                      <Fingerprint className="h-4 w-4" />
                    </button>
                    <button 
                      onClick={() => {
                        const fd = new FormData()
                        fd.set('id', u.id)
                        startTransition(() => deleteUser(fd))
                      }}
                      className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {initialUsers.length === 0 && (
          <div className="text-center py-20 bg-muted/20">
            <User className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <p className="text-muted-foreground">No hay usuarios registrados.</p>
          </div>
        )}
      </div>
    </div>
  )
}
