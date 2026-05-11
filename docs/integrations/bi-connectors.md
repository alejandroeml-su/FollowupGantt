# BI Export Connector — guía de uso

> Wave R3.0 Fase 4.2 · Permite a **Tableau · Power BI · Looker Studio · Excel** consumir datos de Sync (FollowupGantt) sin necesidad de conexión directa a la base de datos.

Sync expone dos superficies bajo `/api/v2/`:

1. **CSV feeds** (`/api/v2/exports/*.csv`) — refresco programado en cualquier BI tool que soporte "URL CSV".
2. **OData v4** (`/api/v2/odata/`) — descubrimiento automático en Tableau y Power BI (recomendado).

Ambas requieren un **API key** con scope `read:exports`. La key se crea desde **Configuración → API Keys** y se incluye en el header `Authorization: Bearer <key>` (CSV) o en el header / query `$apikey` (OData).

---

## 1. Endpoints CSV

| URL | Filtros opcionales | Descripción |
|---|---|---|
| `GET /api/v2/exports/projects.csv` | `status`, `methodology`, `cursor`, `limit` | Lista de proyectos con manager, área, gerencia, budget, CPI/SPI. |
| `GET /api/v2/exports/tasks.csv` | `projectId`, `assigneeId`, `status`, `cursor`, `limit` | Tareas con sprint/epic/assignee resueltos por nombre. |
| `GET /api/v2/exports/risks.csv` | `projectId`, `severity` (`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`), `cursor`, `limit` | Riesgos con `score` y `severity` calculados (matriz 5×5 PMBOK). |
| `GET /api/v2/exports/evm-history.csv` | `projectId`, `since` (ISO date), `cursor`, `limit` | Histórico de `EVMSnapshot` para curvas-S externas (PV/EV/AC/EAC/CPI/SPI). |
| `GET /api/v2/exports/portfolio-kpis.csv` | (ninguno · agregado) | Snapshot por proyecto: % completado, riesgos abiertos/críticos, defectos críticos, CPI/SPI, budget. |

### Headers de respuesta

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="<entity>-<YYYY-MM-DD>.csv"`
- `X-Next-Cursor: <id>` — si la respuesta fue paginada (>limit rows), úsalo como `?cursor=<id>` en la siguiente request.
- Caps: `limit` por default = `5000`, máximo `5000`. Para datasets grandes, paginar con `cursor`.

### Encoding

UTF-8 con **BOM** prependido — Excel detecta el encoding al abrir directamente. Power Query lo strippea automáticamente.

### Ejemplos `curl`

```bash
# Proyectos activos (Scrum) — 100 primeros
curl -H "Authorization: Bearer sk_xxxxxxxx_yyyyyyyyyyyy" \
  "https://sync.complejoavante.com/api/v2/exports/projects.csv?status=ACTIVE&methodology=SCRUM&limit=100" \
  -o projects.csv

# Riesgos críticos del proyecto X
curl -H "Authorization: Bearer sk_xxxxxxxx_yyyyyyyyyyyy" \
  "https://sync.complejoavante.com/api/v2/exports/risks.csv?projectId=abc-123&severity=CRITICAL" \
  -o risks-criticos.csv

# Curva-S EVM desde enero 2026
curl -H "Authorization: Bearer sk_xxxxxxxx_yyyyyyyyyyyy" \
  "https://sync.complejoavante.com/api/v2/exports/evm-history.csv?projectId=abc-123&since=2026-01-01" \
  -o evm-history.csv

# KPIs consolidados portafolio
curl -H "Authorization: Bearer sk_xxxxxxxx_yyyyyyyyyyyy" \
  "https://sync.complejoavante.com/api/v2/exports/portfolio-kpis.csv" \
  -o portfolio-kpis.csv
```

---

## 2. OData v4

URL base: `https://sync.complejoavante.com/api/v2/odata/`

| URL | Descripción |
|---|---|
| `GET /api/v2/odata/` | Service Document (lista de entity sets). **Público** (sin auth). |
| `GET /api/v2/odata/$metadata` | EDMX XML con el schema (4 entities). **Público**. |
| `GET /api/v2/odata/Projects` | Proyectos del workspace. **Auth obligatoria**. |
| `GET /api/v2/odata/Tasks` | Tareas. **Auth obligatoria**. |
| `GET /api/v2/odata/Risks` | Riesgos con `score` y `severity` derivados. **Auth obligatoria**. |
| `GET /api/v2/odata/EVMSnapshots` | EVM histórico. **Auth obligatoria**. |

### Query options soportadas

