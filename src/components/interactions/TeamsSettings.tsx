'use client'

import React, { useTransition } from 'react'
import { Plus, Users, Trash2, UserPlus } from 'lucide-react'
import { createTeam } from '@/lib/actions'
import { toast } from '@/components/interactions/Toaster'

type Team = {
  id: string
  name: string
  description: string | null
  members: { user: { name: string, email: string } }[]
}

type Props = {
  teams: Team[]
}

export default function TeamsSettings({ teams }: Props) {
  const [isPending, startTransition] = useTransition()

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
        <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-all shadow-md">
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
                <button className="p-2 text-muted-foreground hover:text-primary transition-colors">
                  <UserPlus className="h-4 w-4" />
                </button>
                <button className="p-2 text-muted-foreground hover:text-destructive transition-colors">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                Miembros ({team.members.length})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {team.members.map((m, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg border border-border bg-background/50">
                    <div className="h-7 w-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold">
                      {m.user.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="overflow-hidden">
                      <p className="text-xs font-medium text-foreground truncate">{m.user.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{m.user.email}</p>
                    </div>
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
    </div>
  )
}
