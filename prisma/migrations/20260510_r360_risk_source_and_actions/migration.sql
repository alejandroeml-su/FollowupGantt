-- Wave R-360 (post-P17) — Risk source tracking + Corrective Actions.
--
-- Aditiva. NO destructiva sobre Risk: solo agrega columnas con default
-- seguro para que las filas existentes queden con source=MANUAL.

-- ─── Enums nuevos ───
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RiskSource') THEN
    CREATE TYPE "RiskSource" AS ENUM ('MANUAL', 'HEURISTIC', 'BRAIN_AI', 'IMPORTED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RiskActionStatus') THEN
    CREATE TYPE "RiskActionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED');
  END IF;
END$$;

-- ─── Risk: source tracking ───
ALTER TABLE "Risk"
  ADD COLUMN IF NOT EXISTS "source" "RiskSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Risk"
  ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;

CREATE INDEX IF NOT EXISTS "Risk_source_sourceRef_idx"
  ON "Risk"("source", "sourceRef");

-- ─── RiskAction: corrective action plan per Risk ───
CREATE TABLE IF NOT EXISTS "RiskAction" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "riskId"      TEXT NOT NULL REFERENCES "Risk"("id") ON DELETE CASCADE,
  "description" TEXT NOT NULL,
  "ownerId"     TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "status"      "RiskActionStatus" NOT NULL DEFAULT 'PENDING',
  "dueDate"     TIMESTAMP(3),
  "doneAt"      TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "RiskAction_riskId_status_idx"
  ON "RiskAction"("riskId", "status");
CREATE INDEX IF NOT EXISTS "RiskAction_ownerId_status_idx"
  ON "RiskAction"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "RiskAction_dueDate_idx"
  ON "RiskAction"("dueDate");

-- RLS aditiva (compatible con el patrón open-policy del repo).
ALTER TABLE "RiskAction" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "RiskAction_all" ON "RiskAction";
CREATE POLICY "RiskAction_all" ON "RiskAction" FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE "RiskAction" IS
  'Wave R-360 — Acciones correctivas asociadas a un Risk · workflow PENDING→IN_PROGRESS→DONE|CANCELLED · alimenta la pantalla de gestión 360 de riesgos.';
COMMENT ON COLUMN "Risk"."source" IS
  'Wave R-360 — origen del riesgo (MANUAL/HEURISTIC/BRAIN_AI/IMPORTED) para trazabilidad y dedupe al promover insights.';
COMMENT ON COLUMN "Risk"."sourceRef" IS
  'Wave R-360 — ID externo del origen (taskInsightId / brainInsightId) para evitar promover el mismo insight dos veces.';
