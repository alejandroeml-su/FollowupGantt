/**
 * Equipo D3 · Dashboard ejecutivo unificado (server component).
 *
 * Reemplaza el dashboard minimalista previo con:
 *   - Carga paralela de portfolio + riesgos + hitos + next actions.
 *   - Empty state que enlaza a `/onboarding` cuando el usuario aún no
 *     tiene workspaces asociados.
 *   - Redirección automática a `/onboarding` cuando un usuario nuevo
 *     loguea por primera vez (sin proyectos visibles).
 *
 * Decisión D3-PAGE-1: si el caller NO está autenticado, NO bloqueamos
 * la página (mantener compatibilidad con el comportamiento anterior).
 * En ese caso usamos un nombre genérico y un fallback de empty state.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listMyWorkspaces } from '@/lib/actions/workspaces'
import {
  ExecutiveDashboard,
  loadExecutiveDashboard,
} from '@/components/dashboard/ExecutiveDashboard'

export default async function HomePage() {
  const user = await getCurrentUser()

  // Sin sesión: render mínimo con CTA al login (no hard-redirect para no
  // romper anonimous landing). El proxy aplica el gating de auth real.
  if (!user) {
    return <UnauthenticatedFallback />
  }

  // Si el usuario aún no pertenece a ningún workspace → onboarding.
  // listMyWorkspaces puede fallar si la sesión expira en el medio;
  // capturamos como UNAUTHORIZED y degradamos al fallback.
  let workspaceCount = 0
  try {
    const workspaces = await listMyWorkspaces()
    workspaceCount = workspaces.length
  } catch {
    workspaceCount = 0
  }

  if (workspaceCount === 0) {
    redirect('/onboarding')
  }

  const data = await loadExecutiveDashboard()

  // Empty state cuando hay workspace pero no proyectos ni datos cargados.
  if (data.portfolio.summary.totalProjects === 0) {
    return <NoProjectsEmptyState userName={user.name} />
  }

  return <ExecutiveDashboard userName={user.name} data={data} />
}

function UnauthenticatedFallback() {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-12 text-center">
      <h1 className="text-3xl font-black text-foreground">FollowupGantt</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        Inicia sesión para ver tu resumen ejecutivo.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Iniciar sesión
      </Link>
    </div>
  )
}

function NoProjectsEmptyState({ userName }: { userName: string }) {
  return (
    <div
      data-testid="dashboard-empty-state"
      className="flex h-full flex-col items-center justify-center bg-background p-12 text-center"
    >
      <h1 className="text-3xl font-black text-foreground">
        ¡Hola, {userName.split(' ')[0]}!
      </h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        Aún no tienes proyectos en este workspace. Empieza con el flujo
        guiado para crear tu primer proyecto y tu primera tarea.
      </p>
      <Link
        href="/onboarding"
        className="mt-6 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Iniciar onboarding
      </Link>
    </div>
  )
}
