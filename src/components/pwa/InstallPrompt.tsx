"use client";

/**
 * Wave P20-A · Banner discreto "Instala Sync" para PWA installable.
 *
 * Escucha el evento `beforeinstallprompt` (Chrome/Edge/Samsung Internet
 * en Android + Chrome desktop) y muestra un banner inferior con dos
 * acciones:
 *   - Instalar  -> dispara `deferredPrompt.prompt()` y captura la decision.
 *   - Mas tarde -> oculta el banner y persiste la decision en
 *     localStorage para no spam al usuario durante 30 dias.
 *
 * El evento `appinstalled` (post-instalacion) tambien limpia el banner.
 *
 * Limitaciones conocidas:
 *   - iOS Safari no emite `beforeinstallprompt`. Para iOS hay que
 *     mostrar instrucciones manuales ("Anadir a pantalla de inicio").
 *     Detectamos iOS via UA y mostramos un mensaje alternativo si la
 *     prop `showIosInstructions` esta activa (default `true`).
 *   - Si la app ya esta instalada (`display-mode: standalone`), el
 *     banner no se muestra.
 */

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const DISMISS_KEY = "sync.pwa.install-dismissed";
const DISMISS_TTL_DAYS = 30;

function isDismissedRecently(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = Number.parseInt(raw, 10);
    if (Number.isNaN(ts)) return false;
    const ageMs = Date.now() - ts;
    return ageMs < DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function markDismissed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // localStorage puede estar deshabilitado (incognito + cookies off).
  }
}

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  // iOS expone `navigator.standalone`; los demas usan media query.
  const navStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone;
  if (navStandalone === true) return true;
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches
  ) {
    return true;
  }
  return false;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPhone/iPad/iPod o iPadOS desktop-mode (Mac UA con touch).
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  if (
    /Macintosh/.test(ua) &&
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints &&
    (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1
  ) {
    return true;
  }
  return false;
}

export type InstallPromptProps = {
  /** Si true, muestra instrucciones manuales en iOS. Default `true`. */
  showIosInstructions?: boolean;
};

export function InstallPrompt({
  showIosInstructions = true,
}: InstallPromptProps) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandaloneDisplay()) return; // ya instalada
    if (isDismissedRecently()) return; // usuario dijo "mas tarde"

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    const onInstalled = () => {
      setDeferred(null);
      setHidden(true);
      markDismissed();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS: si no hay beforeinstallprompt, mostramos instrucciones tras
    // un pequeno delay para no asaltar al usuario al primer paint.
    if (showIosInstructions && isIos()) {
      const t = setTimeout(() => {
        setShowIos(true);
        setHidden(false);
      }, 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("beforeinstallprompt", onBeforeInstall);
        window.removeEventListener("appinstalled", onInstalled);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [showIosInstructions]);

  const onInstallClick = useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "dismissed") {
        markDismissed();
      }
    } catch (err) {
      console.warn("[pwa] install prompt error", err);
    } finally {
      setDeferred(null);
      setHidden(true);
    }
  }, [deferred]);

  const onDismiss = useCallback(() => {
    markDismissed();
    setHidden(true);
    setDeferred(null);
    setShowIos(false);
  }, []);

  if (hidden) return null;
  if (!deferred && !showIos) return null;

  return (
    <div
      role="dialog"
      aria-label="Instalar Sync"
      className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md rounded-xl border border-slate-700/60 bg-slate-900/95 p-4 text-sm text-slate-100 shadow-2xl backdrop-blur lg:bottom-6"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-300"
        >
          {/* Icono cloud-gear simplificado */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-6 w-6"
          >
            <path d="M17 9a5 5 0 0 0-9.6-1.5A4 4 0 0 0 7 16h10a4 4 0 0 0 0-7Z" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-semibold">Instala Sync en tu dispositivo</p>
          <p className="mt-0.5 text-xs text-slate-300">
            {showIos
              ? "En iOS: pulsa Compartir y luego Anadir a pantalla de inicio."
              : "Acceso rapido + notificaciones push para no perder cambios."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {!showIos && (
              <button
                type="button"
                onClick={onInstallClick}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                Instalar
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              Mas tarde
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-200"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path d="M6.225 4.811a1 1 0 0 0-1.414 1.414L8.586 10l-3.775 3.775a1 1 0 1 0 1.414 1.414L10 11.414l3.775 3.775a1 1 0 0 0 1.414-1.414L11.414 10l3.775-3.775a1 1 0 1 0-1.414-1.414L10 8.586 6.225 4.811Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default InstallPrompt;
