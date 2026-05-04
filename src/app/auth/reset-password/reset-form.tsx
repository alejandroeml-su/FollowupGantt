'use client'

import { useActionState } from 'react'
import { confirmResetAction, type ConfirmResetState } from './actions'

/**
 * Form cliente para confirmar reset de contraseña. Usa
 * `useActionState` para coordinar pending + errores de la server
 * action.
 */
export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<
    ConfirmResetState,
    FormData
  >(confirmResetAction, undefined)

  const error = state && !state.ok ? state.error : undefined

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="token" value={token} />
      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Nueva contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          data-testid="reset-password"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
        />
      </div>
      <div>
        <label
          htmlFor="confirm"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Confirmar contraseña
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          data-testid="reset-confirm"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
        />
      </div>
      {error ? (
        <p
          data-testid="reset-error"
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        data-testid="reset-submit"
        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Guardando…' : 'Cambiar contraseña'}
      </button>
    </form>
  )
}
