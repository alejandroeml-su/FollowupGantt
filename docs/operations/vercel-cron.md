# Vercel Cron · `/api/cron/recurrence`

Programa la ejecución diaria de `scheduleAll` (Ola P2 · P2-3) que
materializa instancias futuras de `RecurrenceRule` como `Task` reales.
El endpoint vive en `src/app/api/cron/recurrence/route.ts` y exige
header `Authorization: Bearer ${CRON_SECRET}` para todo entorno
distinto de loopback.

## Resumen

| Campo        | Valor                                              |
| ------------ | -------------------------------------------------- |
| Path         | `/api/cron/recurrence`                             |
| Método       | `GET` (también acepta `POST`)                      |
| Frecuencia   | Diaria, 06:00 UTC (≈ 00:00 CDMX UTC-6)             |
| Cron expr    | `0 6 * * *`                                        |
| Auth header  | `Authorization: Bearer ${CRON_SECRET}`             |

## 1. Generar `CRON_SECRET`

```bash
# 32 bytes random hex (64 chars)
openssl rand -hex 32
```

Guardar el valor en Vercel:

```text
Vercel → Project → Settings → Environment Variables → Production
CRON_SECRET=<hex de 64 chars>
```

> Vercel Cron envía automáticamente el header `Authorization: Bearer
> <CRON_SECRET>` cuando esa env var existe en el proyecto. **No es
> necesario hardcodearlo en el cron config.**

## 2. Configurar Vercel Cron

### Opción A · `vercel.json` (recomendado)

Crear/editar `vercel.json` en la raíz del repo:

```json
{
  "crons": [
    {
      "path": "/api/cron/recurrence",
      "schedule": "0 6 * * *"
    }
  ]
}
```

Commitear y desplegar a producción. Vercel detecta el bloque `crons`
durante el build y registra el job automáticamente.

### Opción B · Dashboard

1. `Vercel → Project → Cron Jobs → + Create cron job`.
2. Path: `/api/cron/recurrence`.
3. Schedule: `0 6 * * *`.
4. Environment: `Production` solamente (no preview).
5. Save.

### Verificar

`Vercel → Project → Cron Jobs` debe mostrar:

```
/api/cron/recurrence   0 6 * * *   Production   Active
```

## 3. Disparar manualmente

Útil para smoke test post-deploy o backfill catch-up:

```bash
# Desde la consola Vercel hay botón "Run now"; vía curl:
curl -X GET https://gantt.complejoavante.com/api/cron/recurrence \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Accept: application/json"
```

Respuesta esperada (200):

```json
{
  "ok": true,
  "rulesProcessed": 12,
  "tasksCreated": 8,
  "skipped": 4
}
```

## 4. Observabilidad

- `Vercel → Project → Logs → Cron`: filtra por `path:"/api/cron/recurrence"`.
- Latencia esperada: < 5s para < 200 reglas activas.
- Alerta sugerida: si la última invocación devuelve `status >= 400`
  más de 2 veces seguidas, notificar a `#avante-utd`.

Tabla de troubleshooting:

| Síntoma                                | Diagnóstico                                            | Fix                                                         |
| -------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| 401 Unauthorized en logs               | `CRON_SECRET` no coincide o no está seteada            | Re-set en Vercel y redeploy. El header lo añade Vercel.     |
| 500 con `[RECURRENCE_FAIL]`            | Error en `scheduleAll` (DB / Prisma)                   | Inspeccionar logs Vercel + Supabase. Re-run manual.         |
| Tasks duplicadas                       | Dos invocaciones simultáneas (no debería pasar en cron) | Confirmar que `(recurrenceRuleId, occurrenceDate)` único.   |
| 504 Timeout                            | > 60s ejecutando (limite Hobby; Pro 300s)              | Considerar paginación / mover a job worker.                 |

## 5. Rotación de `CRON_SECRET`

Cada 90 días o ante sospecha de fuga:

1. Generar secret nuevo: `openssl rand -hex 32`.
2. Sobrescribir env var en Vercel.
3. Trigger redeploy. Vercel inyecta el nuevo `Authorization` en la
   próxima invocación cron — sin downtime real.
4. Apuntar la rotación: `chore(ops): rotate CRON_SECRET 2026-08-04`.

## 6. Crons futuros

Cuando se añadan más jobs (ej. purga de `AuditEvent` > 90 días, digest
de notificaciones, recompute de OKRs), extender el array `crons` en
`vercel.json`. Mantener cada job idempotente y bajo el límite de 5min.

```jsonc
{
  "crons": [
    { "path": "/api/cron/recurrence",     "schedule": "0 6 * * *"   },
    { "path": "/api/cron/audit-purge",    "schedule": "0 3 * * 0"   }, // ej. domingos 03:00 UTC
    { "path": "/api/cron/digest-weekly",  "schedule": "0 14 * * 1"  }  // ej. lunes 14:00 UTC
  ]
}
```
