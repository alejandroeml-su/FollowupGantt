-- Wave P18 (hardening) — RLS restrictivas con app.is_project_member()
--
-- ⚠️  NO APLICAR todavía sin completar primero:
--   1. SQL function `app.is_project_member(p_user_id text, p_project_id text)`
--      ya existe (Wave P14d · 20260509_p14d_rls_is_project_member).
--   2. Las server actions deben ejecutarse dentro de `withRlsContext`
--      (src/lib/db/with-rls-context.ts) para que `app.user_id` esté seteado
--      como GUC durante la transacción.
--   3. Sin esa integración, las queries fuera del wrapper devolverán
--      0 filas porque `current_setting('app.user_id', true)` será NULL
--      y la política restrictiva las bloquea.
--
-- Esta migración cubre las tablas project-scoped de Wave P12 + P14:
--   - Impediment, ImprovementItem, DailyScrum (Scrum 100%)
--   - LessonLearned, EvmSnapshot (PMI 100%)
--   - Stakeholder, ChangeRequest (PMI compliance previo)
--
-- Para activar gradualmente: aplicar este file + envolver server actions
-- de cada dominio en `withRlsContextFromSession` antes de quitar el flag
-- de "permissive" en otras políticas.

-- ─────────────────────────────────────────────────────────────
-- Pre-check: la función helper debe existir antes de aplicar.
-- ─────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────
-- Helper: política restrictiva genérica para tablas con projectId.
--
-- Patrón: USING (app.is_project_member(current_setting('app.user_id', true), "projectId"))
-- · Si `app.user_id` no está seteado, `current_setting(..., true)` devuelve
--   NULL y la función devuelve FALSE → fila bloqueada (fail-safe).
-- · WITH CHECK idéntico para INSERT/UPDATE.
-- ─────────────────────────────────────────────────────────────

-- ── Impediment ──
DROP POLICY IF EXISTS "Impediment_all" ON "Impediment";
DROP POLICY IF EXISTS "Impediment_member_only" ON "Impediment";
CREATE POLICY "Impediment_member_only" ON "Impediment"
  FOR ALL
  USING (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  )
  WITH CHECK (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  );

-- ── ImprovementItem ──
DROP POLICY IF EXISTS "ImprovementItem_all" ON "ImprovementItem";
DROP POLICY IF EXISTS "ImprovementItem_member_only" ON "ImprovementItem";
CREATE POLICY "ImprovementItem_member_only" ON "ImprovementItem"
  FOR ALL
  USING (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  )
  WITH CHECK (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  );

-- ── DailyScrum ──
DROP POLICY IF EXISTS "DailyScrum_all" ON "DailyScrum";
DROP POLICY IF EXISTS "DailyScrum_member_only" ON "DailyScrum";
CREATE POLICY "DailyScrum_member_only" ON "DailyScrum"
  FOR ALL
  USING (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  )
  WITH CHECK (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  );

-- ── LessonLearned ──
DROP POLICY IF EXISTS "LessonLearned_all" ON "LessonLearned";
DROP POLICY IF EXISTS "LessonLearned_member_only" ON "LessonLearned";
CREATE POLICY "LessonLearned_member_only" ON "LessonLearned"
  FOR ALL
  USING (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  )
  WITH CHECK (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  );

-- ── EvmSnapshot ──
DROP POLICY IF EXISTS "EvmSnapshot_all" ON "EvmSnapshot";
DROP POLICY IF EXISTS "EvmSnapshot_member_only" ON "EvmSnapshot";
CREATE POLICY "EvmSnapshot_member_only" ON "EvmSnapshot"
  FOR ALL
  USING (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  )
  WITH CHECK (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  );

-- ── Stakeholder ──
DROP POLICY IF EXISTS "Stakeholder_all" ON "Stakeholder";
DROP POLICY IF EXISTS "Stakeholder_member_only" ON "Stakeholder";
CREATE POLICY "Stakeholder_member_only" ON "Stakeholder"
  FOR ALL
  USING (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  )
  WITH CHECK (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  );

-- ── ChangeRequest ──
DROP POLICY IF EXISTS "ChangeRequest_all" ON "ChangeRequest";
DROP POLICY IF EXISTS "ChangeRequest_member_only" ON "ChangeRequest";
CREATE POLICY "ChangeRequest_member_only" ON "ChangeRequest"
  FOR ALL
  USING (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  )
  WITH CHECK (
    app.is_project_member(
      current_setting('app.user_id', true),
      "projectId"
    )
  );

COMMENT ON POLICY "Impediment_member_only" ON "Impediment" IS
  'Wave P18 hardening — Solo miembros del proyecto via app.is_project_member(). Requiere app.user_id seteado en la sesión vía withRlsContext.';
