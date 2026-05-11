"use client";

/**
 * Wave P20-A · Helper imperativo para suscribir al usuario a Web Push.
 *
 * Expone una funcion `subscribeUserToPush(userId)` que encapsula el
 * flow completo:
 *   1. Detecta soporte (Notification + serviceWorker + PushManager).
 *   2. Solicita permiso de notificaciones si no esta concedido.
 *   3. Espera el `serviceWorker.ready` (registro hecho por
 *      `register-sw.ts` o el legacy `ServiceWorkerRegistrar`).
 *   4. Llama `pushManager.subscribe` con la VAPID public key
 *      (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`).
 *   5. Persiste la subscription via la server action
 *      `subscribeToPush` ya existente (Wave P6 · A4).
 *
 * El hook `useWebPush` en `src/lib/realtime-notifications/use-web-push.ts`
 * sigue siendo la API recomendada para componentes reactivos. Este
 * helper imperativo cubre el caso "boton de un click en settings" sin
 * tener que montar un hook.
 *
 * Errores tipados (lanzados como `Error` con prefijo `[CODE]`):
 *   - `[UNSUPPORTED]`  navegador sin Web Push.
 *   - `[PERMISSION_DENIED]`  el usuario rechazo el prompt.
 *   - `[NO_SW]`  el SW no se registro.
 *   - `[NO_VAPID]`  falta `NEXT_PUBLIC_VAPID_PUBLIC_KEY` en build.
 */

import {
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/actions/push-subscriptions";

export type SubscribeUserResult = {
  endpoint: string;
  subscriptionId: string;
};

/**
 * Convierte una VAPID public key (base64url) a `Uint8Array` — formato
 * que `pushManager.subscribe` requiere en `applicationServerKey`.
 */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw =
    typeof atob === "function"
      ? atob(base64)
      : Buffer.from(base64, "base64").toString("binary");
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

function detectSupport(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

async function ensurePermission(): Promise<NotificationPermission> {
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return await Notification.requestPermission();
}

/**
 * Suscribe al usuario actual a Web Push. Si ya existe una suscripcion
 * activa en este browser, la reutiliza (idempotente). Persiste server-
 * side via `subscribeToPush`.
 */
export async function subscribeUserToPush(
  userId?: string | null,
): Promise<SubscribeUserResult> {
  if (!detectSupport()) {
    throw new Error("[UNSUPPORTED] Web Push no soportado en este navegador");
  }

  const perm = await ensurePermission();
  if (perm !== "granted") {
    throw new Error("[PERMISSION_DENIED] El usuario rechazo el permiso");
  }

  const reg = await navigator.serviceWorker.ready;
  if (!reg) throw new Error("[NO_SW] Service Worker no disponible");

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  if (!vapidKey) {
    throw new Error(
      "[NO_VAPID] Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY (configurar VAPID keys)",
    );
  }

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey)
        .buffer as ArrayBuffer,
    }));

  const json = sub.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error(
      "[INVALID_INPUT] PushSubscription generada sin endpoint o keys",
    );
  }

  const ua =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : null;

  const persisted = await subscribeToPush({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: ua,
    userId: userId ?? null,
  });

  return { endpoint: persisted.endpoint, subscriptionId: persisted.id };
}

/**
 * Desuscribe al usuario en este browser. Idempotente: si no hay
 * suscripcion local, no hace nada.
 */
export async function unsubscribeUserFromPush(
  userId?: string | null,
): Promise<{ removed: boolean }> {
  if (!detectSupport()) return { removed: false };

  const reg = await navigator.serviceWorker.ready;
  if (!reg) return { removed: false };

  const existing = await reg.pushManager.getSubscription();
  if (!existing) return { removed: false };

  const endpoint = existing.endpoint;
  try {
    await existing.unsubscribe();
  } catch (err) {
    console.warn("[pwa/push-subscribe] unsubscribe local fallo", err);
  }
  try {
    await unsubscribeFromPush({ endpoint, userId: userId ?? null });
  } catch (err) {
    console.warn("[pwa/push-subscribe] unsubscribeFromPush server fallo", err);
  }
  return { removed: true };
}

/**
 * Estado actual sin disparar permisos. Util para gating de UI.
 */
export async function getPushSubscriptionStatus(): Promise<{
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  isSubscribed: boolean;
}> {
  if (!detectSupport()) {
    return { supported: false, permission: "unsupported", isSubscribed: false };
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg?.pushManager.getSubscription()) ?? null;
    return {
      supported: true,
      permission: Notification.permission,
      isSubscribed: !!sub,
    };
  } catch {
    return {
      supported: true,
      permission: Notification.permission,
      isSubscribed: false,
    };
  }
}
