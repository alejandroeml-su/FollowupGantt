# Email-to-Task (Email ClickApp) — Operación

Wave **R4 · US-7.4**. Endpoint: `POST /api/inbound/email`.

Esta integración convierte cualquier email enviado al alias de un proyecto
en una tarea (o comentario, si el asunto contiene `[#MNEMONIC]`).

---

## 1. Variables de entorno

| Variable                    | Obligatoria | Descripción                                                                                  |
|-----------------------------|-------------|----------------------------------------------------------------------------------------------|
| `INBOUND_EMAIL_DOMAIN`      | Sí          | Dominio del alias. Ej: `sync.complejoavante.com`. Sin barra ni protocolo.                    |
| `SENDGRID_INBOUND_SECRET`   | Sí          | Secret arbitrario (≥ 24 chars, alfanumérico). Se pasa en la URL de SendGrid como `?secret=`. |
| `NEXT_PUBLIC_SUPABASE_URL`  | Reusado     | Para subir adjuntos al bucket `attachments` (ya configurado por Wave P8-4).                  |
| `SUPABASE_SERVICE_ROLE_KEY` | Reusado     | Para escribir en Storage bypaseando RLS.                                                      |

Setear en Vercel (`Production` + `Preview`):

```
INBOUND_EMAIL_DOMAIN=sync.complejoavante.com
SENDGRID_INBOUND_SECRET=<openssl rand -hex 24>
```

---

## 2. DNS — Registro MX

En el panel del dominio (Cloudflare / GoDaddy / etc.), agregar:

```
Tipo: MX
Nombre: sync       (subdominio elegido; resultado: sync.complejoavante.com)
Valor: mx.sendgrid.net
Prioridad: 10
TTL: Auto
```

> Si el dominio principal `complejoavante.com` ya tiene MX (M365 para
> empleados), **NO** lo modifiques. Usa un subdominio dedicado (`sync.`)
> exclusivo para el inbound parse.

Validación: tras propagación (5-30 min):

```
dig MX sync.complejoavante.com +short
# 10 mx.sendgrid.net.
```

---

## 3. SendGrid · Inbound Parse Webhook

Panel SendGrid → **Settings → Inbound Parse → Add Host & URL**:

| Campo            | Valor                                                                      |
|------------------|----------------------------------------------------------------------------|
| Receiving Domain | `sync.complejoavante.com`                                                  |
| Subdomain        | (vacío — usamos el dominio completo)                                       |
| Destination URL  | `https://followup-gantt-beta.vercel.app/api/inbound/email?secret=<TOKEN>` |

Marcar:
- [x] **Check incoming emails for spam** — pone `spam_score` en el payload; el handler descarta `> 5`.
- [x] **POST the raw, full MIME message** — no recomendado; nuestro parser
      asume el modo por defecto (`text`, `html`, `attachmentN` separados).

Reemplaza `<TOKEN>` por el valor de `SENDGRID_INBOUND_SECRET`. SendGrid
NO firma de forma nativa el payload, así que validamos el secret como
query param.

---

## 4. Alias por proyecto

El alias `inbox+<slug>@<INBOUND_EMAIL_DOMAIN>` se genera automáticamente
en `createProject` (server action `src/lib/actions.ts`). Donde:

- `<slug>` es el nombre del proyecto en lowercase, sin acentos, sólo
  `[a-z0-9-]`, max 32 chars.
- Si colisiona, se intenta con sufijo numérico (`-1`, `-2`, ...).

El alias es visible y copiable desde `/settings/integrations` en la card
**Email-to-Task**.

### Backfill de proyectos pre-existentes

Para proyectos creados antes de esta migración, el alias queda `NULL`.
Aplicar el alias manualmente via Prisma Studio o SQL:

```sql
UPDATE "Project"
SET "inboundEmailAlias" = 'inbox+' || lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) || '@sync.complejoavante.com'
WHERE "inboundEmailAlias" IS NULL;
```

> ⚠️ Esto puede generar colisiones; validar con
> `SELECT count(*), "inboundEmailAlias" FROM "Project" GROUP BY 1 ORDER BY 1 DESC;`

