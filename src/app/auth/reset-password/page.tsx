import { redirect } from 'next/navigation'
import ResetPasswordForm from './reset-form'
import { getServerT } from '@/lib/i18n/server'

/**
 * Página de confirmación del reset (Ola P3 · Auth completo).
 *
 * Recibe `?token=<raw>` en la URL. El server component sólo valida que
 * el token exista (no que sea válido — eso lo hace la server action al
 * confirmar). Si falta, redirige a `/auth/forgot-password`.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams
  const token = params.token?.trim()
  if (!token) {
    redirect('/auth/forgot-password')
  }

  const t = await getServerT()

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          {t('auth.resetTitle')}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t('auth.resetSubtitle')}
        </p>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  )
}
