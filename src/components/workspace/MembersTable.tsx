'use client'

/**
 * Ola P4 · Equipo P4-1 — Tabla de miembros del workspace + invitaciones
 * pendientes. Permite:
 *   - Eliminar miembro (excepto OWNER, bloqueado en server).
 *   - Abrir el diálogo de invitación.
 *
 * El padre (page server) hidrata los datos iniciales y refresca con
 * `router.refresh()` tras cada mutación; aquí mantenemos transiciones
 * locales para feedback inmediato (botones deshabilitados durante la
 * acción).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, ShieldCheck, UserPlus, Mail, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import type { WorkspaceRole } from '@prisma/client'
import { removeMember } from '@/lib/actions/workspaces'
import { MemberInviteDialog } from './MemberInviteDialog'

export type MemberRow = {
  userId: string
  name: string
  email: string
  role: WorkspaceRole
  isOwner: boolean
  joinedAt: Date | string
}

export type PendingInvitation = {
  id: string
  email: string
  role: WorkspaceRole
  expiresAt: Date | string
  inviteUrl: string
}

const roleLabel: Record<WorkspaceRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Miembro',
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function MembersTable({
  workspaceId,
  members,
  invitations,
  canManage,
}: {
  workspaceId: string
  members: MemberRow[]
  invitations: PendingInvitation[]
  canManage: boolean
}) {
  const router = useRouter()
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleRemove = (userId: string, name: string) => {
    if (!canManage) return
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`¿Eliminar a ${name} del espacio de trabajo?`)
    ) {
      return
    }
    setRemovingId(userId)
    setError(null)
    startTransition(async () => {
      try {
        await removeMember({ workspaceId, userId })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error eliminando miembro')
      } finally {
        setRemovingId(null)
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">
          Miembros del espacio
        </h2>
        {canManage && (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <UserPlus className="h-4 w-4" />
            Invitar miembro
          </button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2"
        >
          {error}
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Nombre</th>
              <th className="px-4 py-2 text-left font-semibold">Email</th>
              <th className="px-4 py-2 text-left font-semibold">Rol</th>
              <th className="px-4 py-2 text-left font-semibold">Desde</th>
              {canManage && <th className="px-4 py-2 text-right font-semibold">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {members.map((m) => (
              <tr key={m.userId} className="hover:bg-accent/20 transition-colors">
                <td className="px-4 py-2.5 font-medium text-foreground">{m.name}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{m.email}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold',
                      m.role === 'OWNER'
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                        : m.role === 'ADMIN'
                          ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {m.role === 'OWNER' && <ShieldCheck className="h-3 w-3" />}
                    {roleLabel[m.role]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">
                  {formatDate(m.joinedAt)}
                </td>
                {canManage && (
                  <td className="px-4 py-2.5 text-right">
                    {m.isOwner ? (
                      <span className="text-[11px] text-muted-foreground italic">
                        OWNER (no removible)
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRemove(m.userId, m.name)}
                        disabled={isPending && removingId === m.userId}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        aria-label={`Eliminar a ${m.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Eliminar
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="px-4 py-6 text-center text-muted-foreground text-sm">
                  No hay miembros todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && invitations.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            Invitaciones pendientes
          </h3>
          <div className="rounded-lg border border-border overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Email</th>
                  <th className="px-4 py-2 text-left font-semibold">Rol</th>
                  <th className="px-4 py-2 text-left font-semibold">Expira</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invitations.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-4 py-2 text-foreground">{inv.email}</td>
                    <td className="px-4 py-2 text-muted-foreground">{roleLabel[inv.role]}</td>
                    <td className="px-4 py-2 text-muted-foreground text-xs flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDate(inv.expiresAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MemberInviteDialog
        workspaceId={workspaceId}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={() => router.refresh()}
      />
    </div>
  )
}
