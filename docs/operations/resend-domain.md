# Resend · verificación de dominio `complejoavante.com`

Configura el envío de correo transaccional desde
`notifications@complejoavante.com`. Mientras el dominio no esté
verificado, el helper `src/lib/email/resend.ts` cae a sandbox
(`onboarding@resend.dev`) y sólo entrega al dueño de la cuenta Resend.

## Resumen

| Variable          | Valor producción                                        |
| ----------------- | -------------------------------------------------------- |
| `RESEND_API_KEY`  | `re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`                    |
| `EMAIL_FROM`      | `FollowupGantt <notifications@complejoavante.com>`       |

Dashboard Resend: <https://resend.com/domains>.

## Pasos

### 1. Crear API Key

1. Acceder a Resend → `API Keys → + Create API Key`.
2. Name: `FollowupGantt · Production`.
3. Permission: **Sending access** (mínimo necesario; no dar full).
4. Domain: dejar "All domains" hasta que el dominio esté verificado;
   después restringir al dominio verificado.
5. Copiar la key (sólo se muestra una vez) → guardar en Vercel:

```bash
# Vercel → Settings → Environment Variables → Production
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 2. Añadir dominio en Resend

1. `Domains → + Add Domain`.
2. Domain: `complejoavante.com`.
3. Region: `us-east-1` (o la más cercana al backend).
4. Resend muestra los DNS records a configurar — siguen en el paso 3.

### 3. Configurar DNS en `complejoavante.com`

Editar la zona DNS (Cloudflare / Route53 / proveedor actual) y añadir
los registros que muestra Resend. Valores típicos:

| Tipo  | Host                          | Valor                                                              | TTL     |
| ----- | ----------------------------- | ------------------------------------------------------------------ | ------- |
| MX    | `send.complejoavante.com`     | `feedback-smtp.us-east-1.amazonses.com` (priority 10)              | 3600    |
| TXT   | `send.complejoavante.com`     | `v=spf1 include:amazonses.com ~all`                                | 3600    |
| TXT   | `resend._domainkey.complejoavante.com` | (clave DKIM larga que entrega Resend; copiar tal cual)    | 3600    |

> Los nombres exactos pueden cambiar — usa SIEMPRE los valores que
> aparecen en el panel "DNS records" del dominio en Resend, no copiar
> y pegar de aquí.

Recomendado además (no requerido por Resend pero sí para entregabilidad):

| Tipo | Host                           | Valor                                                                          |
| ---- | ------------------------------ | ------------------------------------------------------------------------------ |
| TXT  | `_dmarc.complejoavante.com`    | `v=DMARC1; p=quarantine; rua=mailto:dmarc@complejoavante.com; pct=100; aspf=s` |

### 4. Verificar

1. En Resend, click `Verify DNS records`. Estado debe pasar a **Verified**
   en pocos minutos (puede tardar hasta 24h por TTL/propagación).
2. Comprobar manualmente:

```bash
dig MX  send.complejoavante.com           +short
dig TXT send.complejoavante.com           +short
dig TXT resend._domainkey.complejoavante.com +short
dig TXT _dmarc.complejoavante.com         +short
```

3. Test envío:

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "FollowupGantt <notifications@complejoavante.com>",
    "to": "emartinez@complejoavante.com",
    "subject": "Resend prod check",
    "text": "Si llegó este correo, el dominio está verificado."
  }'
```

4. Inspeccionar headers en el correo recibido — deben mostrar
   `dkim=pass`, `spf=pass`, `dmarc=pass`.

### 5. Actualizar env var en Vercel

Una vez verificado:

```bash
EMAIL_FROM=FollowupGantt <notifications@complejoavante.com>
```

Redeploy para que la app tome la variable. La función
`sendMentionNotification` y demás callers usan `EMAIL_FROM` directamente.

## Troubleshooting

| Síntoma                                                        | Diagnóstico                                                  | Fix                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| Resend muestra `Pending` indefinidamente                       | DNS no propagado                                             | Esperar 1h y `dig` cada record. Reducir TTL si es muy alto.        |
| Correos llegan a Spam                                          | Falta DMARC o DKIM mal copiado                               | Re-verificar valores DKIM/DMARC; activar BIMI a futuro.            |
| Error `403 The domain is not verified`                          | App envía a prod con dominio no verificado                   | Revertir `EMAIL_FROM` al sandbox de Resend hasta resolver DNS.     |
| Bounce silencioso para emails @gmail.com                       | Política DMARC del receptor estricta                         | Confirmar SPF + DKIM alineados; usar tabla `dmarcian.com`.         |

## Rotación

- Rotar `RESEND_API_KEY` cada 90 días.
- Si se compromete la key, revocar en Resend → Settings → API Keys → `…` → `Revoke`.
- Crear key nueva, sobreescribir env var, redeploy. Sin downtime: la
  key vieja sigue activa hasta que se revoca.
