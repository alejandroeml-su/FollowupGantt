# OAuth providers · Google + Microsoft

Configuración SSO para Ola P3 (Auth completo). El flujo es nativo
(sin `next-auth`): Authorization Code + PKCE; el callback vive en
`/api/auth/oauth/[provider]`.

## Resumen

| Provider  | Redirect URI                                        | Env vars                                                         |
| --------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| Google    | `${NEXT_PUBLIC_APP_URL}/api/auth/oauth/google`      | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                       |
| Microsoft | `${NEXT_PUBLIC_APP_URL}/api/auth/oauth/microsoft`   | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` |

`NEXT_PUBLIC_APP_URL` debe ser HTTPS en prod (ej. `https://gantt.complejoavante.com`).

## Google

### 1. Crear proyecto en Google Cloud Console

1. Acceder a `https://console.cloud.google.com/`.
2. Crear proyecto `followup-gantt-prod` (o reusar uno existente del workspace).
3. Habilitar la API "Google Identity Services" (no requiere billing — el flow OIDC es gratuito).

### 2. OAuth consent screen

1. `APIs & Services → OAuth consent screen`.
2. User type = **Internal** (si el dominio es Workspace de Avante) o
   **External** + lista de allowed users.
3. App name: `FollowupGantt`.
4. User support email: `emartinez@complejoavante.com`.
5. Scopes mínimos: `openid`, `email`, `profile` (los que pide el helper).
6. Authorized domains: `complejoavante.com`.
7. Guardar y publicar (estado: "In production").

### 3. Crear OAuth Client ID

1. `APIs & Services → Credentials → + CREATE CREDENTIALS → OAuth client ID`.
2. Application type: **Web application**.
3. Name: `FollowupGantt · Production`.
4. Authorized JavaScript origins:
   - `https://gantt.complejoavante.com`
5. Authorized redirect URIs:
   - `https://gantt.complejoavante.com/api/auth/oauth/google`
6. Copiar `Client ID` y `Client secret` y guardarlos en Vercel env vars:

```bash
GOOGLE_CLIENT_ID=1234-xxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxx
```

### 4. (Opcional) Preview / staging

Crear un segundo Client ID con redirect `https://staging-gantt.complejoavante.com/api/auth/oauth/google`
y exponerlo sólo en el environment Preview de Vercel.

## Microsoft

### 1. Registrar app en Microsoft Entra ID (Azure AD)

1. Acceder a `https://entra.microsoft.com/` con usuario admin del tenant.
2. `Identity → Applications → App registrations → + New registration`.
3. Name: `FollowupGantt`.
4. Supported account types: **Accounts in this organizational directory only**
   (single tenant) — recomendado para uso interno UTD-Avante.
   Si se necesita aceptar Microsoft personal accounts, elegir
   "Accounts in any organizational directory and personal Microsoft accounts"
   y dejar `MICROSOFT_TENANT_ID=common`.
5. Redirect URI (Web):
   - `https://gantt.complejoavante.com/api/auth/oauth/microsoft`
6. Tras crear, anotar el **Application (client) ID** y el **Directory (tenant) ID**.

### 2. Crear client secret

1. `Certificates & secrets → + New client secret`.
2. Description: `FollowupGantt prod 2026Q2` (rotar cada 6 meses).
3. Expires: 6 months.
4. Copiar el `Value` inmediatamente — sólo se muestra una vez.

### 3. Configurar permisos delegados

1. `API permissions → + Add a permission → Microsoft Graph → Delegated`.
2. Seleccionar:
   - `openid`
   - `email`
   - `profile`
   - `User.Read`
3. `Grant admin consent for <tenant>` (botón).

### 4. Env vars en Vercel

```bash
MICROSOFT_CLIENT_ID=00000000-0000-0000-0000-000000000000
MICROSOFT_CLIENT_SECRET=xxx~xxxxxxxxxxxxxxxxxxxxxx
# Tenant específico (recomendado, single tenant):
MICROSOFT_TENANT_ID=11111111-1111-1111-1111-111111111111
# O para multi-tenant (less restrictive):
# MICROSOFT_TENANT_ID=common
```

## Verificación

Después de configurar ambos providers, redeploy en Vercel para que las
env vars se apliquen. Luego:

1. Abrir `https://gantt.complejoavante.com/login`.
2. Verificar que aparecen los botones "Iniciar con Google" y "Iniciar con Microsoft".
3. Hacer login completo con un user real → comprobar redirect a `/`.
4. Inspeccionar BD:

```sql
SELECT u.email, a.provider, s."createdAt"
FROM "User" u
JOIN "Account" a ON a."userId" = u.id
JOIN "Session" s ON s."userId" = u.id
ORDER BY s."createdAt" DESC
LIMIT 5;
```

## Troubleshooting

| Error                                | Causa probable                                    | Fix                                                              |
| ------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------- |
| `redirect_uri_mismatch`              | Redirect en consola ≠ `${APP_URL}/api/auth/...`   | Comparar exactamente, incluyendo trailing slash.                 |
| `[OAUTH_DISABLED]` en logs           | Falta env var del provider                        | Volver a paso 4 y redeploy.                                      |
| `state mismatch` / `[OAUTH_ERROR]`   | Cookie de state no se persiste (mismo dominio)    | Confirmar que `NEXT_PUBLIC_APP_URL` y la URL real coinciden.     |
| Microsoft `AADSTS50011` invalid uri  | Redirect en Entra ID escrito mal                  | Editar app registration → Authentication → Redirect URIs.        |
| Google `403 disallowed_useragent`    | Pruebas desde WebView embed                       | Probar en Chrome / Edge desktop.                                 |

## Rotación de secrets

Calendarizado cada 90 días (o inmediato si hay sospecha de fuga):

1. Crear nuevo client secret en consola.
2. Sobrescribir env var en Vercel (`Production` y `Preview`).
3. Trigger redeploy.
4. Eliminar el secret viejo en consola tras 24h.
5. Apuntar la rotación en el commit log: `chore(ops): rotate google_client_secret 2026-08-01`.
