"use client";

/**
 * Wave P20-A · Cliente de `/settings/notifications`.
 *
 * Expone un boton "Activar notificaciones" que llama
 * `subscribeUserToPush(userId)` (helper de `src/lib/pwa/push-subscribe.ts`).
 * Tambien permite desactivar la subscripcion vigente y muestra el
 * estado actual (soporte, permiso, suscrito).
 */

import { useCallback, useEffect, useState } from "react";
import {
  getPushSubscriptionStatus,
  subscribeUserToPush,
  unsubscribeUserFromPush,
} from "@/lib/pwa/push-subscribe";

export type NotificationsSettingsClientProps = {
  userId: string;
};

type Status = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  isSubscribed: boolean;
};

export function NotificationsSettingsClient({
  userId,
}: NotificationsSettingsClientProps) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await getPushSubscriptionStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    // refresh() sincroniza estado React con la API del navegador
    // (`pushManager.getSubscription`); el patron es subscribe-to-external.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const onEnable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await subscribeUserToPush(userId);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [refresh, userId]);

  const onDisable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeUserFromPush(userId);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setBusy(false);
    }
  }, [refresh, userId]);

  return (
    <section
      data-testid="notifications-settings-push-section"
      aria-labelledby="notifications-settings-push-title"
      className="rounded-2xl border border-border bg-card p-6"
    >
      <h2
        id="notifications-settings-push-title"
        className="text-lg font-semibold text-foreground"
      >
        Notificaciones push (PWA)
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Recibe alertas en el dispositivo cuando se te asignen tareas, mencionen
        en comentarios o cambie un baseline. Funciona incluso si Sync no esta
        abierto.
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt className="font-medium text-foreground">Soporte</dt>
          <dd>{status?.supported ? "Si" : status ? "No" : "Detectando…"}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Permiso</dt>
          <dd>{status?.permission ?? "Detectando…"}</dd>
        </div>
        <div>
          <dt className="font-medium text-foreground">Suscrito</dt>
          <dd>
            {status?.isSubscribed === undefined
              ? "Detectando…"
              : status.isSubscribed
                ? "Si"
                : "No"}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        {status?.isSubscribed ? (
          <button
            type="button"
            onClick={() => void onDisable()}
            disabled={busy}
            className="rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/70 disabled:opacity-50"
          >
            Desactivar notificaciones
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onEnable()}
            disabled={busy || !status?.supported}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
          >
            {busy ? "Procesando…" : "Activar notificaciones"}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {error}
        </p>
      )}

      {!status?.supported && status !== null && (
        <p className="mt-3 text-xs text-muted-foreground">
          Tu navegador no soporta Web Push. Considera instalar la PWA en un
          navegador compatible (Chrome, Edge, Firefox).
        </p>
      )}
    </section>
  );
}
