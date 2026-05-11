// ─────────────────────────────────────────────────────────────────────────
// Sync (FollowupGantt) — Power BI DirectQuery Connector (PostgreSQL)
//
// Wave R4-C · DirectQuery Power BI sobre Supabase Postgres directo.
//
// A diferencia de `SyncConnector.pq` (Wave P21-C, OData v4 Import mode),
// este conector envuelve el conector NATIVO `PostgreSQL.Database` con
// `DirectQuery=true` apuntando al schema `bi.*` de Supabase.
//
// Por qué este enfoque:
//   - Power BI Desktop soporta DirectQuery nativo contra PostgreSQL
//     desde 2023 (sin Premium ni Custom Connector compilado .mez).
//   - OData v4 NO soporta DirectQuery oficial (sí Import mode únicamente).
//   - Las vistas `bi.*` tienen `workspace_id` en cada fila → Power BI
//     puede push-down el filtro por workspace al servidor.
//
// El archivo `.pq` actúa como REFERENCE / DOCUMENTACIÓN del query M que
// los usuarios deben pegar en Power BI Advanced Editor. NO se compila a
// `.mez` (requeriría Power BI SDK + Visual Studio + firma digital).
//
// Para distribuirlo como connector empacado:
//   1. Crear proyecto "Data Connector" en Visual Studio (Power Query SDK).
//   2. Reemplazar el `.pq` autogenerado por este archivo.
//   3. Build → SyncDirectQueryConnector.mez.
//   4. (Recomendado) Firmar con certificado corporativo.
//
// Documentación end-to-end del usuario: ver `docs/integrations/powerbi-directquery.md`.
// ─────────────────────────────────────────────────────────────────────────

section SyncDirectQueryConnector;

// ═════════════════════════════════════════════════════════════════════════
// Constantes
// ═════════════════════════════════════════════════════════════════════════

// Schema curado read-only en Supabase Postgres.
BiSchema = "bi";

// Catálogo de vistas que se exponen al Navigator de Power BI.
// Cada entry: { Name, DisplayName, Description }.
SyncViews = {
    [Name = "projects_view",      DisplayName = "Projects",      Description = "Proyectos con KPIs EVM y workspace (DirectQuery)."],
    [Name = "tasks_view",         DisplayName = "Tasks",         Description = "Tareas con proyecto + assignee (push-down filterable)."],
    [Name = "sprints_view",       DisplayName = "Sprints",       Description = "Sprints (Scrum) con velocity, capacity y goal."],
    [Name = "risks_view",         DisplayName = "Risks",         Description = "Riesgos con score (P×I) y severity precalculados."],
    [Name = "audit_view",         DisplayName = "AuditEvents",   Description = "Audit log curado (IP redacted /24, sin before/after Json)."],
    [Name = "evm_snapshots_view", DisplayName = "EVMSnapshots",  Description = "Snapshots EVM (PV/EV/AC + EAC/VAC) para curvas-S."],
    [Name = "allocations_view",   DisplayName = "Allocations",   Description = "Heatmap allocations aplanado (user × week × project)."]
};

// ═════════════════════════════════════════════════════════════════════════
// Entry point: Sync.DirectQuery
// ═════════════════════════════════════════════════════════════════════════

[DataSource.Kind="SyncDirectQueryConnector", Publish="SyncDirectQueryConnector.Publish"]
shared Sync.DirectQuery = Value.ReplaceType(SyncDirectQueryImpl, SyncDirectQueryType);

SyncDirectQueryType = type function (
    server   as (type text meta [
        Documentation.FieldCaption = "Server (Supabase Postgres host)",
        Documentation.FieldDescription = "Host de Supabase. Default: db.<project>.supabase.co",
        Documentation.SampleValues = { "db.qrytvxyaxhykbqsktqnv.supabase.co" }
    ]),
    optional database as (type text meta [
        Documentation.FieldCaption = "Database",
        Documentation.FieldDescription = "Default: postgres",
        Documentation.SampleValues = { "postgres" }
    ]),
    optional port as (type number meta [
        Documentation.FieldCaption = "Port",
        Documentation.FieldDescription = "5432 (direct) o 6543 (pooler). Default: 5432.",
        Documentation.SampleValues = { 5432 }
    ])
) as table meta [
    Documentation.Name = "Sync (FollowupGantt) — DirectQuery vía Postgres",
    Documentation.LongDescription = "Conector DirectQuery para Sync sobre Supabase Postgres directo. Expone las vistas curadas del schema `bi.*` (projects, tasks, sprints, risks, audit, evm, allocations). Requiere usuario powerbi_readonly + password (gestionado por SRE)."
];

