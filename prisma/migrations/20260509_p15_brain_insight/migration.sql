-- Wave P15 (Brain Project Insights AI) — schema aditivo.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BrainInsightKind') THEN
    CREATE TYPE "BrainInsightKind" AS ENUM ('FORECAST', 'RECOMMENDATION', 'ANOMALY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BrainInsightSeverity') THEN
    CREATE TYPE "BrainInsightSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BrainInsightStatus') THEN
    CREATE TYPE "BrainInsightStatus" AS ENUM ('NEW', 'APPLIED', 'DISMISSED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "BrainInsight" (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "projectId"    TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "kind"         "BrainInsightKind"     NOT NULL,
  "title"        TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "severity"     "BrainInsightSeverity" NOT NULL DEFAULT 'MEDIUM',
  "relatedAction" JSONB,
  "status"       "BrainInsightStatus"   NOT NULL DEFAULT 'NEW',
  "appliedAt"    TIMESTAMP(3),
  "dismissedAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "BrainInsight_projectId_kind_status_idx"
  ON "BrainInsight"("projectId", "kind", "status");
CREATE INDEX IF NOT EXISTS "BrainInsight_createdAt_idx"
  ON "BrainInsight"("createdAt");

ALTER TABLE "BrainInsight" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "BrainInsight_all" ON "BrainInsight";
CREATE POLICY "BrainInsight_all" ON "BrainInsight" FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE "BrainInsight" IS
  'Wave P15 — Insights generados por Avante Brain AI sobre proyectos · 3 kinds (FORECAST/RECOMMENDATION/ANOMALY) · status workflow NEW→APPLIED|DISMISSED · alimenta Risk Register / Improvements / Tasks vía relatedAction.';
