import { Dices } from 'lucide-react'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth/get-current-user'
import { MonteCarloPlanner } from '@/components/brain/MonteCarloPlanner'

export const dynamic = 'force-dynamic'

/**
 * Wave P20-B · Brain Strategist · Monte Carlo Cross-Project page.
 *
 * Server Component que precarga el conteo de proyectos activos del
 * workspace del usuario para decidir el render del cliente (estado
 * vacío vs. planner activo). El cómputo real se dispara on-demand
 * desde el cliente via `runMonteCarloAcrossProjects`.
 */
export default async function MonteCarloPage() {
  const user = await requireUser()
  const workspaceId = user.workspaceId ?? null

  const activeProjectCount = await prisma.project.count({
    where: {
      OR: [{ status: 'ACTIVE' }, { status: 'PLANNING' }],
      ...(workspaceId ? { workspaceId } : { workspaceId: null }),
    },
  })

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-[#1e1b4b]/30 px-8">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
            <Dices className="h-5 w-5 text-violet-400" />
            Monte Carlo Cross-Project
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Simulación probabilística de cierre del portafolio · P10/P50/P90 · cross-deps.
          </p>
        </div>
      </header>
      <div className="relative flex-1 overflow-auto p-8">
        <div className="mx-auto flex h-full max-w-5xl flex-col">
          <MonteCarloPlanner activeProjectCount={activeProjectCount} />
        </div>
      </div>
    </div>
  )
}
