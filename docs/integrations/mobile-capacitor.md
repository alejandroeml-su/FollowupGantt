# Sync · Mobile App (Capacitor)

> Wave R3.0 Fase 4 · P21-A — Wrapper Capacitor 7 sobre la PWA de Sync. Publica a Google Play y Apple App Store sin re-implementar la app: el WebView nativo carga la PWA productiva y expone plugins nativos para push, network y deep links.

---

## 1. Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│  Sync Mobile (Capacitor 7 · com.avante.sync)                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  WebView (Android System WebView / WKWebView)             │  │
│  │  └─► https://sync.avante.com    ← misma PWA que la web    │  │
│  │       · Cookie session HMAC compartida                    │  │
│  │       · Service Worker activo (cache + offline parcial)   │  │
│  │       · Bundle Next.js 16 servido desde Vercel            │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Plugins nativos (bridge JS ↔ Java/Swift)                 │  │
│  │  · PushNotifications (APNs / FCM)                         │  │
│  │  · Preferences      (key-value local)                     │  │
│  │  · Network          (offline detection)                   │  │
│  │  · App              (deep links, lifecycle)               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         ▲                                       ▲
         │ APNs token                            │ FCM token
         │                                       │
   Apple APNs HTTP/2                       Google FCM HTTP v1
```

**Decisiones clave:**

- **`server.url` remoto** (default): el WebView carga la URL productiva. Hotfixes web aparecen sin redeploy a stores. Trade-off: requiere conectividad.
- **Misma sesión web**: la cookie HMAC firmada por el backend Next.js viaja en cada request del WebView. No hay autenticación móvil separada.
- **Web Push coexiste con APNs/FCM**: la PWA web sigue funcionando para navegadores; en el wrapper móvil se registra adicionalmente el token nativo. Ambos caminos comparten la server action `subscribeToPush` (con la deuda descrita en §4).

## 2. Estructura de archivos

| Path | Contenido |
|---|---|
| `mobile/package.json` | Dependencias Capacitor 7 + plugins. Su propio `node_modules/`. |
| `mobile/capacitor.config.ts` | `appId`, `appName`, `server.url`, plugins. |
| `mobile/tsconfig.json` | Aislado del root; solo parsea `capacitor.config.ts`. |
| `mobile/README.md` | Setup local, build debug/release, keystores. |
| `mobile/.gitignore` | Excluye `android/`, `ios/`, `node_modules/`, keystores. |
| `src/lib/mobile/capacitor-bridge.ts` | `isCapacitor()`, `getPlatform()` defensivos (no importan `@capacitor/*`). |
| `src/lib/mobile/push-bridge.ts` | `registerCapacitorPush()` con import dinámico tolerante. |
| `src/lib/mobile/index.ts` | Barrel para tree-shaking. |
| `.github/workflows/mobile-build.yml` | Workflow `workflow_dispatch` para validar `cap sync`. |

## 3. Pasos de release (alto nivel)

### Android (Google Play)

1. **Provisión** (una sola vez):
   - Crear cuenta Google Play Console ($25 USD pago único).
   - Crear app `com.avante.sync` con icono 512×512.
   - Configurar Firebase project (para FCM): descargar `google-services.json` → colocarlo en `mobile/android/app/`.
2. **Keystore**:
   - `keytool -genkey -v -keystore sync-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sync`.
   - Guardar contraseñas en Bitwarden Avante.
   - **NUNCA committear el keystore.**
3. **Build local**: `cd mobile && npx cap sync android && npx cap open android` → Android Studio → **Build → Generate Signed Bundle / APK → AAB**.
4. **Upload**: subir el `.aab` a Play Console → Internal testing → Closed testing → Production.

### iOS (App Store)

1. **Provisión** (una sola vez):
   - Cuenta Apple Developer ($99 USD/año).
   - Crear App ID `com.avante.sync` con capabilities Push + Background Modes.
   - Generar APNs Auth Key (`.p8`) en developer.apple.com → guardar en Bitwarden.
2. **Build local** (solo macOS): `cd mobile && npx cap sync ios && npx cap open ios` → Xcode → seleccionar Team → **Product → Archive** → Distribute App → App Store Connect.
3. **TestFlight** → **App Store Review** → producción.

## 4. Push notifications · dualidad web vs nativo

La PWA web (Wave P6) usa `pushManager.subscribe()` y persiste un `PushSubscription` con:

```
endpoint  String  @unique   ← URL https FCM/Mozilla
keys      Json              ← { p256dh, auth }
```

El wrapper móvil obtiene un token nativo (APNs/FCM) que **no es una URL https**. El schema actual `subscribeToPush` valida `endpoint: z.string().url()` → un token APNs/FCM lo haría fallar con `[INVALID_INPUT]`.

### Estado actual (transitorio · este PR)

- `src/lib/mobile/push-bridge.ts` solicita permisos + registra contra APNs/FCM y devuelve el token al caller.
- El token **no se envía al backend todavía**. El caller puede guardarlo localmente con `@capacitor/preferences` mientras se implementa la deuda.

### Deuda registrada (Wave futura · ~5 SP)

1. **Migración Prisma**: agregar `PushSubscription.kind` enum `WEB_PUSH | APNS | FCM` + relajar `endpoint` para aceptar tokens nativos (validación por `kind`).
2. **Sender dual**: el cron de push y los hooks de notificación deben:
   - Filtrar suscripciones por `kind`.
   - Usar `web-push` para `WEB_PUSH`.
   - Usar Firebase Admin SDK para `FCM`.
   - Usar `apn` (node-apn) o HTTP/2 manual para `APNS`.
3. **Multi-device**: permitir que un usuario tenga simultáneamente subscripción web (laptop) + APNs (iPhone) + FCM (Android). La unique key debe ser `(userId, endpoint, kind)`, no solo `endpoint`.
4. **Server action `subscribeNativePush(token, kind)`** específica para el wrapper, que el `push-bridge` invocará una vez el backend acepte tokens nativos.

## 5. Trade-offs documentados

| Decisión | Pro | Contra |
|---|---|---|
| `server.url` (carga remota) | Hotfixes web inmediatos; no requiere redeploy a stores por cambios de UI. | Requiere conectividad; sin red, solo lo que el SW haya cacheado. |
| `webDir` (bundle local) | Funciona offline; bundle versionado por release. | Cada feature web → nuevo release a stores (TestFlight 24-48h, Play 2-4h). |
| Misma cookie session web | Cero refactor backend; SSO inmediato. | El logout web cierra la app móvil. Necesario explicarlo en UX. |
| Web Push + APNs duales | Soporta laptop + mobile simultáneo. | Backend debe aprender ambos protocolos (ver §4). |
| Capacitor 7 (no React Native) | Reusa 100% del código web; mantiene a Edwin como dev single-stack. | Performance ligeramente inferior a RN para listas largas con virtualización. |

## 6. Limitaciones conocidas

- **Sin offline first**: `server.url` sin red → solo páginas cacheadas por el SW. Para escenarios edge-deploy con conectividad intermitente, migrar a `webDir`.
- **Deep links**: configurar URL schemes en `mobile/android/app/src/main/AndroidManifest.xml` y `mobile/ios/App/App/Info.plist` después del primer `cap add`. Pendiente para Wave P21-A.1.
- **Biometric login**: no incluido. Requiere `@capacitor-community/biometric-auth` y server-side challenge. Backlog R3.0 Fase 5.
- **App Store review riesgo**: Apple a veces rechaza apps que son "100% web wrapper" (guideline 4.2). Mitigación: integrar al menos 2 plugins nativos visibles para el usuario (Push + Preferences) — ya cumplido.
- **Firma Android**: el keystore release vive solo en local. Para CI/CD release, mover a GitHub Secrets + secure files action (no incluido en este PR).
- **`PushSubscription` schema rígido**: tokens nativos no se envían al backend hasta la deuda en §4.

## 7. Validación

```bash
# Root del repo (verifica que mobile/ no rompe el build web)
npx tsc --noEmit
npm run lint
npm run test                  # vitest

# Wrapper móvil (requiere SDK Android instalado)
cd mobile
npm install
npx cap sync                  # debe terminar 0 errores
npx cap doctor                # opcional, valida versiones SDK
```

## 8. Coexistencia con la PWA web

- `public/manifest.webmanifest` y `public/service-worker.js` **NO se modifican**.
- `src/components/pwa/InstallPrompt.tsx` **NO se modifica**. Dentro de Capacitor el evento `beforeinstallprompt` nunca dispara → el banner queda oculto sin lógica adicional.
- Imports `from '@/lib/mobile'` son safe en código que también corre en web: las funciones son no-ops cuando `window.Capacitor` no existe.

---

**Owners:** Equipo P21-A (Capacitor) · Wave R3.0 Fase 4.
**Estado:** Wrapper config + helpers defensivos + docs entregados. Build real de stores pendiente (keystores + cuentas).
