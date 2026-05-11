/**
 * Wave P20-C · Brain Auto-Pilot — Página `/brain/auto-pilot`.
 *
 * Server component que gatea acceso (ADMIN/GERENCIA_GENERAL/SUPER_ADMIN) y
 * monta el cliente `AutoPilotClient`. Los datos se cargan en cliente para
 * permitir refrescos sin volver al servidor.
 */

import { redirect } from 'next/navigation'
import { Wand2 } from 'lucide-react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { ROLE_NAMES } from '@/lib/auth/permissions'
import { AutoPilotClient } from '@/components/brain/AutoPilotClient'

export const metadata = {
  title: 'Auto-Pilot · Brain · Sync',
  description:
    'Brain Auto-Pilot · propuestas de optimización aplicables con preview y rollback.',
}

const ALLOWED = new Set<string>([
  ROLE_NAMES.ADMIN,
  ROLE_NAMES.GERENCIA_GENERAL,
  ROLE_NAMES.SUPER_ADMIN,
])

function isAllowed(roles: readonly string[]): boolean {
  for (const r of roles) {
    if (ALLOWED.has(r)) return true
  }
  return false
}

export default async function BrainAutoPilotPage(): Promise<React.JSX.Element> {
  const user = await getCurrentUser()
  if (!user) {
    redirect('/login?next=/brain/auto-pilot')
  }
  if (!isAllowed(user.roles)) {
    redirect('/brain')
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8 bg-[#1e1b4b]/30">
        <div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-indigo-400" />
            Auto-Pilot
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Brain AI · propuestas accionables de optimización cross-project.
          </p>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-8 relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="mx-auto max-w-5xl relative z-10">
          <AutoPilotClient />
        </div>
      </div>
    </div>
  )
}
