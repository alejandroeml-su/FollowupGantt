import Link from 'next/link'
import {
  Building2,
  Layers,
  Shield,
  FileStack,
  Users,
  ArrowRight,
} from 'lucide-react'
import prisma from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth/check-super-admin'

export const dynamic = 'force-dynamic'

/**
 * Wave P17-C · Página índice del panel /admin. Muestra contadores
 * agregados y atajos a cada sub-módulo.
 */
export default async function AdminIndexPage() {
  await requireSuperAdmin({ path: '/admin' })

  const [
    workspaceCount,
    activeWorkspaceCount,
    gerenciaCount,
    areaCount,
    userCount,
    templateCount,
  ] = await Promise.all([
    prisma.workspace.count(),
    prisma.workspace.count({ where: { archivedAt: null } }),
    prisma.gerencia.count(),
    prisma.area.count(),
    prisma.user.count(),
    prisma.globalTemplate.count(),
  ])

  const cards = [
    {
      href: '/admin/workspaces',
      label: 'Workspaces',
      icon: Building2,
      value: `${activeWorkspaceCount}/${workspaceCount}`,
      hint: `${activeWorkspaceCount} activos · ${workspaceCount - activeWorkspaceCount} archivados`,
      color: 'from-indigo-500/15 to-indigo-700/5 border-indigo-500/20',
      iconColor: 'text-indigo-400',
    },
    {
      href: '/admin/gerencias',
      label: 'Gerencias & Áreas',
      icon: Layers,
      value: `${gerenciaCount} / ${areaCount}`,
      hint: `${gerenciaCount} gerencias · ${areaCount} áreas`,
      color: 'from-emerald-500/15 to-emerald-700/5 border-emerald-500/20',
      iconColor: 'text-emerald-400',
    },
    {
      href: '/admin/roles',
      label: 'Roles & Permisos',
      icon: Shield,
      value: `${userCount}`,
      hint: 'Usuarios totales · 5 roles',
      color: 'from-amber-500/15 to-amber-700/5 border-amber-500/20',
      iconColor: 'text-amber-400',
    },
    {
      href: '/admin/templates',
      label: 'Plantillas globales',
      icon: FileStack,
      value: `${templateCount}`,
      hint: 'Catálogo central',
      color: 'from-cyan-500/15 to-cyan-700/5 border-cyan-500/20',
      iconColor: 'text-cyan-400',
    },
  ]

  return (
    <div className="p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Panel de Administración
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configuración global del sistema. Solo visible para SUPER_ADMIN.
        </p>
      </header>

      <section
        aria-label="Resumen de configuración"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
        {cards.map((c) => {
          const Icon = c.icon
          return (
            <Link
              key={c.href}
              href={c.href}
              className={`group block rounded-2xl border bg-gradient-to-br p-5 transition-all hover:-translate-y-0.5 hover:shadow-lg ${c.color}`}
            >
              <div className="flex items-start justify-between">
                <Icon className={`h-7 w-7 ${c.iconColor}`} />
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-4">
                <div className="text-2xl font-bold text-foreground">
                  {c.value}
                </div>
                <div className="mt-1 text-sm font-medium text-foreground/90">
                  {c.label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {c.hint}
                </div>
              </div>
            </Link>
          )
        })}
      </section>

      <section className="mt-10 rounded-2xl border border-border bg-card/40 p-6">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Self-service para nuevas gerencias
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Este panel reduce la dependencia técnica para onboarding:
              cualquier SUPER_ADMIN puede crear workspaces, áreas, ajustar
              roles y publicar plantillas globales sin intervenir base de
              datos. Toda acción queda registrada en la auditoría
              (<code className="rounded bg-subtle px-1 py-0.5 text-xs">/audit-log</code>).
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
