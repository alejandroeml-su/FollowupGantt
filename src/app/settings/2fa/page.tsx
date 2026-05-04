import { redirect } from 'next/navigation'
import { requireUser } from '@/lib/auth/get-current-user'
import { isSuperAdmin } from '@/lib/auth/permissions'
import prisma from '@/lib/prisma'
import { TOTPSetupDialog } from '@/components/auth/TOTPSetupDialog'
import { disableTwoFactorAction } from './actions'

/**
 * Página "Verificación en dos pasos" (Ola P3 · Auth).
 *
 * Sólo visible para SUPER_ADMIN — el alcance del MVP. Cuando el RBAC
 * crezca, se evalúa habilitar 2FA para ADMIN/AGENTE bajo política.
 */
export const dynamic = 'force-dynamic'

export default async function TwoFactorSettingsPage() {
  const user = await requireUser()
  if (!isSuperAdmin(user.roles)) {
    redirect('/')
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { twoFactorSecret: true, email: true },
  })

  const enabled = Boolean(dbUser?.twoFactorSecret)

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-2 text-2xl font-bold text-foreground">
        Verificación en dos pasos
      </h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Añade una capa extra de seguridad a tu cuenta usando una app
        autenticadora compatible con TOTP (Google Authenticator,
        Microsoft Authenticator, Authy, 1Password).
      </p>

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Estado actual
            </h2>
            <p className="text-sm text-muted-foreground">
              {enabled
                ? '2FA está habilitado en tu cuenta.'
                : '2FA está deshabilitado.'}
            </p>
          </div>
          <span
            data-testid="twofa-status"
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              enabled
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            }`}
          >
            {enabled ? 'Activo' : 'Inactivo'}
          </span>
        </div>

        {enabled ? (
          <form action={disableTwoFactorAction}>
            <button
              type="submit"
              data-testid="twofa-disable"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm font-semibold text-destructive hover:bg-destructive/20"
            >
              Deshabilitar 2FA
            </button>
          </form>
        ) : (
          <TOTPSetupDialog accountEmail={dbUser?.email ?? user.email} />
        )}
      </section>
    </main>
  )
}
