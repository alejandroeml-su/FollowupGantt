/**
 * Ola P4 · Equipo P4-1 — Página de miembros del workspace activo.
 *
 * Server component que resuelve `?ws=<id>` (con fallback a la cookie
 * `x-active-workspace` o al primer WS del usuario) y renderiza la tabla
 * de miembros + invitaciones pendientes.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { hasAdminRole } from '@/lib/auth/permissions'
import { canAccessWorkspace } from '@/lib/auth/check-workspace-access'
import {
  getActiveWorkspaceId,
  listMyWorkspaces,
  listPendingInvitations,
  listWorkspaceMembers,
} from '@/lib/actions/workspaces'
import { MembersTable } from '@/components/workspace/MembersTable'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function WorkspaceMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/settings/workspace/members')

  const params = await searchParams
  const cookieWsId = await getActiveWorkspaceId()
  const myWorkspaces = await listMyWorkspaces()

  const targetId =
    params.ws ?? cookieWsId ?? myWorkspaces[0]?.id ?? null

  if (!targetId) {
    return (
      <div className="flex-1 bg-background overflow-auto custom-scrollbar">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
          <Link
            href="/settings/workspace"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Volver
          </Link>
          <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
            Crea un espacio de trabajo antes de invitar miembros.
          </div>
        </div>
      </div>
    )
  }

  const accessible = await canAccessWorkspace(targetId)
  if (!accessible) {
    redirect('/settings/workspace')
  }

  const [members, workspace] = await Promise.all([
    listWorkspaceMembers(targetId),
    prisma.workspace.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, slug: true, ownerId: true },
    }),
  ])

  // Invitaciones sólo accesibles a managers; getter ya hace el guard.
  const myMembership = myWorkspaces.find((w) => w.id === targetId)
  const isAdminGlobal = hasAdminRole(user.roles)
  const canManage =
    isAdminGlobal ||
    (myMembership && (myMembership.role === 'OWNER' || myMembership.role === 'ADMIN'))

  const invitations = canManage ? await listPendingInvitations(targetId) : []

  return (
    <div className="flex-1 bg-background overflow-auto custom-scrollbar">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <header className="space-y-1">
          <Link
            href="/settings/workspace"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Volver a espacios
          </Link>
          <h1 className="text-2xl font-bold text-foreground">
            {workspace?.name ?? 'Espacio'}
          </h1>
          <p className="text-xs text-muted-foreground font-mono">
            /{workspace?.slug ?? '—'}
          </p>
        </header>

        <MembersTable
          workspaceId={targetId}
          members={members}
          invitations={invitations}
          canManage={Boolean(canManage)}
        />
      </div>
    </div>
  )
}
