-- Wave P20-C · Brain Auto-Pilot — schema aditivo.
--
-- Persiste el historial de runs del Auto-Pilot: cada apply de un
-- `AutoPilotProposal` se materializa en una fila con el snapshot
-- completo + las ops inversas (`rollbackOps`) necesarias para revertir.
--
-- Idempotente: `CREATE TABLE IF NOT EXISTS` + guards en políticas RLS.
-- Seguro para re-aplicar sin destruir datos.

CREATE TABLE IF NOT EXISTS "AutoPilotRun" (
  "id"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId"      TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "kind"             TEXT NOT NULL,
  "summary"          TEXT NOT NULL,
  "proposalSnapshot" JSONB NOT NULL,
  "appliedById"      TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "appliedAt"        TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "rolledBackAt"     TIMESTAMP(3),
  "rollbackOps"      JSONB
);

CREATE INDEX IF NOT EXISTS "AutoPilotRun_workspaceId_appliedAt_idx"
  ON "AutoPilotRun" ("workspaceId", "appliedAt" DESC);

-- RLS open-policy mientras se valida el flujo end-to-end. Las
-- olas P18 RLS-restrictive endurecerán estas políticas en otra
-- migración aparte (mismo patrón que BrainStrategistInsight).
ALTER TABLE "AutoPilotRun" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AutoPilotRun_all" ON "AutoPilotRun";
CREATE POLICY "AutoPilotRun_all" ON "AutoPilotRun"
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE "AutoPilotRun" IS
  'Wave P20-C — Historial de runs del Brain Auto-Pilot · proposal snapshot + rollback ops (JSONB declarativas) · permite revertir cualquier apply dentro de la ventana operativa (24h en UI).';
