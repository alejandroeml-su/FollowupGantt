# Push Notifications Dual (Web + Native)

Wave R4-B · Backend dispatcher que envía push notifications a:
- **Web Push** (browsers PWA) vía VAPID.
- **APNs** (iOS Capacitor) vía HTTP/2 + JWT ES256.
- **FCM** (Android Capacitor) vía HTTP v1 + OAuth2 JWT RS256.

## Arquitectura

```
        createNotification (in-app)
                │
                ▼
        maybeSendPush
                │
                ▼
        dispatchPush(userId, payload)
                │
   ┌────────────┼────────────┐
   ▼            ▼            ▼
WEB_PUSH    APNS         FCM
adapter     adapter      adapter
(web-push)  (http2+JWT)  (HTTP v1+OAuth2)
```

Cada `PushSubscription` lleva un campo `kind` (`WEB_PUSH | APNS | FCM`).
El dispatcher carga las subs del usuario, las agrupa implícitamente por
`kind` y dispara `adapter.send(sub, payload)` para cada una, en paralelo
(`Promise.allSettled`).

Cleanup de tokens muertos (`404/410` web-push, `Unregistered` FCM,
`BadDeviceToken` APNs) se hace en un único `deleteMany` batched al final
del dispatch.

## Setup

### 1) Web Push (VAPID)

Ya configurado en Wave P6. Variables:

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...   # mismo public key para el client
WEB_PUSH_SUBJECT=mailto:notifications@complejoavante.com
```

Generación de keys: `npx web-push generate-vapid-keys`.

### 2) APNs (iOS)

Pre-requisitos:
- Cuenta Apple Developer activa (USD 99/año).
- Bundle ID registrado para la app (ej. `com.complejoavante.sync`).
- Capacidad "Push Notifications" habilitada en el App ID.

**Generar `.p8` key:**
1. Apple Developer → Certificates, IDs & Profiles → Keys → "+".
2. Activar "Apple Push Notifications service (APNs)".
3. Descargar el `.p8` (solo se descarga UNA VEZ).
4. Copiar el Key ID (10 chars) y el Team ID (10 chars).

**Variables de entorno (Vercel):**

```
APNS_KEY_ID=ABCDEF1234              # Key ID del .p8
APNS_TEAM_ID=TEAMID1234             # Team ID Apple Developer
APNS_BUNDLE_ID=com.complejoavante.sync
APNS_KEY_P8="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
APNS_PRODUCTION=true                # false = sandbox.push.apple.com
```

> **Tip:** En Vercel, pegar el contenido del `.p8` como variable secreta
> (multiline). El archivo es ASCII PEM, puede ir directamente.

### 3) FCM (Android)

Pre-requisitos:
- Cuenta Google Cloud / Firebase (gratis con cuota).
- Proyecto Firebase con Cloud Messaging habilitado.

**Generar service account:**
1. Firebase Console → Project Settings → Service accounts.
2. "Generate new private key" → descarga JSON.
3. El JSON contiene `project_id`, `client_email`, `private_key`.

**Variables de entorno (Vercel):**

```
FIREBASE_PROJECT_ID=mi-proyecto-firebase
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@mi-proyecto.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

> **Tip:** Vercel preserva los `\n` literales en env vars; el adapter los
> restaura a saltos reales con `.replace(/\\n/g, '\n')`.

Alternativa equivalente: `GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json`
NO está soportado actualmente — el adapter usa env vars granulares para
simplificar el deploy en Vercel.

## Decisiones técnicas

### Por qué NO `apn` ni `firebase-admin`

- `apn` (`@parse/node-apn` fork): sin mantenimiento activo desde 2023,
  agrega TLS connection pooling que ya gestiona `node:http2`.
- `firebase-admin`: ~50 MB con deps Google APIs, overkill para enviar push
  HTTP v1.
- Ambos adapters están implementados con **librerías nativas Node** (`http2`
  + `crypto`) que vienen con Node 20+. Cero deps nuevas.

### Por qué `web-push` SÍ (npm)

La lib `web-push` ya estaba en `package.json` (Wave P6), implementa la
encriptación E2E `aes128gcm` (RFC 8291) sobre las VAPID keys. Hacerlo a
mano sería reinventar criptografía. Mantenemos.

## Backward compatibility

- Rows existentes en `PushSubscription` se backfillan con
  `kind = 'WEB_PUSH'` automáticamente vía `DEFAULT` SQL.
- `keys` pasa de `NOT NULL` a `NULLable` — rows web existentes preservan
  sus `{ p256dh, auth }` intactos.
- `subscribeToPush` mantiene API legacy: si el caller no pasa `kind`,
  se asume `WEB_PUSH`.
- `sendPushToUser` (P6) sigue exportado en `src/lib/web-push/server.ts`
  pero NO se llama desde el código de producción. Está deprecado en
  favor de `dispatchPush`.

## Limitaciones

| Transporte | Payload max | Throttling | Latencia |
|------------|-------------|------------|----------|
| Web Push   | ~4 KB (browser-dependiente) | depende del push service | ~1-3 s |
| APNs       | 4096 bytes (alert push)  | Apple silencioso si abuso | ~500 ms |
| FCM        | 4096 bytes               | 1M msg/proj/min default | ~500 ms |

## Test plan

`tests/unit/push-dispatcher.test.ts` cubre:
- Routing por `kind` (1 test por adapter).
- Sub mixta web + iOS → 2 envíos paralelos.
- APNs/FCM sin credenciales → `skipped`, no error.
- Cleanup tokens `gone` → `deleteMany` batched.
- Edge cases: sin subs, input inválido.

Validación end-to-end: `GET /api/push/test?userId=...&title=Hola` dispara
`dispatchPush` real al usuario indicado.

## Setup pendiente post-merge

1. Aplicar migración `prisma/migrations/20260511_r4b_push_subscription_kind/`
   vía Supabase MCP (`apply_migration`).
2. Cargar env vars APNs/FCM en Vercel (Production + Preview).
3. Wave P21-A debe instalar `@capacitor/push-notifications` en el
   workspace mobile y wirear `registerMobilePush()` al boot del shell
   nativo.
