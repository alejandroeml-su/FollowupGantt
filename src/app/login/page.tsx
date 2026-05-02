import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import LoginForm from './login-form'

/**
 * Página de inicio de sesión (Ola P1 · Auth MVP).
 *
 * Server component:
 *   - Si ya hay sesión, redirige al dashboard.
 *   - Si no, renderiza `<LoginForm/>` (client) con submit a server action.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const user = await getCurrentUser()
  const params = await searchParams
  if (user) {
    redirect(params.next ?? '/')
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          Iniciar sesión
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Accede a tu espacio de trabajo de FollowupGantt.
        </p>
        <LoginForm />
      </div>
    </main>
  )
}
