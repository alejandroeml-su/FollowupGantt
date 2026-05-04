/**
 * Ola P5 · Equipo P5-5 — Página landing pública en `/forms`.
 *
 * Esta ruta es PÚBLICA (excluida del proxy en P5). No expone listado de
 * formularios para evitar enumeración por bots; muestra mensaje neutral.
 * El listado real para administradores vive en `/settings/forms`.
 */

export const dynamic = 'force-dynamic'

export default function FormsLandingPage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-xl w-full rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold text-white">Formularios públicos</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Para acceder a un formulario, utiliza el enlace específico que recibiste
          (formato <code className="font-mono">/forms/&lt;slug&gt;</code>).
        </p>
        <p className="mt-4 text-xs text-muted-foreground/70">
          ¿Eres administrador? Gestiona formularios en{' '}
          <a className="text-indigo-400 hover:underline" href="/settings/forms">
            Configuración → Formularios
          </a>
          .
        </p>
      </div>
    </main>
  )
}
