"use client";

/**
 * Wave R4-B · Bridge nativo Capacitor → server action `subscribeToPush`.
 *
 * Recibe el device token APNs/FCM emitido por `@capacitor/push-notifications`
 * y lo persiste con `kind: 'APNS' | 'FCM'` para que el dispatcher backend lo
 * routee al adapter correcto (Wave R4-B).
 *
 * Supera la versión transitoria de P21-A (que no enviaba al backend porque
 * el schema rechazaba tokens nativos). R4-B agregó `PushSubscriptionKind`
 * enum + `keys` nullable + dispatcher dual.
 *
 * Defensividad:
 *   - Si Capacitor NO está disponible (build web), todas las funciones son
 *     no-ops (resuelven `{ registered: false, reason: 'no-capacitor' }`).
 *   - El módulo Capacitor se importa dinámicamente para que el bundle web
 *     no lo arrastre.
 *
 * Detección de plataforma:
 *   - iOS  → kind APNS
 *   - Android → kind FCM
 *   - Otra (web, electron) → no-op.
 */

import { subscribeToPush } from "@/lib/actions/push-subscriptions";

export type PushBridgeRegisterResult =
  | { registered: true; kind: "APNS" | "FCM"; subscriptionId: string }
  | { registered: false; reason: string };

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function getCapacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap ?? null;
}

export function isCapacitorAvailable(): boolean {
  const cap = getCapacitor();
  return !!(cap?.isNativePlatform && cap.isNativePlatform());
}

export function detectMobileKind(): "APNS" | "FCM" | null {
  const cap = getCapacitor();
  if (!cap?.getPlatform) return null;
  const platform = cap.getPlatform();
  if (platform === "ios") return "APNS";
  if (platform === "android") return "FCM";
  return null;
}

/**
 * Suscribe el dispositivo nativo a push y persiste el token.
 *
 * Implementación lazy: importa `@capacitor/push-notifications` solo en
 * runtime nativo. En build web devuelve `{ registered: false }`.
 */
export async function registerMobilePush(
  userId?: string | null,
): Promise<PushBridgeRegisterResult> {
  if (!isCapacitorAvailable()) {
    return { registered: false, reason: "no-capacitor" };
  }

  const kind = detectMobileKind();
  if (!kind) {
    return { registered: false, reason: "unsupported-platform" };
  }

  type PushNotificationsApi = {
    requestPermissions: () => Promise<{ receive: string }>;
    register: () => Promise<void>;
    addListener: (
      ev: string,
      cb: (token: unknown) => void,
    ) => Promise<{ remove: () => Promise<void> | void } | unknown>;
  };

  let PushNotifications: PushNotificationsApi | null = null;

  try {
    // @ts-expect-error -- '@capacitor/push-notifications' es opcional, lo
    // instala el workspace mobile (Wave P21-A). En builds web no existe.
    const mod = (await import("@capacitor/push-notifications")) as {
      PushNotifications?: PushNotificationsApi;
    };
    PushNotifications = mod.PushNotifications ?? null;
  } catch {
    return { registered: false, reason: "capacitor-push-not-installed" };
  }
  if (!PushNotifications) {
    return { registered: false, reason: "capacitor-push-missing-export" };
  }

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") {
    return { registered: false, reason: "permission-denied" };
  }

  const api = PushNotifications;

  const token = await new Promise<string | null>((resolve) => {
    let resolved = false;
    void api
      .addListener("registration", (rawToken: unknown) => {
        if (resolved) return;
        resolved = true;
        const t =
          rawToken &&
          typeof rawToken === "object" &&
          "value" in (rawToken as { value?: string })
            ? (rawToken as { value?: string }).value ?? null
            : null;
        resolve(t);
      })
      .catch(() => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      });

    void api.register().catch(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, 15_000);
  });

  if (!token) {
    return { registered: false, reason: "no-token" };
  }

  const ua =
    typeof navigator !== "undefined" && typeof navigator.userAgent === "string"
      ? navigator.userAgent
      : null;

  const persisted = await subscribeToPush({
    kind,
    endpoint: token,
    keys: null,
    userAgent: ua,
    userId: userId ?? null,
  });

  return {
    registered: true,
    kind,
    subscriptionId: persisted.id,
  };
}
