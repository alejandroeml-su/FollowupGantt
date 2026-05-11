# Power BI · Conexión nativa a Sync

> Wave P21-C · Power BI Native Connector — guía end-to-end para conectar **Power BI Desktop** (y, vía gateway, **Power BI Service**) al endpoint OData v4 de Sync.

Sync expone un feed OData v4 totalmente compatible con Power BI Desktop. Hay **dos formas** de conectarse:

- **Opción A (recomendada para arranque)** — OData Feed nativo. Solo URL + Bearer token. Funciona con cualquier Power BI Desktop sin instalación adicional.
- **Opción B (recomendada producción)** — Custom Data Connector `.mez` compilado desde `connectors/powerbi/SyncConnector.pq`. UX más amigable (aparece como "Sync (FollowupGantt)" en el Get Data picker) y soporta firma digital corporativa.

---

## Paso 1 · Generar API token con scope `read:exports`

1. Ingresar a Sync con cuenta admin del workspace.
2. **Configuración → API Keys → New key**.
3. Nombre descriptivo (ej. "Power BI · Dashboard ejecutivo").
4. Marcar el scope **`read:exports`** (único requerido).
5. Copiar el token `sk_xxxxxxxx_yyyyyyyyyy` — **se muestra solo una vez**.

> ⚠️ La key NO expira automáticamente. Rotarla cada 90 días vía política interna o el campo `expiresAt` del API Key Manager.

---

## Paso 2 · Power BI Desktop → Get Data → OData feed

> Esta es la **Opción A**. Si tu organización ya tiene el `.mez` desplegado, salta a la sección "Opción B" más abajo.

1. Abrir **Power BI Desktop**.
2. **Home → Get Data → More…**
3. Buscar **"OData feed"** → **Connect**.
4. En el dialog:
   - **URL**: `https://sync.complejoavante.com/api/v2/odata/`
   - Sección **Basic** (no Advanced).
5. **OK**.

---

## Paso 3 · Authentication → Web API → paste Bearer token

Power BI preguntará por credenciales:

1. En el panel izquierdo seleccionar **"Web API"**.
2. **Key**: pegar **únicamente el token** (sin el prefijo `Bearer `) → `sk_xxxxxxxx_yyyyyyyyyy`.
3. **Apply to**: `https://sync.complejoavante.com/api/v2/odata/`.
4. **Connect**.

> Power BI automáticamente inyecta `Authorization: Bearer <token>` en cada request. No agregues "Bearer" manualmente o quedará duplicado.

### Alternativa si Power BI rechaza "Web API"

Algunas versiones de Power BI Service no soportan auth Web API para refresh programado. En ese caso, usar el query M directamente en **Advanced Editor**:

```m
let
    Source = OData.Feed(
        "https://sync.complejoavante.com/api/v2/odata/",
        null,
        [
            Implementation = "2.0",
            ODataVersion = 4,
            Headers = [
                Authorization = "Bearer sk_xxxxxxxx_yyyyyyyyyy",
                #"OData-MaxVersion" = "4.0"
            ]
        ]
    )
in
    Source
```

> ⚠️ Hardcodear el token en M no es ideal — preferir **Parámetros** (`#"Token"`) o **Web API** con gateway empresarial.

---

## Paso 4 · Navegar entity sets y seleccionar

Power BI Desktop carga `$metadata` automáticamente y muestra el **Navigator** con los entity sets disponibles:

| Entity set | Descripción |
|---|---|
| **Projects** | Proyectos del workspace (status, methodology, CPI/SPI, budget). |
| **Tasks** | Tareas con sprint/epic/assignee + EVM por tarea. |
| **Sprints** | Sprints (Scrum) con capacity, velocity y goal. |
| **Risks** | Riesgos con `score` (P×I) y `severity` derivados. |
| **EVMSnapshots** | Histórico EVM (PV/EV/AC/BAC/EAC) para curvas-S. |
| **AuditEvents** | Eventos de auditoría del workspace (last 90 días por retention default). |

1. Marcar el(los) checkbox(es) deseado(s).
2. **Transform Data** para abrir Power Query Editor (recomendado — permite filtrar antes de cargar).
3. O **Load** directo si confías en el shape.

