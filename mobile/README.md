# Sync · Mobile (Capacitor)

Wave P21-A · Wrapper Capacitor 7 sobre la PWA de Sync (FollowupGantt). Compila a Android (Play Store) e iOS (App Store) sin re-implementar la app: el WebView carga la PWA productiva y los plugins nativos proveen push, network, preferences y deep links.

## Prerequisitos

- Node.js 20 LTS (mismo que el proyecto raíz).
- **Android:**
  - [Android Studio Iguana](https://developer.android.com/studio) o superior.
  - JDK 17.
  - Android SDK 34 instalado vía el SDK Manager.
  - Variable `ANDROID_HOME` configurada.
- **iOS** (solo macOS):
  - Xcode 15+.
  - CocoaPods (`sudo gem install cocoapods`).
  - Cuenta Apple Developer activa para firmar el bundle.

## Setup inicial

Desde la raíz del repo:

```bash
cd mobile
npm install                  # instala Capacitor CLI + plugins (su propio node_modules)
npx cap add android          # genera el proyecto Android nativo (gitignored)
npx cap add ios              # solo macOS
npx cap sync                 # copia config + plugins al proyecto nativo
```

> `mobile/android/` y `mobile/ios/` están en `.gitignore` — son artefactos
> regenerables que cada dev mantiene local.

## Modos de despliegue del WebView

`capacitor.config.ts` soporta dos estrategias intercambiables:

### A) `server.url` remoto (default · recomendado para arranque)

El WebView carga `https://sync.avante.com` directamente. Misma cookie de sesión HMAC que la web; los hotfixes web aparecen en mobile sin redeploy a stores.

```ts
server: { url: 'https://sync.avante.com', androidScheme: 'https' }
```

### B) Bundle local (`webDir`)

Para offline-first o reducir dependencia de red. Requiere `next export`:

```bash
# en la raíz
npm run build
# si se requiere "out/", agregar `output: 'export'` en next.config
```

Luego en `capacitor.config.ts` comentar `server.url` y dejar `webDir: '../out'`.

> **Trade-off:** server.url da hotfixes web pero no funciona offline.
> webDir funciona offline pero cada feature web requiere release a stores.

### Desarrollo · emulador Android → backend localhost

El emulador Android resuelve el host como `10.0.2.2`. Para apuntar a tu `npm run dev`:

```bash
SYNC_MOBILE_URL=http://10.0.2.2:3000 npx cap sync
# o editar capacitor.config.ts: server.url = 'http://10.0.2.2:3000', cleartext: true
```

Para iOS Simulator el host es `localhost`; no hay restricción cleartext en HTTPS.

## Build · Debug

```bash
npx cap sync                 # cada vez que cambia capacitor.config.ts o se actualiza un plugin
npx cap open android         # abre Android Studio · Run ▶ instala APK debug en device/emulator
npx cap open ios             # abre Xcode · Run ▶ instala en simulador o device firmado
```

## Build · Release (alto nivel)

### Android

1. Generar keystore (una sola vez):
   ```bash
   keytool -genkey -v -keystore sync-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sync
   ```
2. Configurar `mobile/android/key.properties` (gitignored) con `storeFile`, `keyAlias`, `storePassword`, `keyPassword`.
3. En Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle (.aab)**.
4. Subir el `.aab` a Play Console.

> El keystore JAMÁS se committea. Guardar en password manager corporativo
> (Bitwarden Avante) y en GitHub Actions Secrets cuando se automatice el release.

### iOS

1. En Xcode: **Signing & Capabilities** → Team = Avante Apple Developer.
2. Habilitar capabilities: Push Notifications, Background Modes (remote notifications).
3. **Product → Archive** → Distribute App → App Store Connect.

## Plugins integrados

| Plugin | Uso en Sync |
|---|---|
| `@capacitor/push-notifications` | Recibe APNs (iOS) / FCM (Android). Bridge a `src/lib/mobile/push-bridge.ts`. |
| `@capacitor/preferences` | Almacenamiento clave-valor para preferencias locales (theme, tokens cache). |
| `@capacitor/network` | Detecta offline → banner UX en la PWA cuando `server.url` no responde. |
| `@capacitor/app` | Deep links (`com.avante.sync://...`) + lifecycle (pause/resume). |

## Push notifications · arquitectura dual

La PWA web ya tiene Web Push funcional (Wave P6 · `src/lib/pwa/push-subscribe.ts` + tabla `PushSubscription`). El wrapper móvil **NO modifica** esa ruta.

Cuando el WebView corre dentro de Capacitor, `src/lib/mobile/push-bridge.ts` detecta el entorno y registra adicionalmente APNs/FCM token. El backend recibe el token vía la misma server action `subscribeToPush`.

**TODO deuda futura** (`docs/integrations/mobile-capacitor.md`):

- Extender modelo `PushSubscription` con campo `kind: WEB_PUSH | APNS | FCM` para que el sender Web Push (`web-push` lib) no intente enviar a tokens nativos. Por ahora ambos se almacenan como `endpoint` strings; el sender filtrará por prefijo.
- Generar `google-services.json` (Android) y APNs key (iOS) en Firebase Console + Apple Developer.

## Validación local del wrapper

```bash
cd mobile
npm install
npx cap sync                 # debe terminar sin errores
npx cap doctor               # verifica versiones SDK + plugins
```

GitHub Actions workflow opcional: `.github/workflows/mobile-build.yml` (dispatch manual).

## Coexistencia con la PWA web

- `public/manifest.webmanifest` y `public/service-worker.js` siguen sirviendo a navegadores web. El wrapper Capacitor con `server.url` simplemente carga la misma URL; el SW funciona dentro del WebView.
- `src/components/pwa/InstallPrompt.tsx` solo aparece en navegadores que soporten `beforeinstallprompt` — dentro de Capacitor está oculto naturalmente (no dispara el evento).
- El proyecto raíz **no necesita** cambios para compilar la web; este directorio es independiente.
