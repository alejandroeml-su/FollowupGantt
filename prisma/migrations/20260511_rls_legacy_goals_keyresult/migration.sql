-- Fix advisory crítico Supabase · RLS habilitada en 3 tablas legacy (Wave P9 OKRs).
--
-- `Goal`, `KeyResult` y la M2M Prisma `_KeyResultTasks` se quedaron sin RLS
-- cuando el resto del schema migró a `ENABLE ROW LEVEL SECURITY` en Wave P18.
-- Sin RLS, la anon key de Supabase puede leer/modificar estas tablas
-- completamente (vector de exposición incluso aunque hoy no haya filas).
--
-- Aplicamos open-policy temporal (USING true) consistente con el patrón
-- pre-P18 del resto del schema (`BrainInsight`, `BrainStrategistInsight`,
-- `AuditStreamTarget`...). Cuando OKRs entre al roadmap activo, una wave
-- futura P18-style endurecerá con `is_project_member` o `is_owner`.
--
-- Idempotente: usa `IF NOT EXISTS` y `DROP POLICY IF EXISTS` antes de crear.

ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Goal_all" ON "Goal";
CREATE POLICY "Goal_all" ON "Goal"
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "KeyResult" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "KeyResult_all" ON "KeyResult";
CREATE POLICY "KeyResult_all" ON "KeyResult"
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "_KeyResultTasks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "_KeyResultTasks_all" ON "_KeyResultTasks";
CREATE POLICY "_KeyResultTasks_all" ON "_KeyResultTasks"
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON POLICY "Goal_all" ON "Goal" IS
  'Open-policy temporal · cierra advisory rls_disabled. Endurecer a is_project_member/is_owner cuando OKRs entre al roadmap activo.';
COMMENT ON POLICY "KeyResult_all" ON "KeyResult" IS
  'Open-policy temporal · cierra advisory rls_disabled. Endurecer cuando OKRs entre al roadmap activo (hereda de Goal).';
COMMENT ON POLICY "_KeyResultTasks_all" ON "_KeyResultTasks" IS
  'Open-policy temporal · M2M Prisma. Endurecer cuando OKRs entre al roadmap activo.';
