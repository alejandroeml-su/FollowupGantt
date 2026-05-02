'use client'

import { useActionState } from 'react'
import { loginAction, type LoginActionState } from '@/lib/auth/actions'

/**
 * Formulario de login (Ola P1 · Auth MVP).
 *
 * Usa `useActionState` (React 19) — el helper recomendado por la doc
 * Next 16 para coordinar pending state + errores con server actions.
 *
 * NOTA: el server action `loginAction` lanza `redirect('/')` cuando las
 * credenciales son válidas, por lo que el render solo se vuelve a
 * ejecutar si hubo error. Por eso no manejamos un estado `ok=true`.
 */
export default function LoginForm() {
  const [state, formAction, pending] = useActionState<
    LoginActionState,
    FormData
  >(loginAction, undefined)

  const error = state && !state.ok ? state.error : undefined

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          data-testid="login-email"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
          placeholder="tu@empresa.com"
        />
      </div>
      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          data-testid="login-password"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
        />
      </div>
      {error ? (
        <p
          data-testid="login-error"
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        data-testid="login-submit"
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Iniciando…' : 'Iniciar sesión'}
      </button>
    </form>
  )
}
