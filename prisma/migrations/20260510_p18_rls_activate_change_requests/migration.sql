-- Wave P18 hardening — Activación incremental RLS restrictivas (ChangeRequest).
--
-- Aplica la política `ChangeRequest_member_only` y DESACTIVA la
-- open-policy heredada. Tabla con projectId directo.
--
-- Pre-requisito: las server actions de change-requests.ts deben pasar por
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

COMMENT ON POLICY "ChangeRequest_member_only" ON "ChangeRequest" IS
  'Wave P18 hardening · activado 2026-05-10 · solo miembros del proyecto vía app.is_project_member(). Requiere withRlsContextFromSession en las server actions.';
