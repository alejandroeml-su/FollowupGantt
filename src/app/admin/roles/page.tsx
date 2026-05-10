import { Shield } from 'lucide-react'
import prisma from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/auth/check-super-admin'
import { ROLE_NAMES } from '@/lib/auth/permissions'
import { AdminRolesClient } from '@/components/admin/AdminRolesClient'

export const dynamic = 'force-dynamic'

/**
 * Wave P17-C · Roles & Permisos.
 *
 * Matriz read-only (visualiza permisos por rol según jerarquía P13)
 * + tabla de usuarios con dropdown para reasignar el rol activo.
 */

const ROLE_COLUMNS: ReadonlyArray<{
  key: keyof typeof ROLE_NAMES
  label: string
  description: string
}> = [
  {
    key: 'USER',
    label: 'USER',
    description: 'Acceso a proyectos donde es asignado o miembro de equipo',
  },
  {
    key: 'GERENTE_AREA',
    label: 'GERENTE_AREA',
    description: 'Visibilidad sobre todos los proyectos de su gerencia',
  },
  {
    key: 'GERENCIA_GENERAL',
    label: 'GERENCIA_GENERAL',
    description: 'Visibilidad sobre todos los proyectos del workspace activo',
  },
  {
    key: 'ADMIN',
    label: 'ADMIN',
    description: 'Visibilidad cross-workspace + gestión de configuración',
  },
  {
    key: 'SUPER_ADMIN',
    label: 'SUPER_ADMIN',
    description: 'Acceso completo (incluye este panel /admin)',
  },
]

const PERMISSIONS_MATRIX: ReadonlyArray<{
  permission: string
  description: string
  /** index alineado con ROLE_COLUMNS */
  values: ReadonlyArray<boolean>
}> = [
  {
    permission: 'Ver proyectos asignados',
    description: 'Tareas/proyectos donde el usuario es miembro o assignee',
    values: [true, true, true, true, true],
  },
  {
    permission: 'Ver proyectos de su gerencia',
    description: 'Sin necesidad de membresía explícita',
    values: [false, true, true, true, true],
  },
  {
    permission: 'Ver todos los proyectos del workspace',
    description: '"Todo el espacio" en la matriz P13',
    values: [false, false, true, true, true],
  },
  {
    permission: 'Ver proyectos cross-workspace',
    description: '"Otros espacios" — admin global',
    values: [false, false, false, true, true],
  },
  {
    permission: 'Editar tareas/proyectos asignados',
    description: 'Si está en el assignment del proyecto',
    values: [true, true, true, true, true],
  },
  {
    permission: 'Gestionar miembros del workspace',
    description: 'Invitar/eliminar miembros (OWNER/ADMIN del WS también)',
    values: [false, false, false, true, true],
  },
  {
    permission: 'Configurar el sistema',
    description: 'Roles, parámetros globales, plantillas',
    values: [false, false, false, false, true],
  },
  {
    permission: 'Acceder al panel /admin',
    description: 'Self-Service Admin (Wave P17-C)',
    values: [false, false, false, false, true],
  },
]

export default async function AdminRolesPage() {
  await requireSuperAdmin({ path: '/admin/roles' })

  const users = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      roles: { include: { role: { select: { name: true } } } },
    },
  })

  const initial = users.map((u) => {
    // Resolver el rol "principal": elegimos el de mayor jerarquía si tiene varios.
    const userRoleNames = u.roles.map((r) => r.role.name)
    const RANK: Record<string, number> = {
      [ROLE_NAMES.USER]: 1,
      [ROLE_NAMES.AGENTE]: 1,
      [ROLE_NAMES.GERENTE_AREA]: 2,
      [ROLE_NAMES.GERENCIA_GENERAL]: 3,
      [ROLE_NAMES.ADMIN]: 4,
      [ROLE_NAMES.SUPER_ADMIN]: 5,
    }
    const primary =
      userRoleNames
        .slice()
        .sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0] ??
      ROLE_NAMES.USER
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      currentRole: primary,
      allRoles: userRoleNames,
    }
  })

  return (
    <div className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Shield className="h-6 w-6 text-amber-400" />
          Roles & Permisos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Matriz de permisos (read-only) y asignación de roles a usuarios.
        </p>
      </header>

      <section
        aria-label="Matriz de permisos"
        className="mb-10 overflow-hidden rounded-2xl border border-border bg-card/40"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">
            Matriz de permisos
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Definición canónica del repo (`@/lib/auth/permissions.ts`). Esta
            tabla es informativa: para cambiar la lógica, edita ese archivo.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-subtle/40">
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="sticky left-0 bg-subtle/40 px-4 py-3 font-semibold">
                  Permiso
                </th>
                {ROLE_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className="px-3 py-3 text-center font-semibold"
                    title={c.description}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSIONS_MATRIX.map((row) => (
                <tr key={row.permission} className="border-t border-border">
                  <td className="sticky left-0 bg-card/40 px-4 py-3">
                    <div className="font-medium text-foreground">
                      {row.permission}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.description}
                    </div>
                  </td>
                  {row.values.map((v, idx) => (
                    <td
                      key={idx}
                      className="px-3 py-3 text-center"
                    >
                      {v ? (
                        <span
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300"
                          aria-label="Permitido"
                        >
                          ✓
                        </span>
                      ) : (
                        <span
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-zinc-500/15 text-zinc-500"
                          aria-label="No permitido"
                        >
                          ·
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Asignación de roles a usuarios">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Asignación de roles
            </h2>
            <p className="text-xs text-muted-foreground">
              {initial.length} usuario(s). Cambia el rol con el dropdown.
              SUPER_ADMIN no puede degradarse a sí mismo.
            </p>
          </div>
        </div>
        <AdminRolesClient initial={initial} />
      </section>
    </div>
  )
}
