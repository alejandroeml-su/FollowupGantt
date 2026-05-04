/**
 * Ola P4 · Equipo P4-1 — Aceptación de invitación a workspace.
 *
 * Server component:
 *   - Lee el token de la URL.
 *   - Si no hay sesión, redirige a `/login?next=/invite/<token>`.
 *   - Carga la invitación + workspace y muestra preview.
 *   - El botón "Aceptar" llama a `acceptInvitation` y redirige a settings.
 *
 * Errores tipados se renderizan en pantalla con CTA volver al login.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ShieldAlert, CheckCircle2, Building2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import prisma from '@/lib/prisma'
import { AcceptInvitationButton } from './AcceptInvitationButton'

export const dynamic = 'force-dynamic'

type Params = Promise<{ token: string }>

export default async function AcceptInvitationPage({
  params,
}: {
  params: Params
}) {
  const { token } = await params
  if (!token) redirect('/')

  const user = await getCurrentUser()
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)
  }

  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token },
    include: {
      workspace: { select: { id: true, name: true, slug: true } },
    },
  })

  if (!invitation) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center space-y-3 shadow-lg">
          <ShieldAlert className="h-8 w-8 mx-auto text-destructive" />
          <h1 className="text-lg font-semibold text-foreground">
            Invitación no encontrada
          </h1>
          <p className="text-sm text-muted-foreground">
            La invitación no existe o ya fue usada.
          </p>
          <Link
            href="/"
            className="inline-block px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Volver al inicio
          </Link>
        </div>
      </main>
    )
  }

  // eslint-disable-next-line react-hooks/purity -- Server Component; cada request necesita comprobar expiración con la hora actual.
  const nowMs = Date.now()
  if (invitation.expiresAt.getTime() < nowMs) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center space-y-3 shadow-lg">
          <ShieldAlert className="h-8 w-8 mx-auto text-destructive" />
          <h1 className="text-lg font-semibold text-foreground">
            Invitación expirada
          </h1>
          <p className="text-sm text-muted-foreground">
            Pide al administrador del espacio que envíe una nueva invitación.
          </p>
          <Link
            href="/"
            className="inline-block px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Volver al inicio
          </Link>
        </div>
      </main>
    )
  }

  const emailMismatch = invitation.email !== user.email.toLowerCase()

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg space-y-5">
        <div className="text-center space-y-2">
          <Building2 className="h-8 w-8 mx-auto text-primary" />
          <h1 className="text-lg font-semibold text-foreground">
            Te han invitado a un espacio
          </h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {invitation.workspace.name}
            </span>{' '}
            te invita como{' '}
            <span className="font-medium text-foreground">
              {invitation.role === 'ADMIN' ? 'Admin' : 'Miembro'}
            </span>
            .
          </p>
        </div>

        <dl className="text-xs space-y-1 bg-muted/30 rounded-md p-3">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Slug</dt>
            <dd className="font-mono text-foreground">
              /{invitation.workspace.slug}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Invitado a</dt>
            <dd className="text-foreground">{invitation.email}</dd>
          </div>
        </dl>

        {emailMismatch ? (
          <div
            role="alert"
            className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2"
          >
            La invitación es para <strong>{invitation.email}</strong> pero tu
            sesión es de <strong>{user.email}</strong>. Cierra sesión y vuelve
            a entrar con la cuenta correcta.
          </div>
        ) : (
          <AcceptInvitationButton token={token} />
        )}

        <div className="text-center">
          <Link
            href="/"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </Link>
        </div>

        {emailMismatch && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Para aceptar esta invitación, primero cierra sesión y vuelve a
              iniciar con {invitation.email}.
            </span>
          </div>
        )}
      </div>
    </main>
  )
}
