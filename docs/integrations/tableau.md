# Tableau Web Data Connector — Sync (FollowupGantt)

Wave R3.0 · Fase 4 · Equipo **P21-B**.

Sync expone un **Web Data Connector** v3 (HTML estático + JS embebido) que
permite a Tableau Desktop importar 5 datasets del workspace autenticado vía
API key Bearer (scope `read:exports`).

---

## 1. Quickstart en Tableau Desktop

1. Abre **Tableau Desktop** (versión ≥ 2021.4).
2. Menú lateral → **Connect → To a Server → Web Data Connector**.
3. Pega la URL pública del connector:

   ```
   https://sync.avante.com/wdc/sync-tableau.html
   ```

4. En el formulario:
   - **API Key (Bearer)** — pega el token completo (`sk_<prefix>_<secret>`).
   - **Dataset** — elige uno: Projects, Tasks, Sprints, Risks o Audit.
   - **Base URL** — déjalo vacío; auto-detecta `window.location.origin`.
     Override solo si apuntas a staging (`https://staging.sync.avante.com`).
5. Click **Get Data**. Tableau extrae el dataset paginando automáticamente
   hasta agotar las filas (`nextCursor === null`).

Cada extract corre como **refresh manual** desde Tableau Desktop (View →
Refresh All Extracts). Si necesitas refresh programado, publica el data
source en Tableau Server / Cloud — el connector se reutiliza tal cual.

---

## 2. Generar el API key

1. Inicia sesión en Sync.
2. Ve a **/admin/api-keys** (rol mínimo: OWNER del workspace o SUPER_ADMIN).
3. Click **Crear nueva** → marca el scope **`read:exports`**.
4. Copia el plaintext mostrado **una sola vez** — luego solo verás el prefix.

El token tiene formato `sk_<8 hex>_<43 base64url>`. Auth via header
`Authorization: Bearer sk_xxxxxxxx_xxxxxxxx`.

---

## 3. Datasets disponibles

| Dataset    | Endpoint                                       | Columnas clave                                          |
|------------|------------------------------------------------|---------------------------------------------------------|
| `projects` | `GET /api/integrations/tableau/projects`       | id, name, status, methodology, manager, cpi, spi, budget |
| `tasks`    | `GET /api/integrations/tableau/tasks`          | id, projectName, sprintName, assigneeName, EVM, dates    |
| `sprints`  | `GET /api/integrations/tableau/sprints`        | id, projectName, **state** (PLANNING/ACTIVE/CLOSED)      |
| `risks`    | `GET /api/integrations/tableau/risks`          | id, score, **severity** (LOW/MEDIUM/HIGH/CRITICAL)       |
| `audit`    | `GET /api/integrations/tableau/audit`          | id, action, entityType, actorName, createdAt (90d)       |

Todos los endpoints aceptan los mismos query params:

- `cursor=<lastId>` — paginación.
- `limit=1..5000` — default 5000.

Endpoints específicos exponen filtros adicionales (ver headers de cada
`route.ts`). Tableau-side el WDC siempre fetch sin filtros — usa Tableau
para filtrar tras importar.

Metadata Tableau-compat por dataset:

```
GET /api/integrations/tableau/schema/<dataset>
```

Devuelve `{ id, alias, description, endpoint, columns: [{ id, alias, dataType }] }`
sin requerir auth (mismo trade-off que `$metadata` de OData).

---

## 4. Limitaciones

- **Cap por request**: 5000 filas. Para datasets más grandes el WDC pagina
  automáticamente y aplaza al usuario sólo si el extract supera **200
  páginas** (~1M filas). En ese caso usa el endpoint OData v4 con
  `$top`/`$skip` o exporta a CSV vía `/api/v2/exports/**`.
- **Refresh manual**: Tableau Desktop pide refresh on-demand. Para refresh
  programado, publica el data source en Tableau Server / Cloud.
- **Audit dataset**: limitado a últimos **90 días** por performance. Para
  histórico completo usa el endpoint OData v4 `Audit` (cuando se exponga)
  o el CSV download.