SyncDirectQueryImpl =
    (server as text, optional database as nullable text, optional port as nullable number) as table =>
    let
        resolvedDb   = if database = null or database = "" then "postgres" else database,
        resolvedPort = if port = null then 5432 else port,
        // PostgreSQL.Database con CreateNavigationProperties=false (mejor
        // performance — no infiere FKs por su cuenta) y DirectQuery activo
        // vía HierarchicalNavigation = true para que el Navigator agrupe
        // por schema.
        source = PostgreSQL.Database(
            server & ":" & Number.ToText(resolvedPort),
            resolvedDb,
            [
                HierarchicalNavigation = true,
                CreateNavigationProperties = false,
                // CRÍTICO: activar DirectQuery. Sin este flag, Power BI
                // hace Import. El flag oficial documentado por Microsoft
                // para el conector Postgres es CommandTimeout + el
                // selector del usuario en el connection dialog ("DirectQuery").
                // Aquí lo dejamos en blanco para que el dialog estándar
                // muestre la opción Import / DirectQuery al usuario.
                CommandTimeout = #duration(0, 0, 0, 30)
            ]
        ),
        // Navegar al schema `bi`.
        schemaNav = source{[Schema=BiSchema]}[Data],
        // Re-shape: exponer solo las vistas catalogadas en SyncViews con
        // nombres amigables.
        rows = List.Transform(SyncViews, each [
            Name      = _[DisplayName],
            Key       = _[Name],
            Data      = schemaNav{[Name = _[Name]]}[Data],
            ItemKind  = "Table",
            ItemName  = "Table",
            IsLeaf    = true
        ]),
        navTable = Table.FromRecords(rows, {"Name","Key","Data","ItemKind","ItemName","IsLeaf"}),
        // Marcar como NavigationTable para que Power BI lo renderee
        // como un picker plano (sin sub-navegación).
        withType = Value.ReplaceType(navTable, type table [
            Name as text,
            Key as text,
            Data as table,
            ItemKind as text,
            ItemName as text,
            IsLeaf as logical
        ]),
        navigationTable = Table.NavigationTable.SetType(withType, {"Key"}, {"Name"}, "Data", "ItemKind", "ItemName", "IsLeaf")
    in
        navigationTable;

// Helper para marcar tablas de navegación (patrón estándar Power Query SDK).
Table.NavigationTable.SetType = (table as table, keyColumns as list, nameColumns as list, dataColumn as text, itemKindColumn as text, itemNameColumn as text, isLeafColumn as text) as table =>
    let
        tableType = Value.Type(table),
        newTableType = Type.AddTableKey(tableType, keyColumns, true) meta
        [
            NavigationTable.NameColumn = nameColumns{0},
            NavigationTable.DataColumn = dataColumn,
            NavigationTable.ItemKindColumn = itemKindColumn,
            NavigationTable.ItemNameColumn = itemNameColumn,
            NavigationTable.IsLeafColumn = isLeafColumn,
            Preview.DelayColumn = dataColumn
        ],
        navigationTable = Value.ReplaceType(table, newTableType)
    in
        navigationTable;

// ═════════════════════════════════════════════════════════════════════════
// Data Source Kind — Authentication = UsernamePassword
// ═════════════════════════════════════════════════════════════════════════

SyncDirectQueryConnector = [
    TestConnection = (dataSourcePath) =>
        let
            parsed = Json.Document(dataSourcePath)
        in
            { "Sync.DirectQuery", parsed[server], parsed[database], parsed[port] },

    Authentication = [
        UsernamePassword = [
            UsernameLabel = "Username (powerbi_readonly)",
            PasswordLabel = "Password",
            Label = "Credenciales Supabase Postgres"
        ]
    ],
    // SSL obligatorio para conexiones Supabase.
    SupportsEncryption = true,
    Label = "Sync (FollowupGantt) DirectQuery"
];

// ═════════════════════════════════════════════════════════════════════════
// Publish metadata
// ═════════════════════════════════════════════════════════════════════════

SyncDirectQueryConnector.Publish = [
    Beta = true,
    Category = "Database",
    ButtonText = { "Sync (FollowupGantt) DirectQuery", "Conectar a Sync con DirectQuery vía Postgres" },
    LearnMoreUrl = "https://github.com/alejandroeml-su/FollowupGantt/blob/master/docs/integrations/powerbi-directquery.md",
    SourceImage = SyncDirectQueryConnector.Icons,
    SourceTypeImage = SyncDirectQueryConnector.Icons
];

SyncDirectQueryConnector.Icons = [
    Icon16 = { Extension.Contents("Sync16.png") },
    Icon20 = { Extension.Contents("Sync20.png") },
    Icon24 = { Extension.Contents("Sync24.png") },
    Icon32 = { Extension.Contents("Sync32.png") },
    Icon40 = { Extension.Contents("Sync40.png") }
];
