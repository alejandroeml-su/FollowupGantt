// ─────────────────────────────────────────────────────────────────────────
// Sync (FollowupGantt) — Power BI Custom Data Connector source
//
// Wave P21-C · Power BI Native Connector
//
// Power Query M file que envuelve el endpoint OData v4 de Sync con:
//   - Authentication Type "Key" (API key con scope `read:exports`)
//   - Custom Bearer header preservado en cada request (Power BI por
//     default solo manda credenciales en el primer call).
//   - Discovery automático del service document → entity sets.
//   - Folding amigable: $select / $filter / $orderby / $top se delegan
//     al servidor (no se traen todas las columnas al cliente).
//
// Build (no se hace en este repo — requiere Power BI SDK + VS):
//   1. Crear proyecto Power BI Data Connector en Visual Studio.
//   2. Reemplazar `SyncConnector.pq` por este archivo.
//   3. Build → produce `SyncConnector.mez`.
//   4. Copiar el .mez a `Documents\Power BI Desktop\Custom Connectors\`.
//   5. Habilitar custom connectors en Power BI Desktop:
//      File → Options → Security → "(Not Recommended) Allow any extension".
//
// Documentación end-to-end del usuario: ver `docs/integrations/powerbi.md`.
// ─────────────────────────────────────────────────────────────────────────

section SyncConnector;

// ═════════════════════════════════════════════════════════════════════════
// Constantes de configuración
// ═════════════════════════════════════════════════════════════════════════

// URL base por default (override por parámetro al invocar Sync.Contents).
DefaultBaseUrl = "https://sync.complejoavante.com/api/v2/odata/";

// User-Agent enviado en cada request — el servidor detecta esto para
// audit logging (`isPowerBIClient: true`).
UserAgent = "SyncPowerBIConnector/1.0";

// ═════════════════════════════════════════════════════════════════════════
// Entry point: Sync.Contents
// ═════════════════════════════════════════════════════════════════════════

[DataSource.Kind="SyncConnector", Publish="SyncConnector.Publish"]
shared Sync.Contents = Value.ReplaceType(SyncContentsImpl, SyncContentsType);

// Type metadata para que Power BI muestre un dialog amigable.
SyncContentsType = type function (
    optional baseUrl as (type text meta [
        Documentation.FieldCaption = "Sync OData base URL",
        Documentation.FieldDescription = "Base URL del endpoint OData v4 de Sync. Default: " & DefaultBaseUrl,
        Documentation.SampleValues = { DefaultBaseUrl }
    ])
) as table meta [
    Documentation.Name = "Sync (FollowupGantt) — OData v4",
    Documentation.LongDescription = "Conector nativo Power BI para Sync. Lista los entity sets (Projects, Tasks, Sprints, Risks, EVMSnapshots, AuditEvents) listos para arrastrar al modelo. Requiere API key con scope read:exports."
];

SyncContentsImpl = (optional baseUrl as text) as table =>
    let
        resolvedBaseUrl = if baseUrl = null or baseUrl = "" then DefaultBaseUrl else baseUrl,
        // El service document expone los entity sets disponibles.
        feed = OData.Feed(
            resolvedBaseUrl,
            null,
            [
                Implementation = "2.0",
                ODataVersion = 4,
                Headers = [
                    #"User-Agent" = UserAgent,
                    #"OData-MaxVersion" = "4.0"
                ]
            ]
        )
    in
        feed;

// ═════════════════════════════════════════════════════════════════════════
// Data Source Kind — define el método de autenticación expuesto en el
// dialog "Edit Credentials" de Power BI.
// ═════════════════════════════════════════════════════════════════════════

SyncConnector = [
    // Test connection cuando el usuario guarda credenciales.
    TestConnection = (dataSourcePath) =>
        let
            parsed = Json.Document(dataSourcePath),
            baseUrl = parsed[baseUrl]
        in
            { "Sync.Contents", baseUrl },

    // Tipos de auth permitidos. "Key" → API key (Bearer token), que
    // Power BI inyecta en el header `Authorization` automáticamente.
    Authentication = [
        Key = [
            KeyLabel = "API Key (sk_xxxx_yyyy)",
            Label = "Sync API key con scope read:exports"
        ]
    ],
    Label = "Sync (FollowupGantt)"
];

// ═════════════════════════════════════════════════════════════════════════
// Publish metadata — info que aparece en el connector picker.
// ═════════════════════════════════════════════════════════════════════════

SyncConnector.Publish = [
    Beta = true,
    Category = "Online Services",
    ButtonText = { "Sync (FollowupGantt)", "Conectar a Sync vía OData v4" },
    LearnMoreUrl = "https://github.com/alejandroeml-su/FollowupGantt/blob/master/docs/integrations/powerbi.md",
    SourceImage = SyncConnector.Icons,
    SourceTypeImage = SyncConnector.Icons
];

// Placeholder de íconos — empacar PNGs 16x16, 20x20, 24x24, 32x32, 40x40
// en el .mez al hacer el build. Sin íconos, Power BI usa el genérico.
SyncConnector.Icons = [
    Icon16 = { Extension.Contents("Sync16.png") },
    Icon20 = { Extension.Contents("Sync20.png") },
    Icon24 = { Extension.Contents("Sync24.png") },
    Icon32 = { Extension.Contents("Sync32.png") },
    Icon40 = { Extension.Contents("Sync40.png") }
];

// ═════════════════════════════════════════════════════════════════════════
// Helper públicos opcionales — para queries M avanzadas escritas
// manualmente por usuarios power (no aparecen en la UI, pero quedan
// invocables desde el Advanced Editor).
// ═════════════════════════════════════════════════════════════════════════

// Trae N filas de un entity set con soporte explícito de $top / $select.
// Ejemplo de uso desde Advanced Editor:
//   let
//     Source = SyncConnector.GetTable("Tasks", 1000, {"id","title","status"})
//   in Source
shared SyncConnector.GetTable =
    (entitySet as text, optional top as nullable number, optional select as nullable list) as table =>
        let
            baseUrl = DefaultBaseUrl,
            qsTop = if top <> null then "$top=" & Number.ToText(top) else null,
            qsSelect = if select <> null and List.Count(select) > 0
                then "$select=" & Text.Combine(select, ",")
                else null,
            queryParts = List.Select({ qsTop, qsSelect }, each _ <> null),
            queryString = if List.Count(queryParts) > 0
                then "?" & Text.Combine(queryParts, "&")
                else "",
            url = baseUrl & entitySet & queryString,
            response = OData.Feed(
                url,
                null,
                [
                    Implementation = "2.0",
                    ODataVersion = 4,
                    Headers = [
                        #"User-Agent" = UserAgent,
                        #"OData-MaxVersion" = "4.0"
                    ]
                ]
            )
        in
            response;
