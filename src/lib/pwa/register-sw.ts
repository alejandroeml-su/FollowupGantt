"use client";

/**
 * Wave P20-A · Helper de registro del Service Worker canónico
 * (`/service-worker.js`).
 *
 * Se llama desde un componente cliente montado en el shell global. La
 * funcion expone:
 *   - `registerServiceWorker()`: registra `/service-worker.js` con scope
 *     `/` y devuelve la `ServiceWorkerRegistration`. Idempotente: si ya
 *     hay un registro activo, lo reutiliza.
 *   - `useServiceWorkerUpdate()`: hook que detecta updates pendientes y
 *     expone helpers para que el banner "Nueva version disponible"
 *     pueda forzar el `skipWaiting` y recargar.
 *
 * Solo opera en producción (en `next dev` el SW genera caches stale
 * que rompen el HMR). El navegador debe soportar `serviceWorker`.
 *
 * NOTA: coexiste con el SW heredado `/sw.js` (Wave P4-3 PWA). El SW
 * registrado por este helper toma precedencia por nombre — los
 * clientes existentes irán migrando al re-registrarse.
 */

import { useCallback, useEffect, useState } from "react";

const SW_URL = "/service-worker.js";
const SW_SCOPE = "/";

export type ServiceWorkerSupport =
  | { supported: true }
  | { supported: false; reason: "no-window" | "no-sw-api" | "dev-mode" };

export function getServiceWorkerSupport(): ServiceWorkerSupport {
  if (typeof window === "undefined") return { supported: false, reason: "no-window" };
  if (!("serviceWorker" in navigator)) {
    return { supported: false, reason: "no-sw-api" };
  }
  if (process.env.NODE_ENV !== "production") {
    return { supported: false, reason: "dev-mode" };
  }
  return { supported: true };
}

/**
 * Registra el SW canonico. Idempotente: si ya hay un registro, lo
 * devuelve sin re-registrarlo. Si el browser no soporta SW o estamos
 * en dev, resuelve `null`.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  const support = getServiceWorkerSupport();
  if (!support.supported) return null;

  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  } catch (err) {
    console.warn("[pwa] service-worker registration failed", err);
    return null;
  }
}

/**
 * Hook que registra el SW al primer mount y detecta cuando hay un
 * worker `installing` esperando para activarse. Permite al consumidor
 * mostrar un toast "Nueva version disponible · Recargar" y disparar
 * `applyUpdate()` cuando el usuario acepta.
 *
 * Mantiene un flag `updateAvailable` que pasa a `true` cuando el SW
 * detecta una nueva version en background.
 */
export function useServiceWorkerUpdate(): {
  updateAvailable: boolean;
  applyUpdate: () => Promise<void>;
} {
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const support = getServiceWorkerSupport();
    if (!support.supported) return;

    let cancelled = false;

    const handleStateChange = (worker: ServiceWorker) => {
      const listener = () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          if (!cancelled) setUpdateAvailable(true);
        }
      };
      worker.addEventListener("statechange", listener);
      return () => worker.removeEventListener("statechange", listener);
    };

    void (async () => {
      const reg = await registerServiceWorker();
      if (cancelled || !reg) return;
      setRegistration(reg);

      if (reg.waiting && navigator.serviceWorker.controller) {
        setUpdateAvailable(true);
      }

      if (reg.installing) {
        handleStateChange(reg.installing);
      }

      reg.addEventListener("updatefound", () => {
        if (reg.installing) {
          handleStateChange(reg.installing);
        }
      });
    })();

    // Cuando el SW nuevo activa, recargamos para asegurar consistencia
    // entre HTML/RSC y bundles. Se dispara solo una vez por sesion.
    let reloaded = false;
    const reloadOnce = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);

    // Backup: el SW v2+ envía `SW_VERSION_UPDATED` desde su handler
    // `activate` tras borrar caches viejos. Es redundante con
    // controllerchange pero asegura el reload incluso si por algún
    // motivo el controller no cambia (caso de cache muy stale).
    const onSwMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === "SW_VERSION_UPDATED") {
        reloadOnce();
      }
    };
    navigator.serviceWorker.addEventListener("message", onSwMessage);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", reloadOnce);
      navigator.serviceWorker.removeEventListener("message", onSwMessage);
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    const reg =
      registration ?? (await navigator.serviceWorker.getRegistration(SW_SCOPE));
    if (!reg) return;
    const worker = reg.waiting ?? reg.installing;
    if (worker) {
      worker.postMessage({ type: "SKIP_WAITING" });
    } else {
      // Fallback: si no hay waiting/installing visible, recargamos.
      window.location.reload();
    }
  }, [registration]);

  return { updateAvailable, applyUpdate };
}
