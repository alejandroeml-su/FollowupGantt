-- Wave P18-A (Quality Inspections + Defect Tracking) — PMI 100%.
-- Aditiva. Sin destrucciones. Idempotente vía IF NOT EXISTS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InspectionType') THEN
    CREATE TYPE "InspectionType" AS ENUM (
      'CODE_REVIEW', 'TEST_REVIEW', 'DESIGN_REVIEW', 'AUDIT', 'WALKTHROUGH'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InspectionResult') THEN
    CREATE TYPE "InspectionResult" AS ENUM (
      'PENDING', 'PASS', 'PASS_WITH_DEFECTS', 'FAIL'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DefectSeverity') THEN
    CREATE TYPE "DefectSeverity" AS ENUM (
      'CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DefectStatus') THEN
    CREATE TYPE "DefectStatus" AS ENUM (
      'OPEN', 'IN_REVIEW', 'FIXED', 'WONT_FIX', 'DUPLICATE'
    );
  END IF;
END$$;

-- ─── QualityInspection ───
CREATE TABLE IF NOT EXISTS "QualityInspection" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "projectId"   TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "taskId"      TEXT REFERENCES "Task"("id") ON DELETE SET NULL,
  "type"        "InspectionType" NOT NULL,
  "result"      "InspectionResult" NOT NULL DEFAULT 'PENDING',
  "inspectorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "scheduledAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "checklist"   JSONB,
  "summary"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "QualityInspection_projectId_result_idx"
  ON "QualityInspection"("projectId", "result");
CREATE INDEX IF NOT EXISTS "QualityInspection_taskId_idx"
  ON "QualityInspection"("taskId");
CREATE INDEX IF NOT EXISTS "QualityInspection_inspectorId_idx"
  ON "QualityInspection"("inspectorId");

-- ─── Defect ───
CREATE TABLE IF NOT EXISTS "Defect" (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "projectId"    TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "inspectionId" TEXT REFERENCES "QualityInspection"("id") ON DELETE SET NULL,
  "taskId"       TEXT REFERENCES "Task"("id") ON DELETE SET NULL,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "severity"     "DefectSeverity" NOT NULL DEFAULT 'MAJOR',
  "status"       "DefectStatus"   NOT NULL DEFAULT 'OPEN',
  "ownerId"      TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "reporterId"   TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "resolvedAt"   TIMESTAMP(3),
  "resolution"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Defect_projectId_status_severity_idx"
  ON "Defect"("projectId", "status", "severity");
CREATE INDEX IF NOT EXISTS "Defect_inspectionId_idx" ON "Defect"("inspectionId");
CREATE INDEX IF NOT EXISTS "Defect_taskId_idx"       ON "Defect"("taskId");
CREATE INDEX IF NOT EXISTS "Defect_ownerId_status_idx"
  ON "Defect"("ownerId", "status");

-- RLS aditiva (compatible con patrón open-policy del repo).
ALTER TABLE "QualityInspection" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "QualityInspection_all" ON "QualityInspection";
CREATE POLICY "QualityInspection_all" ON "QualityInspection"
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "Defect" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Defect_all" ON "Defect";
CREATE POLICY "Defect_all" ON "Defect"
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE "QualityInspection" IS
  'Wave P18-A — Inspecciones de calidad PMBOK (code review / test review / design review / audit / walkthrough) con checklist JSON y resultado workflow.';
COMMENT ON TABLE "Defect" IS
  'Wave P18-A — Defectos detectados durante inspecciones o reportados directamente · workflow OPEN→IN_REVIEW→FIXED|WONT_FIX|DUPLICATE.';