---

## 5. Flujo del usuario final

### 5.1 Crear tarea nueva

1. Componer email a `inbox+myproj@sync.complejoavante.com`.
2. Asunto = título de la tarea.
3. Cuerpo = descripción.
4. Adjuntos opcionales (≤ 25 MB c/u; cap de SendGrid).
5. Recibirás la tarea en `/list` del proyecto `myproj`, con status `TODO`,
   prioridad `MEDIUM`, tipo `AGILE_STORY` (default), y tu user como
   assignee si tu email corresponde a un User registrado.

### 5.2 Agregar comentario a tarea existente

1. Incluir `[#MNEMONIC]` en el asunto, ej.
   `Re: pruebas finales [#PROJ-123]`.
2. El cuerpo entero queda como comentario en la tarea.

### 5.3 Remitente externo (guest)

Si el `From` del email no corresponde a ningún `User.email` registrado:
- El email se prefija con `(De: Nombre <email>)` en el body / comentario.
- `authorId` queda `NULL` en `Comment`.
- `assigneeId` queda `NULL` en `Task` nueva.

---

## 6. Errores comunes (cómo investigar)

Toda llamada se persiste en la tabla `InboundEmail` con un `status`:

| status      | Significado                                                            |
|-------------|------------------------------------------------------------------------|
| `PENDING`   | Estado intermedio; nunca debería persistir más de unos segundos.       |
| `PROCESSED` | Se creó la tarea o el comentario. `taskId` / `commentId` están llenos. |
| `FAILED`    | Algo falló. `errorMsg` contiene el detalle.                            |

Códigos de `errorMsg` esperados (los emite `processInboundEmail`):

- `[PROJECT_NOT_FOUND]` — el alias no existe (proyecto borrado o slug typo).
- `[TASK_NOT_FOUND]` — el mnemonic del subject no pertenece al proyecto.
- `[SPAM_REJECTED]` — score SendGrid `> 5`.
- `[ATTACHMENT_TOO_LARGE]` — solo en logs (no se persiste); el resto del
  email sí queda procesado.
- `[PERSIST_FAILED]` — error inesperado de BD/Storage. Reintentar manualmente.

### Reproceso manual

Para reintentar un `FAILED` (después de corregir el alias, etc.):

```sql
SELECT id, subject, errorMsg FROM "InboundEmail"
WHERE status = 'FAILED' ORDER BY "receivedAt" DESC LIMIT 20;
```

Actualmente NO hay UI para retry — deuda registrada. Se puede
reconstruir el `ParsedInboundEmail` desde `bodyText` + `bodyHtml` + el
`projectId` y llamar manualmente `processInboundEmail` desde un script.

---

## 7. Seguridad

- **Autenticación**: secret en query/header. NO usar el endpoint sin
  configurar `SENDGRID_INBOUND_SECRET` — la ruta devuelve 401.
- **Spam gate**: SendGrid scores; threshold 5 (configurable en código).
- **HTML sanitization**: el body HTML se stripea a texto plano antes de
  persistir en `Task.description` / `Comment.content`. El HTML crudo
  queda en `InboundEmail.bodyHtml` para auditoría.
- **Tamaño**: payload bruto cap 35 MB (SendGrid impone 30 MB).
- **PII**: el `From` se loguea sin redactar — necesario para matchear
  User. Si entra como guest, el email queda visible en el comentario.
- **RBAC de lectura**: la tabla `InboundEmail` no expone PII a usuarios
  finales (sólo backend / `/audit-log`). Si en el futuro se agrega una
  UI de "bandeja de entrada", aplicar `resolveProjectVisibility`.

---

## 8. Deuda registrada

- [ ] UI de retry para `InboundEmail.status = FAILED`.
- [ ] Dedup por `Message-ID` para resistir replays raros de SendGrid.
- [ ] Threading: detectar `In-Reply-To` y enlazar al comentario padre.
- [ ] Validar SPF/DKIM del remitente para reducir spoofing antes del
      matcheo con `User.email`.
- [ ] Soporte para IMAP polling (Opción B del documento US) como fallback
      cuando SendGrid no es viable.
