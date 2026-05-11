-- ─────────────────────────────────────────────────────────────────────
-- Wave R4-C · DirectQuery Power BI — Vistas BI curadas + rol read-only.
--
-- Estrategia: en lugar de soportar DirectQuery a través del feed OData v4
-- (que requiere Custom Connector .mez con flag DirectQuery=true + Power BI
-- Premium), exponemos directamente Supabase PostgreSQL como datasource
-- nativo de Power BI. Esto habilita DirectQuery real con push-down de
-- filtros (WHERE workspace_id = ...) al servidor.
--
-- La migración:
--   1. Crea el schema `bi` (aislado de `public` para que el rol read-only
--      jamás tenga acceso a tablas raw con PII).
--   2. Define 7 vistas curadas: projects/tasks/sprints/risks/audit/evm/
--      allocations. Cada una hace los joins típicos (proyecto+responsable,
--      sprint+proyecto, etc.) y filtra/redacta campos sensibles
--      (User.password, User.emailVerified, User.twoFactorSecret nunca se
--      exponen; User.email se redacta a su dominio cuando aplica).
--   3. Crea el rol `powerbi_readonly` con NOLOGIN — el operador setea la
--      contraseña manualmente vía script (ver scripts/setup-powerbi-readonly-user.sh)
--      para evitar guardar credenciales en VCS.
--   4. Otorga SELECT sobre todas las vistas del schema `bi` + USAGE en el
--      schema; NO concede privilegios sobre `public.*`.
--
-- Idempotente: usa CREATE OR REPLACE VIEW + IF NOT EXISTS / DO blocks.
-- Aditiva: no toca ninguna tabla ni rol existente.
--
-- Seguridad:
--   - Las vistas son SECURITY INVOKER (default). Cuando Power BI ejecuta
--     un SELECT contra `bi.projects_view`, Postgres aplica los grants y
--     RLS del rol `powerbi_readonly`. Si en el futuro se activa RLS sobre
--     las tablas base, las vistas DEBEN seguir siendo INVOKER para que la
--     política respete al rol consultante (no al definer). Trade-off:
--     SECURITY DEFINER eludiría RLS — NO usar.
--   - `workspace_id` se expone en TODAS las vistas para que el modelo
--     Power BI filtre por workspace antes de cargar (push-down DirectQuery).
--
-- Setup pendiente tras aplicar esta migración (manual, una sola vez):
--   1. Conectarse a Supabase con superuser y ejecutar
--      `ALTER ROLE powerbi_readonly LOGIN PASSWORD '<random-32+>';`
--   2. Configurar Supabase networking para permitir conexiones directas
--      al puerto 5432 (o 6543 pooler) desde el origen Power BI Service /
--      On-premises Data Gateway.
--   3. Documentar fecha de rotación en password manager corporativo (90d).
-- ─────────────────────────────────────────────────────────────────────

-- 1) Schema aislado para BI ─────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS "bi";
COMMENT ON SCHEMA "bi" IS
  'Wave R4-C — Curated BI views for Power BI DirectQuery. Read-only role powerbi_readonly grants are scoped to this schema; raw tables in public.* remain inaccessible.';

-- 2) Rol read-only (sin LOGIN; el operador setea password manualmente) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'powerbi_readonly') THEN
    -- NOLOGIN por defecto. El operador habilita LOGIN al setear password:
    --   ALTER ROLE powerbi_readonly LOGIN PASSWORD '<random>';
    CREATE ROLE "powerbi_readonly" NOLOGIN;
    COMMENT ON ROLE "powerbi_readonly" IS
      'Wave R4-C — Power BI DirectQuery read-only role. SELECT sobre bi.* únicamente. Setear password fuera de migration. Rotar cada 90 días.';
  END IF;
END$$;

-- 3) Vistas curadas (idempotentes vía CREATE OR REPLACE) ────────────────

