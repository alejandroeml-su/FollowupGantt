/**
 * Wave P21-A · Bridge defensivo Capacitor ↔ web.
 *
 * Este helper detecta si la PWA corre embebida dentro del wrapper
 * Capacitor (Android/iOS) leyendo el global `window.Capacitor` que
 * el runtime nativo inyecta antes de cargar el bundle web.
 *
 * CRÍTICO: este archivo NO importa `@capacitor/core` ni ningún plugin.
 * Cuando la PWA se sirve en un navegador estándar, `window.Capacitor`
 * es `undefined` y todas las funciones devuelven valores seguros sin
 * fallar el build (no hay imports a paquetes ausentes).
 *
 * Por qué evitamos `import ... from '@capacitor/core'`:
 *   - El monorepo web no instala `@capacitor/*` (vive en `mobile/`).
 *   - Hacer ese import provocaría `Module not found` en `next build`.
 *   - Tree-shaking + `typeof window` guard es suficiente para detectar
 *     el entorno nativo.
 */

type CapacitorRuntime = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

declare global {
  interface Window {
    Capacitor?: CapacitorRuntime
  }
}

export type MobilePlatform = 'web' | 'android' | 'ios'

/**
 * `true` si el bundle se está ejecutando dentro del WebView de Capacitor.
 * SSR-safe: en server side devuelve `false`.
 */
export function isCapacitor(): boolean {
  if (typeof window === 'undefined') return false
  const cap = window.Capacitor
  if (!cap) return false
  if (typeof cap.isNativePlatform === 'function') {
    try {
      return cap.isNativePlatform()
    } catch {
      return false
    }
  }
  // Fallback: si el objeto existe pero la API no, asumimos que sí.
  return true
}

/**
 * Devuelve la plataforma de ejecución. En navegador normal o SSR
 * siempre devuelve `'web'`.
 */
export function getPlatform(): MobilePlatform {
  if (typeof window === 'undefined') return 'web'
  const cap = window.Capacitor
  if (!cap || typeof cap.getPlatform !== 'function') return 'web'
  try {
    const raw = cap.getPlatform()
    if (raw === 'android') return 'android'
    if (raw === 'ios') return 'ios'
    return 'web'
  } catch {
    return 'web'
  }
}

/**
 * Útil para gating de UI: "ocultar InstallPrompt si ya somos nativos",
 * "mostrar banner offline si Network plugin reporta sin red", etc.
 */
export function isNativeMobile(): boolean {
  const p = getPlatform()
  return p === 'android' || p === 'ios'
}
