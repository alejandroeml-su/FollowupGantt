/**
 * Wave P20-A · Pagina `/settings/notifications` (placeholder).
 *
 * Hub dedicado a configurar canales de notificacion: push (PWA),
 * realtime in-app y email. Hoy solo expone el toggle de push (que
 * tambien vive en `/settings/profile` para perfil), pero esta pagina
 * es el destino "oficial" del CTA "Activar notificaciones" del banner
 * de instalacion PWA y del menu de usuario.
 *
 * Server component: lee el usuario actual y delega la UI a
 * `NotificationsSettingsClient` (que monta el boton de subscribe via
 * `subscribeUserToPush` desde `src/lib/pwa/push-subscribe.ts`).
 */

import { getCurrentUser } from "@/lib/auth";
import { NotificationsSettingsClient } from "@/components/pwa/NotificationsSettingsClient";

export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
  const user = await getCurrentUser();

  return (
    <main
      data-testid="settings-notifications-page"
      className="mx-auto max-w-3xl px-6 py-10"
    >
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Notificaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura como Sync te avisa de cambios importantes: push en el
          dispositivo, realtime en la pestana abierta y resumenes por correo.
        </p>
      </header>

      {user ? (
        <NotificationsSettingsClient userId={user.id} />
      ) : (
        <section
          aria-label="Sesion requerida"
          className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"
        >
          Inicia sesion para configurar tus notificaciones.
        </section>
      )}
    </main>
  );
}
