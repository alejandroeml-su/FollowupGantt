'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateUserRole } from '@/lib/actions/admin'
import { ROLE_NAMES, type RoleName } from '@/lib/auth/permissions'

const ASSIGNABLE_ROLES: ReadonlyArray<RoleName> = [
  ROLE_NAMES.USER,
  ROLE_NAMES.GERENTE_AREA,
  ROLE_NAMES.GERENCIA_GENERAL,
  ROLE_NAMES.ADMIN,
  ROLE_NAMES.SUPER_ADMIN,
]

export type AdminUserRow = {
  id: string
  name: string
  email: string
  currentRole: string
  allRoles: string[]
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^\[[A-Z_]+\]\s*/, '')
  }
  return 'Error desconocido'
}

export function AdminRolesClient({
  initial,
}: {
  initial: AdminUserRow[]
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const handleChange = (user: AdminUserRow, newRole: RoleName) => {
    if (newRole === user.currentRole) return
    setError(null)
    setPendingId(user.id)
    startTransition(async () => {
      try {
        await updateUserRole({ userId: user.id, role: newRole })
        router.refresh()
      } catch (err) {
        setError(extractErrorMessage(err))
      } finally {
        setPendingId(null)
      }
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
        <table className="w-full text-sm">
          <thead className="bg-subtle/40">
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">Usuario</th>
              <th className="px-4 py-3 font-semibold">Email</th>
              <th className="px-4 py-3 font-semibold">Rol actual</th>
              <th className="px-4 py-3 font-semibold">Cambiar a</th>
            </tr>
          </thead>
          <tbody>
            {initial.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium text-foreground">
                  {u.name}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                  {u.email}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
                    {u.currentRole}
                  </span>
                  {u.allRoles.length > 1 && (
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      (+{u.allRoles.length - 1} legacy)
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={u.currentRole}
                    onChange={(e) =>
                      handleChange(u, e.target.value as RoleName)
                    }
                    disabled={pendingId === u.id}
                    aria-label={`Rol de ${u.name}`}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-amber-500 focus:outline-none disabled:opacity-50"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {initial.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  No hay usuarios registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
