-- R4-A · Tablas legacy con RLS habilitado SIN policies (cierra advisor INFO rls_enabled_no_policy).
--
-- Estado antes:
--   `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` se aplicó en
--   `20260504_rls_policies` para CalendarConnection, CalendarEvent,
--   Expense, Holiday, WorkCalendar pero los CREATE POLICY originales
--   (sección "Calendarios laborales") se referían a `WorkCalendar` y
--   `Holiday` correctamente, pero quedaron silenciosamente con 0
--   policies en producción (auditado vía pg_policies — wave P18 los
--   omitió y nadie volvió a tocarlos). Las otras tres tablas
--   (CalendarConnection, CalendarEvent, Expense) nunca tuvieron policy.
--
-- Comportamiento actual: con RLS enabled + 0 policies, Postgres bloquea
-- TODO acceso desde anon/authenticated (deny-by-default). Las queries
-- de la app funcionan porque el backend usa service_role (BYPASSRLS),
-- pero el escenario es frágil: si mañana migramos a roles no-bypass,
-- la app se cae.
--
-- Esta migración define policies EXPLÍCITAS por tabla aplicando la
-- semántica correcta de cada dominio:
--
-- ┌──────────────────────┬───────────────────┬──────────────────────────────────────┐
-- │ Tabla                │ Scope             │ Policy aplicada                      │
-- ├──────────────────────┼───────────────────┼──────────────────────────────────────┤
-- │ WorkCalendar         │ Global (sistema)  │ SELECT autenticado · ALL solo ADMIN  │
-- │ Holiday              │ Global (sistema)  │ SELECT autenticado · ALL solo ADMIN  │
-- │ CalendarConnection   │ User-owned        │ Solo el dueño (userId)               │
-- │ CalendarEvent        │ User-owned (FK)   │ Hereda de CalendarConnection         │
-- │ Expense              │ Project-scoped    │ is_project_member + submitter        │
-- └──────────────────────┴───────────────────┴──────────────────────────────────────┘
--
-- ADMIN/SUPER_ADMIN tienen bypass natural via is_project_member y vía
-- check explícito (UserRole).
--
-- Pre-requisitos:
--   - Migración `20260511_r4a_app_is_project_member_search_path` debe
--     haberse aplicado (helpers app.*).
--
-- Idempotente: DROP POLICY IF EXISTS antes de CREATE.

-- ── Guard ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'is_project_member'
  ) THEN
    RAISE EXCEPTION
      'Helper app.is_project_member no existe. Aplicar primero 20260511_r4a_app_is_project_member_search_path.';
  END IF;
END$$;


-- ─────────────────────────────────────────────────────────────────────
-- 1. WorkCalendar — calendario laboral global del sistema (catálogo)
-- ─────────────────────────────────────────────────────────────────────
-- SELECT abierto a cualquier usuario autenticado (es metadata pública
-- usada por CPM/Gantt). Mutaciones solo ADMIN/SUPER_ADMIN.
DROP POLICY IF EXISTS "WorkCalendar_select_authenticated" ON "WorkCalendar";
CREATE POLICY "WorkCalendar_select_authenticated" ON "WorkCalendar"
  FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL
         AND current_setting('app.user_id', true) <> '');
COMMENT ON POLICY "WorkCalendar_select_authenticated" ON "WorkCalendar" IS
  'R4-A · Calendario laboral es metadata global; cualquier user autenticado lee.';

DROP POLICY IF EXISTS "WorkCalendar_admin_write" ON "WorkCalendar";
CREATE POLICY "WorkCalendar_admin_write" ON "WorkCalendar"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = current_setting('app.user_id', true)
        AND r.name IN ('ADMIN', 'SUPER_ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = current_setting('app.user_id', true)
        AND r.name IN ('ADMIN', 'SUPER_ADMIN')
    )
  );
COMMENT ON POLICY "WorkCalendar_admin_write" ON "WorkCalendar" IS
  'R4-A · Solo ADMIN/SUPER_ADMIN crean/editan/borran calendarios laborales.';


-- ─────────────────────────────────────────────────────────────────────
-- 2. Holiday — días festivos asociados a un WorkCalendar (catálogo)
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Holiday_select_authenticated" ON "Holiday";
CREATE POLICY "Holiday_select_authenticated" ON "Holiday"
  FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL
         AND current_setting('app.user_id', true) <> '');