-- ── 3.1 Projects ────────────────────────────────────────────────────────
-- PII: ninguna directa. `managerId` apunta a User pero no exponemos User
-- raw — para nombre del manager usar el JOIN en bi.tasks_view (assignee)
-- o agregar una vista de dimensión bi.users_view en una iteración futura.
CREATE OR REPLACE VIEW "bi"."projects_view" AS
SELECT
  p."id"                        AS "id",
  p."name"                      AS "name",
  p."description"               AS "description",
  p."status"::text              AS "status",
  p."methodology"::text         AS "methodology",
  p."workspaceId"               AS "workspace_id",
  p."managerId"                 AS "manager_id",
  p."areaId"                    AS "area_id",
  p."cpi"                       AS "cpi",
  p."spi"                       AS "spi",
  p."budget"                    AS "budget",
  p."budgetCurrency"            AS "budget_currency",
  p."createdAt"                 AS "created_at",
  p."updatedAt"                 AS "updated_at"
FROM "public"."Project" p;

COMMENT ON VIEW "bi"."projects_view" IS
  'Wave R4-C — Proyecto curado para Power BI. workspace_id permite push-down filter en DirectQuery. NO expone Json columns (charter, productGoal, dorTemplate, dodTemplate, communicationsPlan) por contener texto libre que puede incluir PII operativa.';

-- ── 3.2 Tasks ──────────────────────────────────────────────────────────
-- Join con Project para traer workspace_id (push-down) + project_name.
-- Join LEFT con User assignee para nombre legible (no expone email).
CREATE OR REPLACE VIEW "bi"."tasks_view" AS
SELECT
  t."id"                        AS "id",
  t."mnemonic"                  AS "mnemonic",
  t."title"                     AS "title",
  t."type"::text                AS "type",
  t."status"::text              AS "status",
  t."priority"::text            AS "priority",
  t."progress"                  AS "progress",
  t."isMilestone"               AS "is_milestone",
  t."storyPoints"               AS "story_points",
  t."plannedValue"              AS "planned_value",
  t."actualCost"                AS "actual_cost",
  t."earnedValue"               AS "earned_value",
  t."startDate"                 AS "start_date",
  t."endDate"                   AS "end_date",
  t."hardDeadline"              AS "hard_deadline",
  t."dailyEffortHours"          AS "daily_effort_hours",
  t."archivedAt"                AS "archived_at",
  t."tags"                      AS "tags",
  p."id"                        AS "project_id",
  p."name"                      AS "project_name",
  p."workspaceId"               AS "workspace_id",
  t."sprintId"                  AS "sprint_id",
  t."epicId"                    AS "epic_id",
  t."phaseId"                   AS "phase_id",
  t."parentId"                  AS "parent_id",
  t."assigneeId"                AS "assignee_id",
  u."name"                      AS "assignee_name",
  t."createdAt"                 AS "created_at",
  t."updatedAt"                 AS "updated_at"
FROM "public"."Task" t
JOIN "public"."Project" p ON p."id" = t."projectId"
LEFT JOIN "public"."User" u ON u."id" = t."assigneeId";

COMMENT ON VIEW "bi"."tasks_view" IS
  'Wave R4-C — Task curado con JOIN Project + assignee (nombre). NO expone description (texto libre con potencial PII), userStory (Json), customFieldValues, comments. Para drill-down narrativo usar el frontend de Sync.';

-- ── 3.3 Sprints ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW "bi"."sprints_view" AS
SELECT
  s."id"                        AS "id",
  s."name"                      AS "name",
  s."goal"                      AS "goal",
  s."status"::text              AS "status",
  s."startDate"                 AS "start_date",
  s."endDate"                   AS "end_date",
  s."startedAt"                 AS "started_at",
  s."endedAt"                   AS "ended_at",
  s."capacity"                  AS "capacity",
  s."velocityActual"            AS "velocity_actual",
  s."budget"                    AS "budget",
  s."budgetCurrency"            AS "budget_currency",
  s."reviewedAt"                AS "reviewed_at",
  p."id"                        AS "project_id",
  p."name"                      AS "project_name",
  p."workspaceId"               AS "workspace_id",
  s."createdAt"                 AS "created_at",
  s."updatedAt"                 AS "updated_at"
FROM "public"."Sprint" s
JOIN "public"."Project" p ON p."id" = s."projectId";

COMMENT ON VIEW "bi"."sprints_view" IS
  'Wave R4-C — Sprint curado con JOIN Project. NO expone capacityPerUser (Json con userId mapping) ni reviewNotes (texto libre).';

