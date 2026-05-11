-- Wave P18 hardening — Activación incremental RLS restrictivas (DailyScrum).
--
-- Aplica la política `DailyScrum_member_only` y DESACTIVA la
-- open-policy heredada. DailyScrum NO tiene projectId directo · se
-- resuelve la pertenencia vía subquery a Sprint (sprintId → projectId).
--
-- Pre-requisito: las server actions de daily-scrum.ts deben pasar por
-- `withRlsContextFromSession()` para que `current_setting('app.user_id')`
-- esté seteado durante la transacción. Sin eso las queries devolverían
-- 0 filas (fail-safe).
--
-- Guard: aborta si app.is_project_member no existe (Wave P14d).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'is_project_member'
  ) THEN
    RAISE EXCEPTION
      'Helper app.is_project_member no existe. Aplicar primero migración 20260509_p14d_rls_is_project_member.';
  END IF;
END$$;

-- ── DailyScrum ──
-- Variante con subquery: DailyScrum no tiene projectId. Resolvemos
-- vía Sprint. La policy de Sprint sigue siendo permissive (no se
-- restringe en este PR), por lo que la subquery NO entra en loop.
DROP POLICY IF EXISTS "DailyScrum_all" ON "DailyScrum";
DROP POLICY IF EXISTS "DailyScrum_member_only" ON "DailyScrum";
CREATE POLICY "DailyScrum_member_only" ON "DailyScrum"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Sprint" s
      WHERE s."id" = "DailyScrum"."sprintId"
        AND app.is_project_member(
          current_setting('app.user_id', true),
          s."projectId"
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Sprint" s
      WHERE s."id" = "DailyScrum"."sprintId"
        AND app.is_project_member(
          current_setting('app.user_id', true),
          s."projectId"
        )
    )
  );

COMMENT ON POLICY "DailyScrum_member_only" ON "DailyScrum" IS
  'Wave P18 hardening · activado 2026-05-10 · solo miembros del proyecto (resuelto vía Sprint.projectId). Requiere withRlsContextFromSession en las server actions.';