COMMENT ON POLICY "Holiday_select_authenticated" ON "Holiday" IS
  'R4-A · Festivos son metadata global; cualquier user autenticado lee.';

DROP POLICY IF EXISTS "Holiday_admin_write" ON "Holiday";
CREATE POLICY "Holiday_admin_write" ON "Holiday"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = current_setting('app.user_id', true)
        AND r.name IN ('ADMIN', 'SUPER_ADMIN')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = current_setting('app.user_id', true)
        AND r.name IN ('ADMIN', 'SUPER_ADMIN')
    )
  );
COMMENT ON POLICY "Holiday_admin_write" ON "Holiday" IS
  'R4-A · Solo ADMIN/SUPER_ADMIN gestionan festivos.';


-- ─────────────────────────────────────────────────────────────────────
-- 3. CalendarConnection — OAuth tokens del usuario · STRICT user-owned
-- ─────────────────────────────────────────────────────────────────────
-- Contiene accessToken/refreshToken/icsToken: HIGHLY SENSITIVE. Solo
-- el dueño puede leer/escribir. ADMIN NO debería ver tokens externos
-- de otros usuarios (privacy).
DROP POLICY IF EXISTS "CalendarConnection_owner_only" ON "CalendarConnection";
CREATE POLICY "CalendarConnection_owner_only" ON "CalendarConnection"
  FOR ALL
  USING ("userId" = current_setting('app.user_id', true))
  WITH CHECK ("userId" = current_setting('app.user_id', true));
COMMENT ON POLICY "CalendarConnection_owner_only" ON "CalendarConnection" IS
  'R4-A · OAuth tokens son STRICT user-owned. Ni siquiera ADMIN puede leer tokens externos de otros (privacy).';


-- ─────────────────────────────────────────────────────────────────────
-- 4. CalendarEvent — ledger de sync; hereda visibilidad de la conexión
-- ─────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "CalendarEvent_inherit_connection" ON "CalendarEvent";
CREATE POLICY "CalendarEvent_inherit_connection" ON "CalendarEvent"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "CalendarConnection" c
      WHERE c.id = "CalendarEvent"."connectionId"
        AND c."userId" = current_setting('app.user_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "CalendarConnection" c
      WHERE c.id = "CalendarEvent"."connectionId"
        AND c."userId" = current_setting('app.user_id', true)
    )
  );
COMMENT ON POLICY "CalendarEvent_inherit_connection" ON "CalendarEvent" IS
  'R4-A · Eventos sincronizados solo visibles al dueño de la conexión (heredan privacy).';


-- ─────────────────────────────────────────────────────────────────────
-- 5. Expense — gastos del proyecto · is_project_member + submitter
-- ─────────────────────────────────────────────────────────────────────
-- Submitter siempre ve su propio gasto. Otros miembros del proyecto
-- pueden ver si pasan la matriz RBAC. Aprobadores ADMIN/finance ya
-- tienen bypass via is_project_member (rol elevado).
DROP POLICY IF EXISTS "Expense_member_or_submitter" ON "Expense";
CREATE POLICY "Expense_member_or_submitter" ON "Expense"
  FOR ALL
  USING (
    "submittedById" = current_setting('app.user_id', true)
    OR app.is_project_member(current_setting('app.user_id', true), "projectId")
  )
  WITH CHECK (
    "submittedById" = current_setting('app.user_id', true)
    OR app.is_project_member(current_setting('app.user_id', true), "projectId")
  );
COMMENT ON POLICY "Expense_member_or_submitter" ON "Expense" IS
  'R4-A · El submitter siempre ve su gasto + miembros del proyecto (PMs/finance) leen/aprueban.';


-- ─────────────────────────────────────────────────────────────────────
-- FIN · 5 tablas legacy ahora con policy explícita.
-- Verificación post-merge:
--   SELECT relname, relrowsecurity,
--     (SELECT COUNT(*) FROM pg_policies p WHERE p.tablename = c.relname) policies
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname='public'
--     AND c.relname IN ('CalendarConnection','CalendarEvent','Expense','Holiday','WorkCalendar');
-- ─────────────────────────────────────────────────────────────────────