| Option | Soporte | Notas |
|---|---|---|
| `$top` | ✅ | Default 100, máximo 1000. |
| `$skip` | ✅ | Para paginación tipo offset. |
| `$filter` | ✅ parcial | Operadores `eq`, `ne`, `gt`, `ge`, `lt`, `le` + `and`. Sin `or`, sin paréntesis, sin funciones (`contains`, `startswith`). |
| `$select` | ❌ | Devolvemos todos los campos del entity. Follow-up. |
| `$orderby` | ❌ | Orden fijo por `id` ascendente. Follow-up. |
| `$expand` | ❌ | Sin joins. Use el endpoint correspondiente al recurso embebido. Follow-up. |
| `$count` | ❌ | Sin count exacto inline. Follow-up. |
| `$search` | ❌ | No soportado. |

### Auth dual

Para herramientas que **no permiten** enviar headers personalizados:

```text
GET /api/v2/odata/Projects?$apikey=sk_xxxxxxxx_yyyyyyyyyyyy
```

Para todas las demás (recomendado):

```text
Authorization: Bearer sk_xxxxxxxx_yyyyyyyyyyyy
```

### Ejemplos de `$filter`

```text
# Proyectos activos
/api/v2/odata/Projects?$filter=status eq 'ACTIVE'

# Tareas con CPI bajo y status no-DONE
/api/v2/odata/Tasks?$filter=progress lt 50 and status ne 'DONE'

# Riesgos con probabilidad ≥ 4
/api/v2/odata/Risks?$filter=probability ge 4

# Snapshots EVM desde 2026-01-01
/api/v2/odata/EVMSnapshots?$filter=snapshotDate ge 2026-01-01T00:00:00Z
```

### Ejemplos `curl`

```bash
# Service document (público)
curl https://sync.complejoavante.com/api/v2/odata/

# Schema EDMX (público)
curl https://sync.complejoavante.com/api/v2/odata/\$metadata

# Top 50 proyectos ACTIVE
curl -H "Authorization: Bearer sk_xxxxxxxx_yyyyyyyyyyyy" \
  "https://sync.complejoavante.com/api/v2/odata/Projects?\$filter=status%20eq%20'ACTIVE'&\$top=50"

# Riesgos CRITICAL (score >= 15 en matriz 5×5)
curl -H "Authorization: Bearer sk_xxxxxxxx_yyyyyyyyyyyy" \
  "https://sync.complejoavante.com/api/v2/odata/Risks?\$filter=probability%20ge%204%20and%20impact%20ge%204"
```

> Nota: en URLs de shell escapamos `$` con `\$` y los espacios con `%20`. Los BI tools encodean automáticamente.

---

## 3. Setup en cada BI tool

### 3.1 Tableau Desktop / Cloud

1. **Connect** → **To a Server** → **OData**.
2. **Server URL**: `https://sync.complejoavante.com/api/v2/odata/`
3. **Authentication**: Username / Password.
   - **Username**: cualquier string (Tableau exige uno, lo ignoramos).
   - **Password**: `sk_xxxxxxxx_yyyyyyyyyyyy` (la API key cruda).
   - Tableau lo envía como `Authorization: Basic <base64>`. Internamente fallback al header — si tu plan de Tableau soporta **Custom HTTP Headers**, usa `Authorization: Bearer <key>` directamente; si no, agrega `?$apikey=<key>` al URL.
4. Tras conectar, Tableau lista los 4 entity sets (Projects, Tasks, Risks, EVMSnapshots). Arrastra el deseado al canvas.
5. **Refresh schedule**: Server / Cloud → Schedule → cada N horas.

### 3.2 Power BI Desktop

**Opción A — OData (recomendada)**

1. **Home** → **Get data** → **OData feed**.
2. URL: `https://sync.complejoavante.com/api/v2/odata/`
3. Credentials → **Anonymous** y luego en **Advanced editor** del query agregar:

```m
let
  Source = OData.Feed(
    "https://sync.complejoavante.com/api/v2/odata/",
    null,
    [Headers = [Authorization = "Bearer sk_xxxxxxxx_yyyyyyyyyyyy"]]
  )
in Source
```

**Opción B — CSV**

1. **Home** → **Get data** → **Web**.
2. **Advanced** → URL: `https://sync.complejoavante.com/api/v2/exports/tasks.csv` + Header `Authorization` = `Bearer sk_xxxx...`.
3. Power Query detecta CSV automáticamente.

**Refresh**: Power BI Service → Dataset → Settings → Scheduled refresh + Gateway (si la key vive en variables on-premises).

### 3.3 Excel (Power Query)

1. **Data** → **Get Data** → **From Other Sources** → **From Web**.
2. **Advanced** → URL + Header `Authorization: Bearer sk_xxxx...`.
3. Excel detecta CSV/JSON; carga a tabla.
4. **Data** → **Refresh All** o **Queries & Connections** → schedule.

### 3.4 Looker Studio (Google Data Studio)

Looker Studio NO soporta OData nativo. Usar el conector **"URL CSV"** de la comunidad:

1. **Add data** → buscar **"URL CSV"** (community connector).
2. URL completa: `https://sync.complejoavante.com/api/v2/exports/portfolio-kpis.csv`
3. Sin auth nativa → agregar la key como **query param** mediante un **OAuth Token Proxy** o usar el endpoint con un short-lived ApiKey rotado mensualmente.
4. **Scheduled refresh**: data source → schedule → cada N horas.

> Limitación conocida: Looker Studio no permite headers HTTP en URL CSV. Si necesitas autenticación, expone un workaround:
> - genera un API key rotada y agrega un `?$apikey=<key>` query param que el endpoint OData acepta (los endpoints `*.csv` no lo aceptan por seguridad — usar OData en su lugar).

---

## 4. Schema reference

### `Project`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | String | UUID. |
| `name` | String | |
| `status` | String | `PLANNING` / `ACTIVE` / `ON_HOLD` / `COMPLETED`. |
| `methodology` | String | `SCRUM` / `PMI` / `HYBRID`. |
| `cpi`, `spi` | Double | Cost / Schedule Performance Index. |
| `budget` | Decimal(14,2) | BAC en `budgetCurrency`. |
| `budgetCurrency` | String | ISO 4217. |
| `managerId`, `areaId`, `workspaceId` | String | UUIDs FK. |
| `createdAt`, `updatedAt` | DateTimeOffset | ISO-8601 UTC. |

CSV adicionalmente expone `manager`, `gerencia`, `area`, `startDate`, `endDate` con joins resueltos.

### `Task`

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `mnemonic`, `title` | String | |
| `status`, `priority` | String | Enums (`TODO`/`IN_PROGRESS`/`IN_REVIEW`/`DONE` etc). |
| `storyPoints` | Int32 | Fibonacci (nullable PMI). |
| `plannedValue`, `actualCost`, `earnedValue` | Double | EVM por tarea. |
| `progress` | Int32 | 0..100. |
| `projectId`, `sprintId`, `epicId`, `assigneeId` | String | UUIDs. |
| `startDate`, `endDate` | DateTimeOffset | Gantt. |
| `createdAt`, `updatedAt` | DateTimeOffset | |

### `Risk`

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `projectId`, `title` | String | |
| `probability`, `impact` | Int32 | 1..5 (PMBOK matriz). |
| `score` | Int32 | **Calculado** = probability × impact. |
| `severity` | String | **Calculado** = `LOW` / `MEDIUM` / `HIGH` / `CRITICAL`. |
| `status` | String | `OPEN` / `MITIGATING` / `ACCEPTED` / `CLOSED`. |
| `source` | String | `MANUAL` / `HEURISTIC` / `BRAIN_AI` / `IMPORTED`. |
| `detectedAt`, `closedAt` | DateTimeOffset | |

### `EVMSnapshot`

| Campo | Tipo | Notas |
|---|---|---|
| `id`, `projectId` | String | |
| `snapshotDate` | DateTimeOffset | |
| `plannedValue`, `earnedValue`, `actualCost` | Decimal(14,2) | PV/EV/AC. |
| `budgetAtCompletion`, `estimateAtCompletion`, `varianceAtCompletion` | Decimal(14,2) | BAC/EAC/VAC. |
| `cpi`, `spi` | Double | |
| `createdAt` | DateTimeOffset | |

### `Portfolio KPIs` (solo CSV)

| Campo | Tipo | Notas |
|---|---|---|
| `projectId`, `project`, `status`, `methodology` | String | |
| `cpi`, `spi` | Double | |
| `totalTasks`, `doneTasks` | Int | Conteo de Tasks por proyecto. |
| `completionPct` | Double | `100 × doneTasks / totalTasks` (1 decimal). |
| `openRisks`, `criticalRisks` | Int | Status ∈ {OPEN, MITIGATING}. CRITICAL = severity computada. |
| `openDefects`, `criticalDefects` | Int | Status ∈ {OPEN, IN_REVIEW}. |
| `totalBudget`, `budgetCurrency` | Decimal / String | BAC. |

---

## 5. Rate limits y caps

- Rate limit por API key: **60/min** y **1000/hora** (compartido con el resto de `/api/v2`).
- Cap por request CSV: 5000 filas. Páginar con `cursor` (header `X-Next-Cursor` de la respuesta).
- Cap por request OData: 1000 filas (`$top` máximo). Usar `$skip` para offset.

Cuando se exceda el rate limit, la respuesta es `429 RATE_LIMITED` con header `Retry-After` en segundos.

---

## 6. Follow-ups conocidos

- `$select`, `$orderby`, `$expand`, `$count` en OData.
- `or` y paréntesis anidados en `$filter`.
- Endpoints CSV para `Sprint`, `Epic`, `Defect`, `Inspection`.
- Bulk download (ZIP de todas las CSV) con un único endpoint `/exports/full.zip`.
- Signed URLs cortas para Looker Studio sin exponer la API key.
