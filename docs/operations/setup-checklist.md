# Setup operacional · FollowupGantt (producción)

Checklist obligatorio antes de declarar el ambiente productivo "listo".
Cada item enlaza al runbook detallado correspondiente. Marca el checkbox
una vez verificado en consola/dashboard.

> Owner: Edwin Martinez (UTD-Avante). Última revisión: 2026-05-04.

## 0. Pre-requisitos

- [ ] Acceso administrador al proyecto Vercel `followup-gantt`.
- [ ] Acceso owner al proyecto Supabase prod.
- [ ] Acceso a la cuenta Resend del workspace UTD.
- [ ] Acceso a Google Cloud Console (proyecto `followup-gantt`).
- [ ] Acceso a Microsoft Entra ID (tenant `complejoavante.onmicrosoft.com`).
- [ ] DNS de `complejoavante.com` editable (TXT/MX/CNAME).

## 1. Variables de entorno (Vercel · Production)

Configurar en `Vercel → Project → Settings → Environment Variables`
ámbito **Production**. Para preview duplicar con valores propios o
deshabilitar features (OAuth, Resend) según convenga.

- [ ] `DATABASE_URL` — Supabase pooled connection (`?pgbouncer=true&connection_limit=1`).
- [ ] `DIRECT_URL` — Supabase direct (sin pgbouncer; usado por `prisma migrate`).
- [ ] `NEXT_PUBLIC_SUPABASE_URL`
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] `AUTH_SECRET` — `openssl rand -base64 32` (≥ 32 chars).
- [ ] `NEXT_PUBLIC_APP_URL` — `https://gantt.complejoavante.com` (o dominio prod).
- [ ] `RESEND_API_KEY` — ver [resend-domain.md](./resend-domain.md).
- [ ] `EMAIL_FROM` — `FollowupGantt <notifications@complejoavante.com>`.
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — ver [oauth-providers.md](./oauth-providers.md).
- [ ] `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID`.
- [ ] `CRON_SECRET` — `openssl rand -hex 32` (ver [vercel-cron.md](./vercel-cron.md)).

Genera secrets fuera de la consola para no dejarlos en el historial:

```bash
# AUTH_SECRET
openssl rand -base64 32

# CRON_SECRET (hex 32 bytes = 64 chars)
openssl rand -hex 32
```

## 2. Base de datos · RLS

- [ ] Ejecutar `prisma/migrations/20260504_rls_policies/migration.sql`
      contra Supabase prod (Dashboard → SQL Editor).
- [ ] Verificar `pg_policies` count ≥ 60 (ver [rls-policies.md](./rls-policies.md)).
- [ ] Confirmar que el rol del backend (`postgres` o `service_role`) tiene
      `BYPASSRLS` o que `DATABASE_URL` apunta a un rol con bypass.
- [ ] Lanzar smoke test: log-in con usuario regular → acceder a `/projects`
      → confirmar que sólo aparecen los proyectos asignados.

```bash
# Aplicar la migración manualmente (sin pasar por Prisma migrate):
psql "$DIRECT_URL" -f prisma/migrations/20260504_rls_policies/migration.sql
```

## 3. Autenticación · OAuth

- [ ] Registrar app Google (ver [oauth-providers.md](./oauth-providers.md#google)).
- [ ] Registrar app Microsoft (ver [oauth-providers.md](./oauth-providers.md#microsoft)).
- [ ] Probar `/login` → botón Google → callback OK.
- [ ] Probar `/login` → botón Microsoft → callback OK.
- [ ] Confirmar que se crea fila en `User` + `Account` + `Session`.

## 4. Email transaccional · Resend

- [ ] Verificar dominio `complejoavante.com` en Resend (ver [resend-domain.md](./resend-domain.md)).
- [ ] DNS propagado: `dig TXT _resend.complejoavante.com +short`.
- [ ] Enviar correo de prueba a `emartinez@complejoavante.com`.
- [ ] Comprobar headers SPF=pass / DKIM=pass / DMARC=pass.

## 5. Cron jobs · Recurrencia

- [ ] Crear Vercel Cron `/api/cron/recurrence` daily 06:00 UTC
      (ver [vercel-cron.md](./vercel-cron.md)).
- [ ] Disparar manualmente desde Dashboard → Logs OK (200).
- [ ] Confirmar `lastGeneratedAt` actualizado en `RecurrenceRule`.

## 6. Observabilidad y alertas

- [ ] Activar Vercel Analytics + Speed Insights.
- [ ] Conectar Supabase → Logs Drain (Logflare/Datadog opcional).
- [ ] Configurar alerta "Function Error rate > 5% / 5m".
- [ ] Configurar alerta "Function P95 > 2s / 10m".
- [ ] Pinear el endpoint `/api/health` en uptime monitor (status checks Vercel).

## 7. Seguridad complementaria

- [ ] Forzar HTTPS y HSTS en el dominio (Vercel lo hace por defecto).
- [ ] Rotar `AUTH_SECRET` cada 90 días y registrar fecha en este doc.
- [ ] Rotar `CRON_SECRET` cada 90 días.
- [ ] Auditar `ApiToken` activos cada release: revocar tokens dormidos > 60d.
- [ ] Activar 2FA TOTP para todos los usuarios SUPER_ADMIN (`User.twoFactorSecret`).
- [ ] Revisar `pg_policies` tras cada migración Prisma — añadir RLS para
      tablas nuevas en una migración follow-up.

## 8. Backups y recuperación

- [ ] Confirmar que Supabase tiene PITR (Point-in-Time Recovery) plan Pro+.
- [ ] Programar export semanal `pg_dump` en S3/Drive UTD.
- [ ] Probar restore en proyecto staging cada trimestre.

## 9. Documentación viva

- [ ] Linkear esta checklist desde el wiki interno de UTD.
- [ ] Versionar cualquier secret rotation con commit `chore(ops): rotate <secret>`.
- [ ] Actualizar este doc cuando se añada un nuevo provider/feature.

## 10. Go-live

- [ ] Smoke test: login, crear proyecto, crear task, capturar baseline.
- [ ] Smoke test: enviar formulario público desde anónimo.
- [ ] Smoke test: cron de recurrencia genera tasks esperadas.
- [ ] Comunicar go-live al equipo (canal `#avante-utd`).
- [ ] Marcar fecha de go-live en `project_followupgantt.md`.

## Referencias

- [oauth-providers.md](./oauth-providers.md)
- [resend-domain.md](./resend-domain.md)
- [vercel-cron.md](./vercel-cron.md)
- [rls-policies.md](./rls-policies.md)
