/**
 * R4 · US-7.2 Chat View — Página del chat por proyecto.
 *
 * Server component que:
 *   1. Verifica sesión + visibilidad de proyecto (`assertCanViewProject`).
 *   2. Carga los canales iniciales vía `listChannels` (que bootstrappea
 *      `#general` si el proyecto aún no tiene canales).
 *   3. Renderiza `<ChatClient />` con los datos para hidratación.
 *
 * Errores de BD (tabla aún sin migrar) se atrapan y se muestra el banner
 * de setup, coherente con el patrón de `/whiteboards` y `/mindmaps`.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AlertTriangle, Database, MessageSquare } from 'lucide-react'
import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { canViewProject } from '@/lib/auth/visibility'
import { listChannels } from '@/lib/actions/chat'
import type { SerializedChatChannel } from '@/lib/chat/shared'
import { ChatClient } from '@/components/chat/ChatClient'

export const dynamic = 'force-dynamic'

type Params = Promise<{ projectId: string }>

export default async function ChatProjectPage({ params }: { params: Params }) {
  const { projectId } = await params

  const user = await getCurrentUser()
  if (!user) {
    redirect(`/login?returnTo=/chat/${projectId}`)
  }

  // RBAC: si el usuario no puede ver el proyecto, 404 (no leak de
  // existencia). `canViewProject` ya registra `access.denied` en audit log.
  const allowed = await canViewProject(user, projectId)
  if (!allowed) notFound()

  let project: { id: string; name: string } | null = null
  let channels: SerializedChatChannel[] = []
  let mentionableUsers: { id: string; name: string; email: string }[] = []

  try {
    project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    })
    if (!project) notFound()

    ;[channels, mentionableUsers] = await Promise.all([
      listChannels({ projectId }),
      prisma.user.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
        take: 200,
      }),
    ])
  } catch (err) {
    return (
      <SetupPending
        error={err instanceof Error ? err.message : 'Error desconocido'}
        projectId={projectId}
      />
    )
  }

  return (
    <ChatClient
      projectId={project.id}
      projectName={project.name}
      initialChannels={channels}
      currentUser={{ id: user.id, name: user.name }}
      mentionableUsers={mentionableUsers}
    />
  )
}

function SetupPending({
  error,
  projectId,
}: {
  error: string
  projectId: string
}) {
  const isMissingTable = /does not exist|relation .* does not exist|P2021|UNAUTHORIZED/i.test(error)
  return (
    <div className="p-8 space-y-6 max-w-3xl">
      <header className="flex items-center gap-2">
        <MessageSquare className="h-6 w-6 text-primary" aria-hidden />
        <h1 className="text-2xl font-bold text-foreground">Chat</h1>
      </header>

      <div className="rounded-2xl border-2 border-dashed border-amber-500/40 bg-amber-500/5 p-8 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-2">
            <p className="text-base font-semibold text-foreground">
              Módulo pendiente de configuración
            </p>
            <p className="text-sm text-muted-foreground">
              {isMissingTable ? (
                <>
                  Las tablas <code>ChatChannel</code>, <code>ChatMessage</code> y{' '}
                  <code>ChatMessageReaction</code> aún no existen en la base
                  de datos. Aplica la migración para habilitar el chat del
                  proyecto.
                </>
              ) : (
                <>
                  No se pudo conectar con la base de datos para cargar el
                  chat del proyecto <code>{projectId}</code>.
                </>
              )}
            </p>
          </div>
        </div>

        {isMissingTable && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-primary" aria-hidden />
              Para resolverlo (administrador)
            </p>
            <ol className="list-decimal pl-5 space-y-1 text-xs text-muted-foreground">
              <li>
                Aplicar la migración SQL en Supabase via MCP:
                <code className="ml-1 block bg-background border border-border rounded px-2 py-1 mt-1 text-foreground/90 font-mono">
                  docs/features/chat-view-migration.sql
                </code>
              </li>
              <li>Recargar esta página.</li>
            </ol>
          </div>
        )}

        <Link
          href="/projects"
          className="inline-block text-xs text-indigo-400 underline"
        >
          ← Volver a proyectos
        </Link>
      </div>
    </div>
  )
}