> Power BI puede tardar 10-30 seg en cargar `$metadata` la primera vez. No es un bug — es la negociación inicial del schema.

---

## Paso 5 · (Opcional) Instalar Custom Data Connector .mez

> Esta es la **Opción B** — solo aplica si tu organización ya compiló el `.mez` desde `connectors/powerbi/SyncConnector.pq`. Ver `connectors/powerbi/README.md` para el build.

1. Copiar `SyncConnector.mez` a `%USERPROFILE%\Documents\Power BI Desktop\Custom Connectors\`.
2. Power BI Desktop → **File → Options and settings → Options → Security → Data Extensions**.
3. Activar **"(Not Recommended) Allow any extension to load without validation or warning"** *o* configurar trust por firma digital corporativa.
4. Reiniciar Power BI Desktop.
5. **Home → Get Data → search "Sync"** → seleccionar **"Sync (FollowupGantt)"**.
6. Auth: dialog pregunta por **API Key** → pegar el `sk_xxxx_yyyy`.

Beneficios vs Opción A:
- Aparece bajo **Online Services** (más discoverable).
- Auth dialog simplificado.
- Posibilidad de firmar digitalmente y distribuir sin warnings.

---

## Optimizaciones (importante para performance)

Power BI **fold operations** automáticamente al servidor cuando usa `OData.Feed` con `Implementation = "2.0"`. Para máximizar el folding:

### 1. Usar `$select` (proyección de columnas)

En Power Query Editor, **eliminar columnas innecesarias INMEDIATAMENTE** después del paso `Source`. Power BI traduce el "Removed Columns" a `$select` en la request OData:

```m
let
    Source = OData.Feed("https://sync.complejoavante.com/api/v2/odata/"),
    Tasks = Source{[Name="Tasks",Signature="table"]}[Data],
    Subset = Table.SelectColumns(Tasks, {"id", "title", "status", "progress", "projectId"})
in
    Subset
```

Sin `$select`, Power BI trae **todas las 19 columnas** de cada tarea. Con `$select`, trae solo las 5 elegidas — **~4× menos payload**.

### 2. Usar `$filter` server-side

```m
ActivosScrum = Table.SelectRows(Projects, each [status] = "ACTIVE" and [methodology] = "SCRUM")
```

Power BI traduce ambos predicados a `$filter=status eq 'ACTIVE' and methodology eq 'SCRUM'`. Verificar el folding en **View → Query Diagnostics → Diagnose Step**.

### 3. Usar `$orderby` solo si necesario

Sync ordena por `id asc` por default. Solo pedir `$orderby=col desc` cuando el modelo lo requiera explícitamente (ej. snapshots EVM cronológicos).

### 4. `$top` razonable

Sync **cap a 1000 filas por request** (`$top` máximo). Para datasets grandes, usar paginación con `$skip` o (mejor) filtrar agresivamente con `$filter` para que la query natural devuelva <1000 filas.

```m
PrimerasMil = Table.FirstN(Source, 1000)
```

### 5. Refresh poco frecuente

Cada refresh re-fetch TODAS las entidades del modelo. Para dashboards ejecutivos, schedule **1-2 refresh/día** es suficiente. Refresh por hora satura el rate limit (60 req/min compartido).

---

## Limitaciones conocidas

| Limitación | Workaround |
|---|---|
| Cap **1000 filas / request** (`$top` máximo). | Paginar con `$skip` o filtrar agresivamente. |
| **`$expand` solo 1 nivel** (Projects→Tasks, Sprints→Project). | Hacer queries separados y joinear en el modelo Power BI (relationship). |
| **Sin** funciones OData `$search`, `$compute`, `contains()`, `startswith()`. | Filtrar en cliente con `Table.SelectRows` (no foldea, pero funciona). |
| **Sin** operador `or` ni paréntesis en `$filter`. | Hacer 2 queries con `eq` + `Table.Combine`. |
| **AuditEvents** filtrado a actores con membership del workspace. System events (login fallido sin actor) NO se exponen. | Esperado — protección cross-workspace. |
| **Solo Import mode** (ver siguiente sección). | — |

---

## DirectQuery vs Import — solo Import por ahora

Sync **soporta solo Power BI Import mode**, NO DirectQuery.

**Razón técnica**: OData v4 sí permite DirectQuery teóricamente, pero requiere:
- Soporte completo de `$count` en cada query intermedia (Sync sí lo soporta).
- Latency p95 <1s por query (Sync DB Supabase con pool=1 — no garantizado bajo carga).
- Mapping completo de tipos `Edm.*` a DAX (Sync OK).

**Plan futuro**: cuando Sync migre a un read-replica o tenga caching agresivo en el endpoint OData, evaluar habilitar DirectQuery. Tracking: roadmap R4.

Hoy: usar Import mode con refresh programado.

---

## Troubleshooting

### "Unable to connect" / 401 Unauthorized

- Verificar que el token tiene el scope `read:exports` (ver Configuración → API Keys → row del token).
- Verificar que el token no esté revocado (Configuración → API Keys → status).
- Comprobar con `curl`:
  ```bash
  curl -H "Authorization: Bearer sk_xxxx_yyyy" https://sync.complejoavante.com/api/v2/odata/Projects?\$top=1
  ```

### "OData feed not OData v4"

- El service document `https://sync.complejoavante.com/api/v2/odata/` siempre responde con header `OData-Version: 4.0` — si no lo recibes, hay un proxy/CDN strippeando headers. Contactar SRE.