-- ── 3.4 Risks ──────────────────────────────────────────────────────────
-- Incluye score derivado (probability × impact) y severity tier según
-- matriz 5×5 PMBOK — mismo cálculo que el endpoint OData. Power BI puede
-- usar estos campos sin DAX adicional.
CREATE OR REPLACE VIEW "bi"."risks_view" AS
SELECT
  r."id"                        AS "id",
  r."title"                     AS "title",
  r."status"::text              AS "status",
  r."probability"               AS "probability",
  r."impact"                    AS "impact",
  (r."probability" * r."impact") AS "score",
  CASE
    WHEN (r."probability" * r."impact") < 6  THEN 'LOW'
    WHEN (r."probability" * r."impact") <= 10 THEN 'MEDIUM'
    WHEN (r."probability" * r."impact") <= 15 THEN 'HIGH'
    ELSE 'CRITICAL'
  END                            AS "severity",
  r."source"::text              AS "source",
  r."triggerDelayDays"          AS "trigger_delay_days",
  r."detectedAt"                AS "detected_at",
  r."closedAt"                  AS "closed_at",
  r."ownerId"                   AS "owner_id",
  r."taskId"                    AS "task_id",
  p."id"                        AS "project_id",
  p."name"                      AS "project_name",
  p."workspaceId"               AS "workspace_id",
  r."createdAt"                 AS "created_at",
  r."updatedAt"                 AS "updated_at"
FROM "public"."Risk" r
JOIN "public"."Project" p ON p."id" = r."projectId";

COMMENT ON VIEW "bi"."risks_view" IS
  'Wave R4-C — Risk con score (P×I) y severity tier derivados. NO expone description ni mitigation (texto libre con detalle operativo). Para narrativa, drill-down al UI.';

-- ── 3.5 Audit events ───────────────────────────────────────────────────
-- CRÍTICO: no exponemos `before`/`after`/`metadata` (Json puede contener
-- valores sensibles snapshotteados — passwords pre-hash, tokens en payloads).
-- `ipAddress` también se redacta (solo se publica el /24 para análisis
-- geográfico sin posibilidad de tracing per-host).
CREATE OR REPLACE VIEW "bi"."audit_view" AS
SELECT
  a."id"                        AS "id",
  a."action"                    AS "action",
  a."entityType"                AS "entity_type",
  a."entityId"                  AS "entity_id",
  a."actorId"                   AS "actor_id",
  -- Redact IP a /24 (los últimos octetos eliminados) para preservar
  -- agregaciones geográficas sin exponer la dirección completa.
  CASE
    WHEN a."ipAddress" IS NULL THEN NULL
    WHEN a."ipAddress" ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
      THEN regexp_replace(a."ipAddress", '\.[0-9]+$', '.0')
    ELSE 'redacted'
  END                            AS "ip_subnet",
  -- userAgent es bajo riesgo (cliente declarado), se mantiene.
  a."userAgent"                 AS "user_agent",
  -- Inferimos workspace_id desde el actor si está disponible. En audit
  -- "system" (actorId NULL) workspace_id queda NULL — Power BI filtrará
  -- esos eventos cross-workspace.
  (
    SELECT m."workspaceId"
    FROM "public"."WorkspaceMember" m
    WHERE m."userId" = a."actorId"
    ORDER BY m."createdAt" ASC
    LIMIT 1
  )                              AS "workspace_id",
  a."createdAt"                 AS "created_at"
FROM "public"."AuditEvent" a;

COMMENT ON VIEW "bi"."audit_view" IS
  'Wave R4-C — Audit log curado. CRÍTICO: NO expone before/after/metadata (pueden contener PII snapshotteado). IP redacted a /24. workspace_id inferido desde WorkspaceMember (primer membership del actor). Eventos system (actorId NULL) tienen workspace_id NULL.';

-- ── 3.6 EVM Snapshots ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW "bi"."evm_snapshots_view" AS
SELECT
  e."id"                        AS "id",
  e."snapshotDate"              AS "snapshot_date",
  e."plannedValue"              AS "planned_value",
  e."earnedValue"               AS "earned_value",
  e."actualCost"                AS "actual_cost",
  e."budgetAtCompletion"        AS "budget_at_completion",
  e."estimateAtCompletion"      AS "estimate_at_completion",
  e."varianceAtCompletion"      AS "variance_at_completion",
  e."cpi"                       AS "cpi",
  e."spi"                       AS "spi",
  p."id"                        AS "project_id",
  p."name"                      AS "project_name",
  p."workspaceId"               AS "workspace_id",
  e."createdAt"                 AS "created_at"
