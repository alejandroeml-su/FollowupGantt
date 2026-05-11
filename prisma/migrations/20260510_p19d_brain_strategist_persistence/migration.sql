-- Wave P19-D (Brain Strategist Persistence) — schema aditivo.
--
-- Persiste los insights cross-project del Brain Strategist AI (P19-A/B/C)
-- para historial, comparación temporal mes-a-mes y workflow ACK/Resolve.
--
-- Idempotente: usa `CREATE TYPE` con guards `IF NOT EXISTS` y
-- `CREATE TABLE IF NOT EXISTS`. Seguro para re-aplicar sin destruir datos.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StrategistInsightKind') THEN
    CREATE TYPE "StrategistInsightKind" AS ENUM (
      'RESOURCE_CONTENTION',
      'DEPENDENCY_CONFLICT',
      'REUSABLE_LESSON',
      'PREDICTIVE_SCENARIO',
      'BALANCE_SUGGESTION'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StrategistInsightSeverity') THEN
    CREATE TYPE "StrategistInsightSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "BrainStrategistInsight" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId" TEXT,
  "kind"        "StrategistInsightKind"     NOT NULL,
  "severity"    "StrategistInsightSeverity" NOT NULL,
  "payload"     JSONB                       NOT NULL,
  "summary"     TEXT,
  "status"      TEXT                        NOT NULL DEFAULT 'NEW',
  "ackById"     TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "ackedAt"     TIMESTAMP(3),
  "resolvedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "BrainStrategistInsight_workspaceId_kind_status_idx"
  ON "BrainStrategistInsight" ("workspaceId", "kind", "status");

CREATE INDEX IF NOT EXISTS "BrainStrategistInsight_severity_createdAt_idx"
  ON "BrainStrategistInsight" ("severity", "createdAt" DESC);

-- RLS open-policy mientras se valida el flujo end-to-end. Las
-- olas P18 RLS-restrictive endurecerán estas políticas en otra
-- migración aparte (mismo patrón que BrainInsight).
ALTER TABLE "BrainStrategistInsight" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "BrainStrategistInsight_all" ON "BrainStrategistInsight";
CREATE POLICY "BrainStrategistInsight_all" ON "BrainStrategistInsight"
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE "BrainStrategistInsight" IS
  'Wave P19-D — Insights cross-project persistidos del Brain Strategist AI · 5 kinds · status workflow NEW->ACKNOWLEDGED->RESOLVED|DISMISSED · permite historial temporal y comparación mes-a-mes.';
