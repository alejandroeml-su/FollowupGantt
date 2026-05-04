'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import {
  prepareTwoFactorAction,
  enableTwoFactorAction,
  type EnableTwoFactorState,
} from '@/app/settings/2fa/actions'

/**
 * Diálogo de setup TOTP (Ola P3 · Auth).
 *
 * Flujo:
 *   1. Usuario hace click en "Habilitar 2FA" → `prepareTwoFactorAction`
 *      genera un secret efímero + otpauth URI.
 *   2. Mostramos QR (vía Google Charts API — sin libs cliente) + el
 *      secret en texto plano (para entrada manual si la cámara falla).
 *   3. Usuario escanea, ingresa código de 6 dígitos →
 *      `enableTwoFactorAction(secret, code)` valida + persiste.
 *
 * El QR se renderiza vía `<img>` apuntando a la API de QR de
 * `api.qrserver.com` para no requerir librería cliente. Si Edwin
 * prefiere offline-only, se sustituye por SVG generado en server.
 */

interface PreparedSecret {
  secret: string
  otpAuthUrl: string
}

export function TOTPSetupDialog({ accountEmail }: { accountEmail: string }) {
  void accountEmail // visual-only — el server action ya lo conoce.
  const [prepared, setPrepared] = useState<PreparedSecret | null>(null)
  const [preparing, startPrepare] = useTransition()
  const [state, formAction, pending] = useActionState<
    EnableTwoFactorState,
    FormData
  >(enableTwoFactorAction, undefined)

  // Cuando la action termina con `ok: true`, refrescamos para que el
  // server component muestre el estado "Activo".
  useEffect(() => {
    if (state?.ok) {
      window.location.reload()
    }
  }, [state])

  function handlePrepare() {
    startPrepare(async () => {
      const result = await prepareTwoFactorAction()
      setPrepared(result)
    })
  }

  if (!prepared) {
    return (
      <button
        type="button"
        onClick={handlePrepare}
        disabled={preparing}
        data-testid="twofa-enable-start"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {preparing ? 'Generando…' : 'Habilitar 2FA'}
      </button>
    )
  }

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(prepared.otpAuthUrl)}`
  const error = state && !state.ok ? state.error : undefined

  return (
    <div data-testid="twofa-setup" className="space-y-4">
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="mb-3 text-sm text-foreground">
          Escanea este código QR con tu app autenticadora:
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- QR
            externo de un solo uso (no vale la pena pasar por next/image
            loader; tampoco está en el dominio de imágenes permitidas). */}
        <img
          src={qrUrl}
          alt="Código QR para configurar 2FA"
          width={200}
          height={200}
          className="mx-auto h-50 w-50 rounded-md border border-border bg-white p-2"
        />
        <p className="mt-3 text-center text-xs text-muted-foreground">
          ¿No puedes escanear? Ingresa este código manualmente:
        </p>
        <code
          data-testid="twofa-secret"
          className="mt-1 block break-all text-center font-mono text-xs text-foreground"
        >
          {prepared.secret}
        </code>
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="secret" value={prepared.secret} />
        <div>
          <label
            htmlFor="totp-code"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Código de verificación
          </label>
          <input
            id="totp-code"
            name="code"
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            autoComplete="one-time-code"
            data-testid="twofa-code"
            placeholder="123456"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-base tracking-widest text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
          />
        </div>
        {error ? (
          <p
            data-testid="twofa-error"
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          data-testid="twofa-confirm"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {pending ? 'Verificando…' : 'Verificar y activar'}
        </button>
      </form>
    </div>
  )
}
