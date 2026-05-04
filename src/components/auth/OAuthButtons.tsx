/**
 * Botones de SSO Google / Microsoft (Ola P3 · Auth).
 *
 * Server component (no interactividad de cliente — son `<a>` que
 * navegan al endpoint `/api/auth/oauth/<provider>` que arranca el
 * flujo OAuth).
 *
 * Visibilidad condicionada por env vars: si el provider no tiene
 * client_id configurado, el botón no se renderiza. Esto evita mostrar
 * un botón roto en self-hosting sin SSO.
 */
export default function OAuthButtons() {
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID)
  const microsoftEnabled = Boolean(process.env.MICROSOFT_CLIENT_ID)

  if (!googleEnabled && !microsoftEnabled) return null

  return (
    <div className="space-y-2">
      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-card px-2 text-muted-foreground">
            o continúa con
          </span>
        </div>
      </div>

      {/*
        Los hrefs apuntan a /api/auth/oauth/<provider> (route handlers
        que redirigen), no a pages. `<Link>` haría client-side nav y
        rompería la cookie set en el server, por eso usamos <a>.
      */}
      {/* eslint-disable @next/next/no-html-link-for-pages */}
      {googleEnabled ? (
        <a
          href="/api/auth/oauth/google"
          data-testid="oauth-google"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/40"
        >
          <GoogleIcon className="h-4 w-4" />
          Continuar con Google
        </a>
      ) : null}

      {microsoftEnabled ? (
        <a
          href="/api/auth/oauth/microsoft"
          data-testid="oauth-microsoft"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/40"
        >
          <MicrosoftIcon className="h-4 w-4" />
          Continuar con Microsoft
        </a>
      ) : null}
      {/* eslint-enable @next/next/no-html-link-for-pages */}
    </div>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.56c2.08-1.92 3.28-4.74 3.28-8.1Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.99.66-2.25 1.05-3.72 1.05-2.86 0-5.28-1.93-6.15-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.85 14.09a6.62 6.62 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.67-2.84Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.07.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.67 2.84C6.72 7.31 9.14 5.38 12 5.38Z"
        fill="#EA4335"
      />
    </svg>
  )
}

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M11.4 11.4H1V1h10.4v10.4Z" fill="#F25022" />
      <path d="M23 11.4H12.6V1H23v10.4Z" fill="#7FBA00" />
      <path d="M11.4 23H1V12.6h10.4V23Z" fill="#00A4EF" />
      <path d="M23 23H12.6V12.6H23V23Z" fill="#FFB900" />
    </svg>
  )
}
