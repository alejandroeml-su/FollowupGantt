/**
 * R4 · US-7.2 Chat View — Index del Chat.
 *
 * Redirige al proyecto activo (heurística `pickActiveProjectId`, igual
 * que `/sprints` y `/agile/*`). Si no hay proyectos visibles, renderiza
 * un placeholder amable con CTA a `/projects`.
 *
 * Se evita acoplar a un selector de workspace porque el chat es
 * project-scoped y la barra lateral ya expone "Mis proyectos".
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MessageSquare, AlertTriangle } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { resolveProjectVisibility } from '@/lib/auth/visibility'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function ChatIndexPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login?returnTo=/chat')
  }
  const visibility = await resolveProjectVisibility(user)

  let projectId: string | null = null
  try {
    const project = await prisma.project.findFirst({
      where: {
        ...visibility.projectWhere,
        OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }],
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      select: { id: true },
    })
    projectId = project?.id ?? null
  } catch {
    // BD aún sin migrar — fallthrough al placeholder.
  }

  if (projectId) {
    redirect(`/chat/${projectId}`)
  }

  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header className="flex items-center gap-2">
        <MessageSquare className="h-6 w-6 text-primary" aria-hidden />
        <h1 className="text-2xl font-bold text-foreground">Chat</h1>
      </header>
      <div className="rounded-2xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 p-8 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-2">
            <p className="text-base font-semibold text-foreground">
              Sin proyectos disponibles
            </p>
            <p className="text-sm text-muted-foreground">
              No tienes proyectos visibles para chat. Crea o únete a uno desde{' '}
              <Link href="/projects" className="text-indigo-400 underline">
                /projects
              </Link>{' '}
              para abrir la conversación de equipo.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
