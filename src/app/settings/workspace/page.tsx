/**
 * Ola P4 · Equipo P4-1 — Página de configuración del espacio de trabajo.
 *
 * Server component:
 *   - Lista los workspaces del usuario (con role + memberCount).
 *   - Muestra el form para crear nuevos.
 *   - Linkea a `/settings/workspace/members` para el activo.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Building2, Users, ExternalLink, Crown } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import {
  listMyWorkspaces,
  getActiveWorkspaceId,
} from '@/lib/actions/workspaces'
import { CreateWorkspaceForm } from '@/components/workspace/CreateWorkspaceForm'

export const dynamic = 'force-dynamic'

export default async function WorkspaceSettingsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=/settings/workspace')

  const [workspaces, activeId] = await Promise.all([
    listMyWorkspaces(),
    getActiveWorkspaceId(),
  ])

  return (
    <div className="flex-1 bg-background overflow-auto custom-scrollbar">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            Espacios de trabajo
          </h1>
          <p className="text-sm text-muted-foreground">
            Administra los espacios donde organizas proyectos, plantillas y
            miembros.
          </p>
        </header>

        <CreateWorkspaceForm />

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            Mis espacios
          </h2>
          {workspaces.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
              Todavía no perteneces a ningún espacio. Crea uno para comenzar.
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Nombre</th>
                    <th className="px-4 py-2 text-left font-semibold">Slug</th>
                    <th className="px-4 py-2 text-left font-semibold">Plan</th>
                    <th className="px-4 py-2 text-left font-semibold">Rol</th>
                    <th className="px-4 py-2 text-left font-semibold">
                      Miembros
                    </th>
                    <th className="px-4 py-2 text-right font-semibold">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {workspaces.map((w) => (
                    <tr
                      key={w.id}
                      className={
                        w.id === activeId ? 'bg-primary/5' : 'hover:bg-accent/20'
                      }
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground flex items-center gap-2">
                        {w.isOwner && (
                          <Crown
                            className="h-3.5 w-3.5 text-amber-500"
                            aria-label="OWNER"
                          />
                        )}
                        {w.name}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {w.slug}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-muted text-foreground">
                          {w.plan}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {w.role}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {w.memberCount}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/settings/workspace/members?ws=${w.id}`}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Miembros
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
