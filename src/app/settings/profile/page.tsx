/**
 * Página `/settings/profile` · Wave P6 · Equipo B2.
 *
 * "Mi perfil" — server component que carga el usuario autenticado y
 * renderiza secciones de configuración personal:
 *   1. Notificaciones push (Web Push API + suscripción server-side).
 *   2. Placeholder para futuras configs (idioma, tema, avatar…).
 *
 * Si no hay sesión activa, mostramos un estado vacío que invita a
 * iniciar sesión — coherente con el resto de páginas /settings/* que no
 * redirigen agresivamente (el usuario puede tener bookmark sin login).
 */

import { getCurrentUser } from '@/lib/auth'
import { ProfilePushSection } from '@/components/profile/ProfilePushSection'
import { RestartTourButton } from '@/components/onboarding/RestartTourButton'
import { getServerT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
  const user = await getCurrentUser()
  const t = await getServerT()

  return (
    <main
      data-testid="profile-page"
      className="mx-auto max-w-3xl px-6 py-10"
    >
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">{t('pages.profile.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('pages.profile.subtitle')}
        </p>
      </header>

      {user ? (
        <div className="space-y-6">
          <section
            data-testid="profile-identity-section"
            aria-labelledby="profile-identity-title"
            className="rounded-2xl border border-border bg-card p-6"
          >
            <h2
              id="profile-identity-title"
              className="text-lg font-semibold text-foreground"
            >
              {t('pages.profile.identity')}
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('common.name')}
                </dt>
                <dd className="mt-1 text-foreground">{user.name || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t('common.email')}
                </dt>
                <dd className="mt-1 text-foreground">{user.email}</dd>
              </div>
            </dl>
          </section>

          <ProfilePushSection userId={user.id} />

          <section
            data-testid="profile-tour-section"
            aria-labelledby="profile-tour-title"
            className="rounded-2xl border border-border bg-card p-6"
          >
            <h2
              id="profile-tour-title"
              className="text-lg font-semibold text-foreground"
            >
              {t('pages.profile.tourTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('pages.profile.tourBody')}
            </p>
            <div className="mt-4">
              <RestartTourButton />
            </div>
          </section>

          <section
            data-testid="profile-future-section"
            aria-labelledby="profile-future-title"
            className="rounded-2xl border border-dashed border-border bg-card/50 p-6"
          >
            <h2
              id="profile-future-title"
              className="text-lg font-semibold text-muted-foreground"
            >
              {t('pages.profile.futureTitle')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Aquí podrás configurar idioma, zona horaria, tema visual y
              avatar. Por ahora estos ajustes están centralizados en el
              footer del Sidebar.
            </p>
          </section>
        </div>
      ) : (
        <div
          data-testid="profile-empty-state"
          className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"
        >
          Inicia sesión para gestionar tu perfil y las notificaciones push.
        </div>
      )}
    </main>
  )
}
