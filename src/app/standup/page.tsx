/**
 * Ola P7 · Equipo P7-4 · Daily Standup — Ruta `/standup`.
 *
 * Server component. Carga:
 *   - Current user (vía `getCurrentUser`).
 *   - Lista de proyectos accesibles para el tab "Equipo".
 *   - Standup inicial del usuario (`generateUserStandup`).
 *
 * Si no hay sesión, redirige al login. Si no hay proyectos, muestra
 * solamente el tab "Mi standup".
 */

import { redirect } from 'next/navigation'
import prisma from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { hasAdminRole } from '@/lib/auth/permissions'
import { generateUserStandup } from '@/lib/actions/standup'
import { StandupView } from '@/components/standup/StandupView'

export const metadata = {
  title: 'Standup · FollowupGantt',
  description: 'Standup diario generado automáticamente.',
}

export const dynamic = 'force-dynamic'

export default async function StandupPage(): Promise<React.JSX.Element> {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login?next=/standup')
  }

  // Proyectos accesibles: admins ven todos; resto sólo los asignados.
  const projects = hasAdminRole(user.roles)
    ? await prisma.project.findMany({
        where: { status: { in: ['ACTIVE', 'PLANNING'] } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 50,
      })
    : await prisma.project.findMany({
        where: {
          status: { in: ['ACTIVE', 'PLANNING'] },
          assignments: { some: { userId: user.id } },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        take: 50,
      })

  const initial = await generateUserStandup({})

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <StandupView initial={initial} projects={projects} />
    </main>
  )
}