- **Realtime**: el WDC NO usa WebSocket / SSE. Si necesitas streaming
  events a un dashboard, considera el connector PowerBI (#P21-C) con
  DirectQuery o el endpoint de audit-streaming SIEM (R3-E).

---

## 5. Decisión técnica: WDC v3 vs Tableau Hyper API

Evaluamos tres alternativas:

| Opción                  | Pros                                              | Contras                                                                  |
|-------------------------|---------------------------------------------------|--------------------------------------------------------------------------|
| **WDC v3** (elegido)    | Deploy = un HTML estático. Cero SDK Tableau.      | Cap 5000/req. Solo HTTP polling. No streaming.                          |
| Tableau Hyper API       | Extract `.hyper` ultra-rápido. Compresión nativa. | Requiere Python SDK + Tableau Server. Mucho más infra para mantener.    |
| Tableau REST API        | Server-driven, mejor refresh programado.          | Requiere Tableau Online/Server con licencia. Auth OAuth2 más compleja.  |

**Elegimos WDC v3** porque cumple el SLA de Avante (consumo desde Tableau
Desktop por analistas, refresh diario manual) sin agregar dependencias
operativas. Si en el futuro la BI Team necesita refresh sub-horario o
extracts > 1M filas, migramos a Hyper API como evolución incremental
(los endpoints REST permanecen reutilizables).

---

## 6. Paginación cursor-based (vs offset)

Los endpoints usan `?cursor=<lastId>` en lugar de `?offset=<n>` porque:

- **Performance estable** con datasets grandes — `OFFSET 100000` en
  PostgreSQL escanea todas las filas anteriores; `WHERE id > 'xxx'` usa
  el índice de PK directamente.
- **No skip duplicates** cuando hay inserts concurrentes durante el
  extract (importante para `audit` que tiene write-volume alto).
- **Mismo patrón** que los CSV exports (`/api/v2/exports/**`, #192) y
  los endpoints v2 REST públicos — un único contract.

El JS del WDC trasforma este patrón en una loop transparente: itera
`fetchPage(nextCursor)` hasta que el servidor devuelve `nextCursor: null`.

---

## 7. Audit trail

Cada fetch emite un evento `tableau.dataset_fetched` en `AuditEvent` con
metadata:

```json
{
  "dataset": "projects",
  "rowCount": 1234,
  "hasNextPage": true
}
```

Esto te permite trackear quién extrae qué desde el panel
**/audit-log** filtrando por `action=tableau.dataset_fetched`.

---

## 8. Troubleshooting

| Síntoma                                | Causa probable                                                             |
|----------------------------------------|----------------------------------------------------------------------------|
| `401 INVALID_KEY`                      | Token mal pegado o revocado. Regenera en `/admin/api-keys`.                |
| `403 INSUFFICIENT_SCOPE`               | El API key no tiene `read:exports`. Edita scopes en `/admin/api-keys`.     |
| `429 RATE_LIMITED`                     | Cap 60 req/min por key. Espera `Retry-After` segundos antes de reintentar. |
| Extract se queda en 0 filas            | Verifica que el workspace tenga datos. Prueba el endpoint con `curl`.      |
| Tableau muestra "Cap de páginas"       | Dataset > 1M filas. Migrate a OData o CSV bulk.                            |
| Connector no carga (página en blanco)  | Tableau Desktop < 2021.4 NO soporta WDC v3. Actualiza Tableau.             |

Test manual con curl:

```bash
curl -s -H "Authorization: Bearer sk_xxxxxxxx_xxx" \
     https://sync.avante.com/api/integrations/tableau/projects?limit=10 | jq
```

---

## 9. Setup pendiente al release

- [ ] API key seed con scope `read:exports` para el equipo BI (workflow
      manual desde `/admin/api-keys`).
- [ ] URL pública estable del WDC (`https://sync.avante.com/wdc/sync-tableau.html`).
      Verificar que Vercel sirva `/public/wdc/*.html` sin transformaciones.
- [ ] Documentar el connector en el portal interno de Avante BI.
- [ ] Validar manualmente en Tableau Desktop ≥ 2024.1 antes de anunciar GA.
