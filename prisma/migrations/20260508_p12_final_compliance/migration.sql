-- Wave P12 · Final Compliance — Scrum 100% + PMI 100% visible.
-- Aditivo, idempotente; usa CREATE TYPE/TABLE IF NOT EXISTS y RLS permissive.
-- Aplicar a Supabase prod via MCP `apply_migration` cuando #144 esté mergeado.

-- ─────────────────────────────────────────────────────────────────────
-- Project flags + JSON columns
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "dodHardEnforce" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "communicationsPlan" JSONB;

-- ─────────────────────────────────────────────────────────────────────
-- ENUMs
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImpedimentSeverity') THEN
    CREATE TYPE "ImpedimentSeverity" AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImpedimentStatus') THEN
    CREATE TYPE "ImpedimentStatus" AS ENUM ('OPEN','IN_PROGRESS','RESOLVED','ESCALATED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ImprovementStatus') THEN
    CREATE TYPE "ImprovementStatus" AS ENUM ('OPEN','IN_PROGRESS','DONE','CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LessonCategory') THEN
    CREATE TYPE "LessonCategory" AS ENUM ('PROCESS','TECHNICAL','PEOPLE','TOOLS','RISK','QUALITY','COMMUNICATIONS','OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LessonVisibility') THEN
    CREATE TYPE "LessonVisibility" AS ENUM ('PROJECT','WORKSPACE','ORG');
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────
-- Impediment
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Impediment" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sprintId" TEXT NOT NULL REFERENCES "Sprint"("id") ON DELETE CASCADE,
  "raisedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "ownerId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "severity" "ImpedimentSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "ImpedimentStatus" NOT NULL DEFAULT 'OPEN',
  "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "resolvedAt" TIMESTAMP(3),
  "resolutionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "Impediment_sprintId_status_idx" ON "Impediment"("sprintId","status");

ALTER TABLE "Impediment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Impediment_all" ON "Impediment";
CREATE POLICY "Impediment_all" ON "Impediment" FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- DailyScrum
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DailyScrum" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sprintId" TEXT NOT NULL REFERENCES "Sprint"("id") ON DELETE CASCADE,
  "facilitatorId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "data" JSONB,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "DailyScrum_sprintId_scheduledFor_idx" ON "DailyScrum"("sprintId","scheduledFor");

ALTER TABLE "DailyScrum" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "DailyScrum_all" ON "DailyScrum";
CREATE POLICY "DailyScrum_all" ON "DailyScrum" FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- ImprovementItem
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ImprovementItem" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "retrospectiveId" TEXT REFERENCES "Retrospective"("id") ON DELETE SET NULL,
  "ownerId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "ImprovementStatus" NOT NULL DEFAULT 'OPEN',
  "dueDate" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "closeNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "ImprovementItem_projectId_status_idx" ON "ImprovementItem"("projectId","status");

ALTER TABLE "ImprovementItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ImprovementItem_all" ON "ImprovementItem";
CREATE POLICY "ImprovementItem_all" ON "ImprovementItem" FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- LessonLearned
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LessonLearned" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "capturedById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "title" TEXT NOT NULL,
  "category" "LessonCategory" NOT NULL DEFAULT 'PROCESS',
  "context" TEXT NOT NULL,
  "whatHappened" TEXT NOT NULL,
  "rootCause" TEXT,
  "recommendation" TEXT NOT NULL,
  "appliesTo" TEXT,
  "visibility" "LessonVisibility" NOT NULL DEFAULT 'WORKSPACE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "LessonLearned_projectId_idx" ON "LessonLearned"("projectId");
CREATE INDEX IF NOT EXISTS "LessonLearned_category_idx" ON "LessonLearned"("category");
CREATE INDEX IF NOT EXISTS "LessonLearned_visibility_idx" ON "LessonLearned"("visibility");

ALTER TABLE "LessonLearned" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "LessonLearned_all" ON "LessonLearned";
CREATE POLICY "LessonLearned_all" ON "LessonLearned" FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- EVMSnapshot
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "EVMSnapshot" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "plannedValue" DECIMAL(14,2) NOT NULL,
  "earnedValue" DECIMAL(14,2) NOT NULL,
  "actualCost" DECIMAL(14,2) NOT NULL,
  "budgetAtCompletion" DECIMAL(14,2),
  "cpi" DOUBLE PRECISION,
  "spi" DOUBLE PRECISION,
  "estimateAtCompletion" DECIMAL(14,2),
  "varianceAtCompletion" DECIMAL(14,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "EVMSnapshot_projectId_snapshotDate_idx" ON "EVMSnapshot"("projectId","snapshotDate");

ALTER TABLE "EVMSnapshot" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "EVMSnapshot_all" ON "EVMSnapshot";
CREATE POLICY "EVMSnapshot_all" ON "EVMSnapshot" FOR ALL USING (true) WITH CHECK (true);
