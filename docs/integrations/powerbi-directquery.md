# Power BI · DirectQuery sobre Supabase Postgres

> Wave R4-C · DirectQuery Power BI — guía end-to-end para habilitar **DirectQuery** real desde Power BI Desktop / Service contra Sync (FollowupGantt), usando el conector nativo **PostgreSQL** que Power BI incluye desde 2023.

Complementa a `docs/integrations/powerbi.md` (Wave P21-C · OData v4 / Import mode).

---

## Por qué Postgres directo (no OData DirectQuery)

Sync ya expone un feed OData v4 (PR #205 / Wave P21-C). Soporta **Import mode** perfecto pero **no DirectQuery oficial**. Razones:

| Vía | DirectQuery? | Costo / fricción | Mantenimiento |
|---|---|---|---|
| **OData v4 estándar** (este repo) | NO. Microsoft solo lo certifica para Import. | Bajo. | Bajo. |
| **OData v4 con Custom Connector `.mez` y `DirectQuery=true`** | Sí, técnicamente. | Requiere **Power BI Premium** + Visual Studio + Power Query SDK + firma digital + distribución del `.mez` a cada estación. | Alto — cada cambio del schema obliga a rebuild + redistribuir. |
| **PostgreSQL nativo de Power BI** (esta wave) | **Sí, oficial Microsoft desde 2023**. | Cero connector compilado. Power BI Desktop trae el conector PostgreSQL built-in. | Bajo — el schema vive en vistas SQL del lado servidor. |

**Decisión:** exponer **Supabase PostgreSQL directamente** como datasource Power BI, con un rol `powerbi_readonly` con acceso restringido a un schema curado `bi.*` (vistas con joins precalculados, derived fields y **PII redacted**).

Trade-offs aceptados:
- DirectQuery agrega latencia interactiva (cada filtro = round-trip al servidor). El usuario debe estar consciente de no abusar de slicers complejos.
- Algunas funciones DAX/M no foldean (calculated columns, time-intelligence avanzado). En esos casos Power BI puede degradar a "in-memory cache" del subset.
- Refresh real-time pero limitado a ~30s por query (timeout default Power BI Service).

---

## Setup operativo

### 1. Aplicar la migración SQL

```bash
npx prisma migrate deploy
# o, si se aplica manualmente vía Supabase SQL Editor:
# pegar el contenido de prisma/migrations/20260511_r4c_bi_views_powerbi/migration.sql
```

La migración crea:
- Schema `bi` (aislado de `public.*` — el rol read-only NUNCA toca tablas raw).
- 7 vistas: `bi.projects_view`, `bi.tasks_view`, `bi.sprints_view`, `bi.risks_view`, `bi.audit_view`, `bi.evm_snapshots_view`, `bi.allocations_view`.
- Rol `powerbi_readonly` con `NOLOGIN` (sin password — el operador lo setea aparte).
- Grants: `USAGE` sobre el schema + `SELECT` sobre cada vista; `REVOKE ALL` sobre `public`.

### 2. Setear password al rol

```bash
export DATABASE_URL_SUPERUSER='postgresql://postgres:<superuser-pwd>@db.<project>.supabase.co:5432/postgres'
bash scripts/setup-powerbi-readonly-user.sh
```

El script genera un password aleatorio (32 chars), aplica `ALTER ROLE powerbi_readonly LOGIN PASSWORD '...'` y muestra el password UNA vez en stdout. Copiarlo al password manager corporativo. **Rotar cada 90 días** re-ejecutando el script.

### 3. Habilitar conexión Postgres directa

Por default Supabase expone Postgres en `db.<project>.supabase.co:5432` (direct) y `aws-0-<region>.pooler.supabase.com:6543` (pgBouncer pooler). Para DirectQuery recomendamos:

- **Power BI Desktop (dev local):** direct port `5432`. Latencia menor, más simple.
- **Power BI Service (refresh programado / dashboards publicados):**
  - **Opción A:** On-premises Data Gateway instalado en una VM con outbound 5432 al host Supabase.
  - **Opción B:** Whitelist de IPs del Power BI Service (ver lista en https://docs.microsoft.com/power-bi/connect-data/service-azure-and-power-bi#power-bi-ip-addresses-and-fully-qualified-domain-names).

SSL es obligatorio (Supabase lo fuerza). Power BI lo configura por default si el conector Postgres tiene `Encryption = Required`.

### 4. Configurar Power BI Desktop

1. **Home → Get Data → More… → Database → PostgreSQL database**.
2. **Server:** `db.<project>.supabase.co` (o pooler).
3. **Database:** `postgres`.
4. **Data Connectivity mode → DirectQuery** (CRÍTICO — el default es Import).
5. **Advanced options → Command timeout:** 60 minutes (suficiente para queries grandes).
6. **OK** → en el dialog Auth seleccionar **Database** → user `powerbi_readonly` + password del paso 2.
7. **Encryption:** marcar "Encrypt connections" → **OK**.
8. **Navigator:** filtrar por schema `bi` → seleccionar las 7 vistas → **Load**.

(Alternativa: usar el `.pq` empacado de `connectors/powerbi/SyncDirectQueryConnector.pq` si la organización tiene Power BI SDK + firma corporativa.)

---

## Las 7 vistas BI

| Vista | Descripción | Push-down filter primario |
|---|---|---|
| `bi.projects_view` | Proyectos con KPIs EVM (cpi, spi, budget). | `workspace_id` |
| `bi.tasks_view` | Tareas con JOIN Project + assignee (nombre). | `workspace_id`, `project_id`, `status`, `sprint_id` |
| `bi.sprints_view` | Sprints (Scrum) con velocity, capacity, goal. | `workspace_id`, `project_id` |
| `bi.risks_view` | Riesgos con `score = P×I` y `severity` derivados. | `workspace_id`, `project_id`, `severity` |
| `bi.audit_view` | Audit log con IP redacted a /24, **sin** before/after Json. | `workspace_id`, `entity_type`, `created_at` |
| `bi.evm_snapshots_view` | Snapshots EVM (curvas-S PV/EV/AC + EAC/VAC). | `workspace_id`, `project_id`, `snapshot_date` |
| `bi.allocations_view` | Heatmap aplanado: una fila por (user, week, project). | `workspace_id`, `week_start`, `user_id` |

Cada vista incluye `workspace_id` para que el modelo Power BI filtre por workspace **antes** de cargar datos. Esto es el push-down clave para que DirectQuery sea performante.

---

## Networking

### Puerto y SSL

- **Port 5432** (direct connection): conexión persistente al primary. Mejor para queries grandes; cuenta contra el connection limit del plan Supabase.
- **Port 6543** (pgBouncer transaction pool): mejor para concurrencia alta pero **NO soporta prepared statements** ni session-scoped state. Para DirectQuery Power BI, usar **5432**.
- **SSL Mode = require**: Supabase rechaza conexiones sin TLS. Power BI lo activa con el toggle "Encrypt connections".

### Acceso desde Power BI Service

| Modo | Networking required |
|---|---|
| **Power BI Desktop dev** | Outbound 5432 desde el laptop → `db.<project>.supabase.co`. Funciona desde cualquier red con internet. |
| **Power BI Service Pro** (refresh schedule) | On-premises Data Gateway en VM corporativa (Azure/AWS/on-prem). El gateway routea queries de PBI Service → Postgres. |
| **Power BI Service Premium** (P/F sku) | Mismo gateway, pero con SLA mejor y refresh hasta cada 5 min vs 30 min. |

### Rotación de password

- **90 días** (compliance corporativo). Re-correr `scripts/setup-powerbi-readonly-user.sh`.
- Tras rotar, los datasets de Power BI Service requieren re-auth: **Workspace → Dataset → Settings → Data source credentials → Edit credentials**.

---

## Seguridad

### Por qué el rol está aislado a `bi.*`

- `powerbi_readonly` tiene `USAGE` sobre `bi` + `SELECT` sobre las 7 vistas, y NADA más.
- `REVOKE ALL ON SCHEMA public FROM powerbi_readonly` es defensive — Postgres ya bloquea por default, pero lo dejamos explícito.
- Como el rol NO toca `public.*`, no necesita pasar por las políticas RLS de las tablas raw. **Las vistas hacen el "RLS lógico" en su `WHERE`** (en este caso: exponen todo, pero ningún campo sensible).

### PII redacted en TODAS las vistas

| Campo NO expuesto | Razón |
|---|---|
| `User.password` | Hash PBKDF2 — no debe salir del schema `public.User`. |
| `User.email` | PII directo. Solo se expone `User.name` en tasks_view/allocations_view. |
| `User.twoFactorSecret` | Secret 2FA. NUNCA exponer. |
| `Session.token` | Bearer JWT activo. |
| `ApiKey.hash` | Token hashed; expuesto = reuso. |
| `AuditEvent.before/after/metadata` | Json — puede contener snapshots de password pre-hash, headers Authorization, etc. |
| `AuditEvent.ipAddress` (raw) | PII. Se redacta a /24 (último octeto a `.0`). |
| `Project.charter/productGoal/dorTemplate/dodTemplate/communicationsPlan` | Json texto libre — puede incluir info confidencial operativa. |
| `Risk.description/mitigation` | Texto libre operativo. Para narrativa, drill-down al UI Sync. |
| `Sprint.capacityPerUser` | Json con userId → horas — formato técnico sin valor BI. |

### SECURITY INVOKER vs DEFINER

Todas las vistas son **`SECURITY INVOKER`** (default Postgres):
- Cuando `powerbi_readonly` ejecuta `SELECT * FROM bi.projects_view`, Postgres verifica los grants y RLS contra el rol consultante (no contra el dueño de la vista).
- Si en el futuro se activa RLS sobre `Project`/`Task`/etc., las vistas seguirán respetando esas políticas (el rol read-only verá solo lo que su rol permite).
- **NO usar `SECURITY DEFINER`** — eludiría RLS y reabriría el agujero que esta arquitectura cierra.

Trade-off: con INVOKER, si la organización endurece RLS más adelante, hay que asegurar que `powerbi_readonly` tiene policies explícitas (típicamente "bypass RLS para este rol" o "permit-all en schema bi"). Por ahora, RLS no aplica al rol read-only porque no toca `public.*`.

---

## Limitaciones

| Limitación | Workaround |
|---|---|
| **DirectQuery agrega latencia** (cada filtro = query). | Diseñar dashboards con few slicers + agregaciones pre-computadas (medidas DAX en lugar de calculated columns). |
| **Calculated columns con M complejo NO foldean**. | Usar **medidas DAX** (se evalúan en el contexto del query) en lugar de columnas calculadas. |
| **Refresh real-time limitado a ~30s** por query (timeout PBI Service). | Mantener queries simples; usar `score`/`severity` precalculados en `bi.risks_view` en lugar de DAX. |
| **Sin time-intelligence DAX** sobre columnas DirectQuery (no `TOTALYTD`, `SAMEPERIODLASTYEAR`). | Crear una **tabla calendario en Import mode** mezclada con DirectQuery vía **Composite Model**. |
| **Solo workspace_id push-down funciona por default** — el cliente debe agregar `WHERE workspace_id = '<my-ws>'` antes de cargar. | Crear un **Parameter Power BI** llamado `WorkspaceId` y usarlo en cada query M con `Table.SelectRows(_, each [workspace_id] = WorkspaceId)`. |
| **Composite models limitados a Pro+** | Power BI Pro mínimo. Si Free, todo el modelo debe ser DirectQuery. |
| **`audit_view` solo expone `workspace_id` para eventos con actor** (no system). | Eventos system (login fallido, jobs internos) tienen `workspace_id = NULL` — filtrar en el modelo Power BI o aceptar como "cross-workspace events". |

---

## Performance tips

### 1. Crear índices que ayuden al push-down

Las vistas heredan los índices de las tablas base. Para queries Power BI típicos:

```sql
-- Si DirectQuery filtra mucho por workspace + status:
CREATE INDEX IF NOT EXISTS "Project_workspaceId_status_idx"
  ON "Project"("workspaceId", "status");

-- Si filtra tasks por (workspace, status, sprint):
CREATE INDEX IF NOT EXISTS "Task_projectId_status_idx"
  ON "Task"("projectId", "status");
```

Estos índices son optativos — agregar SOLO si EXPLAIN ANALYZE muestra seq scans dolorosos.

### 2. Modo Composite — Calendario Import + Facts DirectQuery

```text
Tabla Calendar (Import, M con CALENDAR de 5 años)  →  Storage: Import
Tabla bi.tasks_view (DirectQuery)                   →  Storage: DirectQuery
Relación: Calendar[Date]  --[1:N]-->  tasks_view[end_date]
```

Permite time-intelligence DAX (`TOTALYTD`, `DATESBETWEEN`) sin cargar los facts a memoria.

### 3. Limitar agresivamente con Parameter

```m
let
    WorkspaceParam = WorkspaceId,  // Parameter Power BI
    Source = PostgreSQL.Database("db.host.supabase.co", "postgres"),
    BI = Source{[Schema="bi"]}[Data],
    Tasks = BI{[Name="tasks_view"]}[Data],
    Filtered = Table.SelectRows(Tasks, each [workspace_id] = WorkspaceParam)
in
    Filtered
```

Power BI traduce el `Table.SelectRows` a `WHERE workspace_id = '...'` en el servidor — el cliente solo recibe las filas de su workspace.

---

## Troubleshooting

### `password authentication failed for user "powerbi_readonly"`

- El rol fue creado por la migración pero quedó NOLOGIN. Re-ejecutar `scripts/setup-powerbi-readonly-user.sh` para setear password + habilitar LOGIN.

### `permission denied for schema bi`

- El grant `USAGE` no se aplicó. Re-ejecutar la migración (`npx prisma migrate deploy`) o ejecutar manualmente:
  ```sql
  GRANT USAGE ON SCHEMA bi TO powerbi_readonly;
  GRANT SELECT ON ALL TABLES IN SCHEMA bi TO powerbi_readonly;
  ```

### `relation "bi.projects_view" does not exist`

- La migración no se aplicó. Verificar con `\dt bi.*` desde psql.

### Power BI Service refresh falla con timeout

- Subir el `Command timeout` en el dataset (Settings → Data source credentials → Edit → Advanced).
- Si persiste, simplificar el modelo (less columns + Composite Calendar Import).

### `SSL connection is required`

- Activar **Encrypt connections** en el dialog Auth de Power BI Desktop. Supabase rechaza sin TLS.

### El Navigator no muestra el schema `bi`

- Verificar que el rol `powerbi_readonly` tiene `USAGE` sobre `bi`. Sin el grant, Postgres oculta el schema al rol.

---

## Endpoints relacionados

- **Import mode (OData v4):** `docs/integrations/powerbi.md` (Wave P21-C). Recomendado para dashboards ejecutivos con refresh 1-2x/día.
- **DirectQuery (este doc):** dashboards operativos casi-realtime o cuando el dataset excede memoria PBI.
- **CSV exports:** `docs/integrations/bi-connectors.md`. Fallback estático cuando no hay networking directo.

## Anexo · query M ejemplo (Advanced Editor)

Para usuarios que prefieren pegar el query M sin instalar el `.mez`:

```m
let
    Server   = "db.qrytvxyaxhykbqsktqnv.supabase.co:5432",
    Database = "postgres",
    Source   = PostgreSQL.Database(Server, Database, [
        HierarchicalNavigation = true,
        CreateNavigationProperties = false
    ]),
    BI      = Source{[Schema="bi"]}[Data],
    Tasks   = BI{[Name="tasks_view"]}[Data],
    // Push-down filter por workspace.
    Filtered = Table.SelectRows(Tasks, each [workspace_id] = "<TU_WORKSPACE_ID>")
in
    Filtered
```

Al ejecutar, Power BI pedirá credenciales: seleccionar **Database** → user `powerbi_readonly` + password (del password manager). Marcar **Encrypt connections**.
