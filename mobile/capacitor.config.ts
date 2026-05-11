import type { CapacitorConfig } from '@capacitor/cli';

// Wave P21-A · Capacitor wrapper config para Sync.
// Estrategia "server.url remoto": el wrapper carga la PWA productiva
// `https://sync.avante.com`. Beneficios:
//   - Mismas cookies HMAC del backend (session-based auth) que la web.
//   - Hotfixes sin re-submit a Play Store / App Store.
//   - Service Worker + push subscription web siguen funcionando.
// Trade-off vs `webDir` (bundle local):
//   - Requiere conectividad. Para offline-first hay que cambiar a
//     `npm run build && next export → out/` + `webDir: '../out'`.
//
// Para desarrollo local (Android emulator → host loopback):
//   server: { url: 'http://10.0.2.2:3000', cleartext: true }
// Ver `mobile/README.md`.

const PROD_URL = process.env.SYNC_MOBILE_URL ?? 'https://sync.avante.com';

const config: CapacitorConfig = {
  appId: 'com.avante.sync',
  appName: 'Sync',
  // Cuando se quiera empaquetar el bundle estático en lugar del server.url,
  // descomentar `webDir` y comentar el bloque `server`. `webDir` apunta al
  // `out/` que genera `next export` en la raíz.
  webDir: '../out',
  server: {
    url: PROD_URL,
    androidScheme: 'https',
    // iOS no necesita `iosScheme` cuando es https; se deja en default.
    // `cleartext: true` solo si SYNC_MOBILE_URL es http (dev).
    cleartext: PROD_URL.startsWith('http://'),
  },
  plugins: {
    PushNotifications: {
      // Sin presentation options custom; el backend ya envía title/body.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Preferences: {
      // Namespace propio para no colisionar con otros wrappers en el device.
      group: 'com.avante.sync.preferences',
    },
  },
  android: {
    // Mantén el SW de la PWA controlando el WebView. `mixedContentMode`
    // queda en default; cleartext solo se honra si la URL es http.
    allowMixedContent: false,
  },
  ios: {
    // Permite que el wrapper acceda al backend con cookies session-based.
    limitsNavigationsToAppBoundDomains: false,
  },
};

export default config;
