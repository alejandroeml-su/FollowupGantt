'use client'

import React, { useTransition } from 'react'
import { Plus, Shield, Trash2, CheckCircle2 } from 'lucide-react'
import { createRole, deleteRole } from '@/lib/actions'
import { toast } from '@/components/interactions/Toaster'

// permissions viene de Prisma como JsonValue (opaco) — no se parsea
// estrictamente en el cliente.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Role = {
  id: string
  name: string
  description: string | null
  permissions: any
}

type Props = {
  roles: Role[]
}

export default function RolesSettings({ roles }: Props) {
  const [isPending, startTransition] = useTransition()

  const handleSeed = () => {
    startTransition(async () => {
      try {
        const initial = [
          { name: 'SUPER_ADMIN', desc: 'Acceso total a todo el sistema', views: ['list', 'kanban', 'gantt', 'table', 'mindmaps', 'docs', 'forms', 'automations', 'dashboards', 'settings'] },
          { name: 'ADMIN', desc: 'Gestión de proyectos y usuarios', views: ['list', 'kanban', 'gantt', 'table', 'docs', 'forms'] },
          { name: 'AGENTE', desc: 'Ejecución de tareas asignadas', views: ['list', 'kanban', 'table'] },
        ]

        for (const r of initial) {
          if (!roles.find(x => x.name === r.name)) {
            const fd = new FormData()
            fd.set('name', r.name)
            fd.set('description', r.desc)
            fd.set('allowedViews', JSON.stringify(r.views))
            await createRole(fd)
          }
        }
        toast.success('Roles iniciales creados')
      } catch (err) {
        toast.error('Error al inicializar roles')
      }
    })
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Roles & Permisos
          </h1>
          <p className="text-muted-foreground text-sm">
            Define los perfiles del sistema y las vistas a las que tienen acceso.
          </p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleSeed}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-accent transition-colors"
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            Inicializar Roles Base
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-md">
            <Plus className="h-4 w-4" />
            Nuevo Rol
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {roles.map((role) => (
          <div key={role.id} className="bg-card border border-border rounded-xl p-6 shadow-sm flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-foreground">{role.name}</h3>
                {role.name === 'SUPER_ADMIN' && (
                  <span className="bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5 rounded border border-primary/20">SISTEMA</span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{role.description || 'Sin descripción'}</p>
              <div className="pt-3 flex flex-wrap gap-1.5">
                {role.permissions?.allowedViews?.map((view: string) => (
                  <span key={view} className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full border border-border/50">
                    {view}
                  </span>
                ))}
              </div>
            </div>
            <button 
              onClick={() => {
                const fd = new FormData()
                fd.set('id', role.id)
                startTransition(() => deleteRole(fd))
              }}
              className="p-2 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        {roles.length === 0 && (
          <div className="text-center py-20 bg-muted/20 rounded-xl border-2 border-dashed border-border">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <p className="text-muted-foreground">No hay roles definidos. Utiliza &laquo;Inicializar Roles Base&raquo; para empezar.</p>
          </div>
        )}
      </div>
    </div>
  )
}
