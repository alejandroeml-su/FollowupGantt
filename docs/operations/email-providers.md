# Notificaciones por correo · Provider abstracto

> Refleja el adapter `src/lib/email/provider.ts` (Wave operativa
> 2026-05-06). El módulo selecciona automáticamente el primer adapter
> disponible. La app degrada elegantemente si ninguno está configurado
> (los emails son notificaciones, no flujo crítico).

## Orden de preferencia

```
SMTP genérico (nodemailer)  ←  recomendado en Avante
        ↓ (si SMTP_* faltantes o tenant bloquea SMTP AUTH)
SendGrid Single Sender      ←  fallback sin DNS
        ↓ (si SENDGRID_API_KEY faltante)
Resend                      ←  legacy, requiere dominio verificado
        ↓ (si RESEND_API_KEY faltante)
none                        ←  log-only en dev; password reset escribe link a stdout
```

## Opción 1 · SMTP M365 (preferida)

Usa el buzón corporativo `proyecto@complejoavante.com` con basic auth
contra `smtp.office365.com:587` (STARTTLS). Los correos salen nativos
de `@complejoavante.com` con SPF/DKIM gestionados por M365.

### Variables de entorno

| Variable        | Valor recomendado                  | Comentario                                                       |
|-----------------|------------------------------------|------------------------------------------------------------------|
| `SMTP_HOST`     | `smtp.office365.com`               | Endpoint M365 estándar.                                          |
| `SMTP_PORT`     | `587`                              | STARTTLS. Usar `465` para TLS implícito.                         |
| `SMTP_SECURE`   | `false`                            | `true` si y sólo si puerto 465.                                  |
| `SMTP_USER`     | `proyecto@complejoavante.com`      | Mismo buzón al que se asignó el password.                        |
| `SMTP_PASSWORD` | _(password real del buzón)_        | NO una App Password — el tenant las bloquea. Password de login.  |
| `EMAIL_FROM`    | `FollowupGantt <proyecto@complejoavante.com>` | Debe coincidir con `SMTP_USER`. |

### Caveat: SMTP AUTH disabled (`535 5.7.139`)

Microsoft deshabilita por defecto **SMTP AUTH (Basic Auth)** en
tenants creados desde 2022. Si el primer envío falla con
`535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is
disabled for the Tenant`, tienes 3 caminos:

1. **Habilitar SMTP AUTH por mailbox** (admin M365):
   ```powershell
   Set-CASMailbox -Identity proyecto@complejoavante.com -SmtpClientAuthenticationDisabled $false
   ```
   Requiere Exchange Admin role. Cambio aplica en ~30 min.
2. **Habilitar SMTP AUTH a nivel tenant**: Microsoft 365 admin center →
   Settings → Org settings → Modern auth → desactivar "SMTP AUTH disabled".
   Más amplio (afecta todo el tenant), pedir aprobación de seguridad.
3. **Pivotar a SendGrid Single Sender** (opción 2): borrar `SMTP_*`
   en Vercel y configurar `SENDGRID_API_KEY`. El provider detecta el
   cambio automáticamente.

### Smoke test

Tras configurar, dispara un envío real:

```bash
curl -fsS -X POST https://followup-gantt-beta.vercel.app/api/admin/email-test \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"to":"emartinez@complejoavante.com"}'
```

Verifica el header `Authentication-Results` del correo recibido:
debe incluir `dkim=pass spf=pass dmarc=pass` para `complejoavante.com`.

## Opción 2 · SendGrid Single Sender (fallback sin DNS)

Cuando M365 bloquea SMTP AUTH y no hay acceso DNS para Resend.

1. Crear cuenta en https://signup.sendgrid.com (free tier: 100 emails/día).
2. **Settings → Sender Authentication → Single Sender Verification →
   Verify a Single Sender**. Rellenar con `proyecto@complejoavante.com`
   (Edwin debe tener acceso al buzón para hacer click en el link de
   confirmación que SendGrid envía).
3. **Settings → API Keys → Create API Key** con permiso "Mail Send".
4. Configurar en Vercel:
   - `SENDGRID_API_KEY=SG.xxx`
   - `EMAIL_FROM=FollowupGantt <proyecto@complejoavante.com>`
5. Eliminar `SMTP_HOST` (o dejarlo vacío) para que el provider use SendGrid.

Limitación visible: Gmail muestra "via sendgrid.net" debajo del From
porque el envío usa los servidores SMTP de SendGrid. Sigue siendo
legítimo (DKIM de SendGrid + From verificado).

## Opción 3 · Resend (legacy, dominio completo)

Mantenido por compatibilidad. Bloqueado actualmente por falta de
acceso DNS al panel de iPower. Cuando se desbloquee:

1. Resend Dashboard → Domains → Add `complejoavante.com`.
2. Crear los 3 registros DNS (TXT verificación, TXT DKIM, TXT/MX SPF).
3. Configurar `RESEND_API_KEY` y eliminar `SMTP_*` y `SENDGRID_API_KEY`.

Detalle DNS y troubleshooting completo en [resend-domain.md](./resend-domain.md).

## Cambiar de provider en caliente

El provider lee env vars en cada cold start. Para forzar un cambio:

1. En Vercel, actualizar las env vars (añadir/borrar las del provider deseado).
2. Hacer un re-deploy (Settings → Deployments → ⋯ → Redeploy) — basta el último.
3. Validar el provider activo: `GET /api/admin/email-status` (cuando exista) o
   inspeccionar `provider` en los logs de la próxima notificación enviada.

## Diagnóstico rápido

| Síntoma                                                         | Causa probable                                              | Acción                                                              |
|-----------------------------------------------------------------|-------------------------------------------------------------|---------------------------------------------------------------------|
| `535 5.7.139 SmtpClientAuthentication is disabled for the Tenant` | SMTP AUTH deshabilitado en M365                             | Habilitar por mailbox o pivotar a SendGrid (ver caveat arriba).     |
| `535 5.7.3 Authentication unsuccessful`                         | Password incorrecta o mailbox sin licencia M365 con buzón   | Verificar credenciales y que el buzón esté activo.                  |
| `EAUTH` con M365 + MFA                                          | M365 con MFA exige App Password (tenant las suele bloquear) | Pedir al admin habilitar SMTP AUTH para el mailbox sin MFA-app pwd. |
| Email entregado pero marcado "via sendgrid.net" en Gmail        | Adapter activo es SendGrid                                  | Esperado en modo Single Sender. Migrar a SMTP M365 si molesta.      |
| `403 The domain is not verified` (Resend)                       | App envía con dominio sin DNS verificado                    | Cambiar `EMAIL_FROM` o pivotar a SMTP/SendGrid.                     |
| `NO_EMAIL_PROVIDER_CONFIGURED` en logs                          | Ningún provider tiene credenciales                          | Configurar al menos uno (preferir SMTP M365).                       |
