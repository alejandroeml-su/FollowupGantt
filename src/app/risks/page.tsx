/**
 * Wave P8 · Equipo P8-2 — Página /risks: Risk Register + Monte Carlo.
 *
 * Server component: precarga risks (filtrados opcionalmente por
 * `?projectId=`), users y projects, y delega la UI al client board.
 *
 * URL params:
 *   - `projectId` (opcional): filtra el register y define qué proyecto
 *     se simula con Monte Carlo. Si está ausente y hay un único
 *     proyecto, lo usa. Si hay varios, requiere selección explícita
 *     para correr la sim (mostrar error en el board).
 */

import { ShieldAlert } from 'lucide-react'
import prisma from '@/lib/prisma'
import { getRisksForProjectPaginated } from '@/lib/actions/risks'
import { RiskRegisterBoard } from '@/components/risks/RiskRegisterBoard'

export const dynamic = 'force-dynamic'

type SP = Promise<{ projectId?: string }>

// P17-A · página de riesgos ahora usa pagination cursor-based.
// La carga inicial trae 50 riesgos; el botón "Cargar más" del board
// lleva el cursor al siguiente request server-side.
const INITIAL_RISKS_LIMIT = 50

export default async function RisksPage({
  searchParams,
}: {
  searchParams: SP
}) {
  const sp = await searchParams
  const projectId = sp.projectId ?? null

  const [page, users, projects] = await Promise.all([
    getRisksForProjectPaginated({ projectId, limit: INITIAL_RISKS_LIMIT }),
    prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.project.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ])

  // Si no hay projectId explícito y hay sólo un proyecto, lo seleccionamos
  // por defecto para que el botón "Correr Monte Carlo" tenga contexto.
  const defaultProjectId =
    projectId ?? (projects.length === 1 ? projects[0].id : null)

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 lg:p-6">
      <header className="flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-primary" aria-hidden />
        <h1 className="text-lg font-semibold">Riesgos del proyecto</h1>
      </header>
      <p className="text-xs text-muted-foreground">
        Registro de riesgos PMBOK §11. Probabilidad × Impacto define la
        severidad. La simulación Monte Carlo proyecta la duración del
        proyecto considerando los delays potenciales de los riesgos
        abiertos.
      </p>

      <RiskRegisterBoard
        risks={page.rows}
        initialNextCursor={page.nextCursor}
        projects={projects}
        users={users}
        defaultProjectId={defaultProjectId}
        scopeProjectId={projectId}
      />
    </main>
  )
}
