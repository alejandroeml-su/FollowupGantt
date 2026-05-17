'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { requestPasswordResetAction } from './actions'
import { useTranslation } from '@/lib/i18n/use-translation'

/**
 * Página "Recuperar contraseña" (Ola P3 · Auth completo).
 *
 * Diseño:
 *   - Form simple email-only.
 *   - Al enviar, mostramos SIEMPRE el mismo mensaje genérico
 *     ("Si el email existe, recibirás un correo") para evitar email
 *     enumeration. La server action tampoco distingue.
 *   - Client component porque queremos pending state + mensaje sin
 *     redirect (no usamos useActionState aquí porque el flujo es
 *     stateless).
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      await requestPasswordResetAction(email)
      setSubmitted(true)
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-foreground">
          {t('auth.forgotTitle')}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {t('auth.forgotSubtitle')}
        </p>

        {submitted ? (
          <div
            data-testid="forgot-success"
            role="status"
            className="rounded-md border border-primary/30 bg-primary/10 px-3 py-3 text-sm text-foreground"
          >
            {t('auth.forgotSuccess')}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                {t('auth.emailLabel')}
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="forgot-email"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
                placeholder={t('auth.emailPlaceholder')}
              />
            </div>
            <button
              type="submit"
              disabled={pending || !email}
              data-testid="forgot-submit"
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? t('auth.forgotSending') : t('auth.forgotSubmit')}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <Link href="/login" className="hover:text-foreground hover:underline">
            {t('auth.backToLogin')}
          </Link>
        </p>
      </div>
    </main>
  )
}
