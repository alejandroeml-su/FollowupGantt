import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import LoginForm from './login-form'
import OAuthButtons from '@/components/auth/OAuthButtons'
import { getServerT } from '@/lib/i18n/server'

/**
 * Página de inicio de sesión.
 *
 * Server component:
 *   - Si ya hay sesión, redirige al dashboard.
 *   - Si no, renderiza `<LoginForm/>` (client) con submit a server action.
 *
 * P3: incluye `<OAuthButtons/>` (SSO Google/Microsoft) y enlace a
 * `/auth/forgot-password`. Soporta `?reset=ok` y `?error=...` para
 * mostrar feedback tras flujos externos.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string; error?: string }>
}) {
  const user = await getCurrentUser()
  const params = await searchParams
  if (user) {
    redirect(params.next ?? '/')
  }

  const oauthError = params.error
  const resetSuccess = params.reset === 'ok'
  // Wave R5E (2026-05-17) — i18n bilingüe: el login es la primera
  // pantalla que ve el usuario, así que respetamos la cookie de locale
  // si existe; si no, el proxy ya la seteó vía Accept-Language.
  const t = await getServerT()

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          {t('auth.loginTitle')}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t('auth.loginSubtitle')}
        </p>

        {resetSuccess ? (
          <p
            data-testid="login-reset-success"
            role="status"
            className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
          >
            {t('auth.resetSuccess')}
          </p>
        ) : null}

        {oauthError ? (
          <p
            data-testid="login-oauth-error"
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {t('auth.oauthError', { error: oauthError })}
          </p>
        ) : null}

        <LoginForm />

        <div className="mt-3 text-right text-xs">
          <Link
            href="/auth/forgot-password"
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            {t('auth.forgotPasswordLink')}
          </Link>
        </div>

        <OAuthButtons />
      </div>
    </main>
  )
}
