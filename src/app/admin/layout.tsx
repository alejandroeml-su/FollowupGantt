import { headers } from 'next/headers'
import { requireSuperAdmin } from '@/lib/auth/check-super-admin'
import { AdminSidebar } from '@/components/admin/AdminSidebar'
import { ShieldCheck } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Wave P17-C · Self-Service Admin — Layout root del panel `/admin/**`.
 *
 * - Guard server-side `requireSuperAdmin` redirige a `/` si no aplica
 *   (el redirect emite un audit `access.denied`).
 * - Header con badge "ADMIN MODE" para clarificar el contexto.
 * - Sidebar lateral propio (Workspaces / Gerencias / Áreas / Roles /
 *   Plantillas) — independiente del Sidebar principal de la app.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const h = await headers()
  const pathname = h.get('x-pathname') ?? '/admin'
  const user = await requireSuperAdmin({ path: pathname })

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* ── ADMIN MODE banner ───────────────────────────────────── */}
      <header
        className="flex items-center justify-between border-b border-amber-500/30 bg-amber-500/10 px-6 py-3"
        role="banner"
      >
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-amber-400" />
          <span className="text-sm font-bold uppercase tracking-wider text-amber-300">
            ADMIN MODE
          </span>
          <span className="hidden text-xs text-amber-200/70 md:inline">
            · Configuración global del sistema (solo SUPER_ADMIN)
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Conectado como:</span>
          <span className="font-mono text-foreground/90">
            {user.email}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <AdminSidebar />
        <main className="flex-1 overflow-auto custom-scrollbar bg-background">
          {children}
        </main>
      </div>
    </div>
  )
}