FROM "public"."EVMSnapshot" e
JOIN "public"."Project" p ON p."id" = e."projectId";

COMMENT ON VIEW "bi"."evm_snapshots_view" IS
  'Wave R4-C — EVMSnapshot curado con JOIN Project. Cubre curvas-S PV/EV/AC + KPIs CPI/SPI. NO expone notes (texto libre).';

-- ── 3.7 Resource Allocations ───────────────────────────────────────────
-- Aplana el Json `allocations` a una fila por (user, week, project) usando
-- jsonb_to_recordset. Esto permite que Power BI consuma la heatmap sin
-- procesar Json client-side. NO expone email del User; sólo nombre.
CREATE OR REPLACE VIEW "bi"."allocations_view" AS
SELECT
  ra."id" || ':' || (a."ordinality")::text  AS "id",
  ra."userId"                                AS "user_id",
  u."name"                                   AS "user_name",
  ra."weekStart"                             AS "week_start",
  ra."totalHours"                            AS "total_hours_week",
  (a."item"->>'projectId')                   AS "project_id",
  (a."item"->>'projectName')                 AS "project_name",
  ((a."item"->>'hours')::numeric)            AS "project_hours",
  ((a."item"->>'percent')::numeric)          AS "project_percent",
  ra."computedAt"                            AS "computed_at",
  -- workspace_id desde el Project referenciado (push-down).
  p."workspaceId"                            AS "workspace_id"
FROM "public"."ResourceAllocationSnapshot" ra
LEFT JOIN "public"."User" u ON u."id" = ra."userId"
LEFT JOIN LATERAL jsonb_array_elements(ra."allocations"::jsonb) WITH ORDINALITY AS a("item", "ordinality") ON TRUE
LEFT JOIN "public"."Project" p ON p."id" = (a."item"->>'projectId');

COMMENT ON VIEW "bi"."allocations_view" IS
  'Wave R4-C — Heatmap allocations aplanado desde ResourceAllocationSnapshot.allocations Json a una fila por (user, week, project). NO expone email del User. workspace_id viene del Project para push-down filtering.';

-- 4) Grants al rol powerbi_readonly ─────────────────────────────────────
GRANT USAGE ON SCHEMA "bi" TO "powerbi_readonly";

-- SELECT explícito en cada vista (más resiliente que ALL TABLES, que
-- depende de timing — se aplica a tablas existentes; si se crea una vista
-- nueva DESPUÉS, no recibe el grant. Mejor enumerar + complementar con
-- ALTER DEFAULT PRIVILEGES más abajo).
GRANT SELECT ON "bi"."projects_view"      TO "powerbi_readonly";
GRANT SELECT ON "bi"."tasks_view"         TO "powerbi_readonly";
GRANT SELECT ON "bi"."sprints_view"       TO "powerbi_readonly";
GRANT SELECT ON "bi"."risks_view"         TO "powerbi_readonly";
GRANT SELECT ON "bi"."audit_view"         TO "powerbi_readonly";
GRANT SELECT ON "bi"."evm_snapshots_view" TO "powerbi_readonly";
GRANT SELECT ON "bi"."allocations_view"   TO "powerbi_readonly";

-- Default privileges: cualquier vista futura creada en el schema `bi` por
-- el rol que ejecuta esta migración (típicamente postgres/owner) será
-- automáticamente SELECT-able por powerbi_readonly.
ALTER DEFAULT PRIVILEGES IN SCHEMA "bi"
  GRANT SELECT ON TABLES TO "powerbi_readonly";

-- 5) Hardening: confirmar que NO hay grants a public.* ──────────────────
-- (Postgres ya bloquea por default; este REVOKE es defensive).
REVOKE ALL ON SCHEMA "public" FROM "powerbi_readonly";

-- ─── Fin de la migración ───────────────────────────────────────────────
