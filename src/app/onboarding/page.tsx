/**
 * Equipo D3 · Onboarding · página `/onboarding`.
 *
 * Server component delgado: renderiza el client `OnboardingFlow` que
 * maneja el estado multi-step. Si el usuario ya tiene workspaces, se
 * redirige al dashboard (idempotencia: evitar onboarding accidental
 * en cuentas con datos existentes).
 */

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listMyWorkspaces } from '@/lib/actions/workspaces'
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow'

export const metadata = {
  title: 'Onboarding · FollowupGantt',
  description:
    'Configura tu workspace en 4 pasos: workspace, miembros, proyecto y primera tarea.',
}

export default async function OnboardingPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login')
  }

  let workspaceCount = 0
  try {
    const workspaces = await listMyWorkspaces()
    workspaceCount = workspaces.length
  } catch {
    workspaceCount = 0
  }

  if (workspaceCount > 0) {
    redirect('/')
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <OnboardingFlow />
    </div>
  )
}