### El Navigator no muestra entity sets

- Verificar que `https://sync.complejoavante.com/api/v2/odata/$metadata` responde con XML válido. Browse manual debería mostrar el EDMX.
- Si la URL retorna 404 → bug del deploy; reportar.

### Refresh falla en Power BI Service

- Power BI Service NO soporta Web API auth para refresh programado en algunas licencias. Solución:
  1. Configurar **On-premises data gateway**.
  2. En el gateway, configurar la auth de Web API.
  3. Vincular el dataset al gateway desde Power BI Service → Dataset → Settings → Gateway connection.

### Rate limit 429

- Sync limita a **60 req/min y 1000 req/hora** por API key (compartido con todos los endpoints `/api/v2`).
- Si tu modelo Power BI dispara muchos refresh paralelos, schedule los datasets escalonados.
- Header `Retry-After` indica los segundos a esperar.

---

## Schema reference rápida

### Tipos OData → tipos Power BI

| Edm.\* | Power BI |
|---|---|
| `Edm.String` | Text |
| `Edm.Int32` | Whole Number |
| `Edm.Double` | Decimal Number |
| `Edm.Decimal` (Precision/Scale) | Fixed Decimal Number |
| `Edm.DateTimeOffset` | Date/Time/Zone |
| `Edm.Boolean` | True/False |

### Campos derivados (calculados server-side)

- **Risks.score** = `probability × impact` (rango 1..25, matriz 5×5 PMBOK).
- **Risks.severity** = `LOW` (<6) / `MEDIUM` (6..10) / `HIGH` (11..15) / `CRITICAL` (>15).

Power BI los recibe como columnas de primera clase — no requieren DAX adicional.

---

## Audit logging

Cada request exitosa al endpoint OData emite un evento `powerbi.dataset_fetched` con metadata:

```json
{
  "workspaceId": "...",
  "userAgent": "Microsoft.Data.Mashup (https://go.microsoft.com/fwlink/?LinkID=304225)",
  "isPowerBIClient": true,
  "query": { "$top": "1000", "$select": "id,title,status" }
}
```

Visible desde **Audit Log → filter action = "Power BI · dataset consultado vía OData"**. Útil para auditoría de exposición de datos y troubleshooting de refresh schedules.

---

## Endpoints relacionados

- `/api/v2/odata/` — Service document (catálogo de entity sets, público).
- `/api/v2/odata/$metadata` — EDMX schema XML (público).
- `/api/v2/odata/{EntitySet}` — Datos con auth obligatoria.
- `/api/v2/exports/*.csv` — Fallback CSV (ver `docs/integrations/bi-connectors.md`).

Para Tableau, ver `docs/integrations/tableau.md` (Wave P21-B).
Para uso desde mobile (Capacitor), ver `docs/integrations/mobile-capacitor.md` (Wave P21-A).
