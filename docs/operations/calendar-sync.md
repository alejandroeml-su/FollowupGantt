# Calendar Sync · Operaciones (Wave P8 · Equipo P8-5)

Sincronización one-way de FollowupGantt hacia Google Calendar, Microsoft
Outlook (Graph) y feeds ICS universales (Apple Calendar, Thunderbird,
etc.). Este doc es el handbook operacional: env vars, tareas cron,
troubleshooting y limitaciones conocidas.

## Arquitectura

```
Tasks (milestones, hard deadlines, sprints)
        │
        ▼
sync-engine.ts ──► google-client.ts  ──► Google Calendar API
                ├─► microsoft-client.ts ─► Microsoft Graph
                └─► (no push) ──────────► ics-export.ts (feed público)

Triggers:
  - Manual: /settings/calendar → triggerMyCalendarSync()
  - Cron:   /api/cron/calendar-sync (cada 4h)
  - Pull:   /api/calendar/ics/{token} (cliente sondea)
```

## Decisiones aprobadas (P8-5)

| ID  | Decisión                                                            |
| --- | ------------------------------------------------------------------- |
| D1  | Sync **one-way** (FollowupGantt → Calendar). MVP no lee eventos.    |
| D2  | Tokens OAuth en raw text. Encrypt-at-rest queda como deuda P9.      |
| D3  | ICS público con token aleatorio (32 bytes base64url). Rotable.      |
| D4  | `CalendarEvent` actúa como audit-log + base de idempotencia.        |
| D5  | Cron cada 4 horas (Vercel Cron). Manual disponible siempre.         |

## Variables de entorno (acción Edwin)

### Google Calendar API

Reusa las credenciales OAuth de P3-1 si ya están definidas; solo añade
los scopes nuevos en la consola de Google Cloud:

```
GOOGLE_CLIENT_ID         (ya existe — Wave P3-1)
GOOGLE_CLIENT_SECRET     (ya existe — Wave P3-1)
NEXT_PUBLIC_APP_URL      (ya existe — usado en redirect_uri)
```

Pasos en Google Cloud Console:

1. APIs & Services → Library → habilitar **Google Calendar API**.
2. APIs & Services → Credentials → editar el OAuth Client existente.
3. Authorized redirect URIs: añadir
   `${NEXT_PUBLIC_APP_URL}/calendar-sync/google/callback`.
4. Pantalla de consent: añadir scopes:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.readonly`

### Microsoft Graph (Calendars)

```
MICROSOFT_CLIENT_ID       (ya existe — Wave P3-1)
MICROSOFT_CLIENT_SECRET   (ya existe — Wave P3-1)
MICROSOFT_TENANT_ID       (ya existe — default 'common')
NEXT_PUBLIC_APP_URL       (ya existe)
```

Pasos en Azure Portal → App registrations:

1. Authentication → Redirect URIs: añadir
   `${NEXT_PUBLIC_APP_URL}/calendar-sync/microsoft/callback`.
2. API permissions → Microsoft Graph → Delegated:
   - `Calendars.ReadWrite`
   - `offline_access` (para refresh_token)
3. Grant admin consent (si aplica al tenant).

### Cron (CRON_SECRET)

```
CRON_SECRET=<reusa el de /api/cron/recurrence>
```

## Configurar Vercel Cron

Añadir al `vercel.json` (NO se versiona automáticamente desde este PR
para evitar duplicar cron jobs):

```json
{
  "crons": [
    { "path": "/api/cron/calendar-sync", "schedule": "0 */4 * * *" }
  ]
}
```

Schedule sugerido: cada 4 horas. Para entornos de prueba puedes usar
cada hora (`0 * * * *`).

## Endpoints

| Método | Ruta                                          | Auth                          | Descripción                |
| ------ | --------------------------------------------- | ----------------------------- | -------------------------- |
| GET    | `/calendar-sync/google/callback`              | sesión + cookies state/PKCE   | OAuth Google start/cb      |
| GET    | `/calendar-sync/microsoft/callback`           | sesión + cookies state/PKCE   | OAuth Microsoft start/cb   |
| GET    | `/api/cron/calendar-sync`                     | `Authorization: Bearer …`     | Cron — sync masivo         |
| GET    | `/api/calendar/ics/{token}`                   | público (token = bearer)      | Feed iCalendar (lectura)   |

## Troubleshooting

### Error `CALSYNC_DISABLED`

Faltan env vars del provider. Verifica que `GOOGLE_CLIENT_ID` /
`MICROSOFT_CLIENT_ID` estén definidas en Vercel y redeploy.

### Sync falla con `refresh falló: 400`

El refresh_token expiró o fue revocado. Solución: el usuario reconecta
desde `/settings/calendar` (botón "Reconectar"). Google revoca tokens
si el usuario quita permisos en https://myaccount.google.com/permissions.

### Feed ICS devuelve calendario vacío

Posibles causas:
- `syncEnabled=false` (toggle desactivado).
- Token inválido / rotado.
- Usuario sin proyectos asignados (ProjectAssignment) ni rol admin.

### Eventos duplicados en Google Calendar

`sync-engine.ts` busca `CalendarEvent` previo con mismo `connectionId +
taskId + type` para idempotencia. Si por algún motivo hay duplicados,
ejecuta:

```sql
-- Ver duplicados
SELECT "connectionId", "taskId", "type", COUNT(*)
FROM "CalendarEvent"
GROUP BY 1,2,3 HAVING COUNT(*) > 1;
```

Y borra los huérfanos manualmente desde el calendar de Google. La
próxima sync los recreará idempotentemente.

## Limitaciones conocidas (deuda registrada)

1. **No bidireccional**: si el usuario edita un evento en Google, el
   cambio se sobreescribe en la próxima sync. Bidireccional queda para
   P10+.
2. **Refresh token rotation manual**: Google a veces emite nuevos
   refresh_tokens en re-auth con `prompt=consent`; la lógica actual lo
   persiste, pero no detecta proactivamente revocaciones.
3. **Tokens en plaintext**: `accessToken` y `refreshToken` se guardan
   en raw. P9 deberá implementar encrypt-at-rest con AWS KMS o el
   pgcrypto module de Postgres.
4. **Sin atendees**: solo se sincroniza el evento del owner. La
   asignación de invitados a milestones (M:N con assignees) queda
   pendiente.
5. **Time zones**: todos los eventos se emiten en UTC. Los clientes
   locales convierten a TZ del usuario; FollowupGantt no almacena TZ
   por proyecto aún.

## Acciones para Edwin

- [ ] Habilitar Google Calendar API en Google Cloud Console.
- [ ] Añadir redirect URI `/calendar-sync/google/callback` en Google.
- [ ] Añadir redirect URI `/calendar-sync/microsoft/callback` en Azure.
- [ ] Añadir scope `Calendars.ReadWrite` + `offline_access` en Azure.
- [ ] Añadir cron block a `vercel.json` con schedule `0 */4 * * *`.
- [ ] Aplicar migration `20260505_calendar_sync` en Supabase prod (MCP).
- [ ] Probar flujo end-to-end con cuenta personal antes de anunciar
      a usuarios.
