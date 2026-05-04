import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth'
import LoginForm from './login-form'
import OAuthButtons from '@/components/auth/OAuthButtons'

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          Iniciar sesión
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Accede a tu espacio de trabajo de FollowupGantt.
        </p>

        {resetSuccess ? (
          <p
            data-testid="login-reset-success"
            role="status"
            className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300"
          >
            Contraseña actualizada. Inicia sesión con tu nueva contraseña.
          </p>
        ) : null}

        {oauthError ? (
          <p
            data-testid="login-oauth-error"
            role="alert"
            className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            No se pudo completar el inicio de sesión externo
            ({oauthError}). Intenta de nuevo.
          </p>
        ) : null}

        <LoginForm />

        <div className="mt-3 text-right text-xs">
          <Link
            href="/auth/forgot-password"
            className="text-muted-foreground hover:text-foreground hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        <OAuthButtons />
      </div>
    </main>
  )
}
