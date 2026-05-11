"use client";

/**
 * Wave P20-A · Banner inferior "Nueva version disponible · Recargar".
 *
 * Consume `useServiceWorkerUpdate` (registra el SW canonico y detecta
 * cuando hay un worker `installing` esperando). El click en "Recargar"
 * llama `applyUpdate()` que envia `SKIP_WAITING` al worker, el cual
 * activa la nueva version. El listener `controllerchange` en
 * `register-sw.ts` recarga la pestana una vez activada.
 */

import { useServiceWorkerUpdate } from "@/lib/pwa/register-sw";

export function PwaUpdateBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate();

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-indigo-500/60 bg-indigo-600/95 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur"
    >
      <span className="mr-3">Nueva version de Sync disponible.</span>
      <button
        type="button"
        onClick={() => void applyUpdate()}
        className="rounded-full bg-white/20 px-3 py-1 text-white hover:bg-white/30 focus:outline-none focus:ring-2 focus:ring-white/50"
      >
        Recargar
      </button>
    </div>
  );
}

export default PwaUpdateBanner;
