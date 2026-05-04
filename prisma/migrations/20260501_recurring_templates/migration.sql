-- 2026-05-01 · @DBA · Ola P2 / Equipo P2-3 — Tasks recurrentes + Templates.
-- Crea el enum `RecurrenceFreq`, las tablas `TaskTemplate` /
-- `RecurrenceRule` y extiende `Task` con `recurrenceRuleId` /
-- `occurrenceDate` + `@@unique([recurrenceRuleId, occurrenceDate])`.
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260501_recurring_templates/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios pendientes del schema).
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS donde aplica.
-- IMPORTANTE: convención del proyecto = NO ejecutar `prisma db push` productivo
-- automatizado. Edwin aplica este SQL manualmente cuando promueve a entornos.

-- ─── enum RecurrenceFreq ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecurrenceFreq') THEN
    CREATE TYPE "RecurrenceFreq" AS ENUM (
      'DAILY',
      'WEEKLY',
      'MONTHLY',
      'YEARLY'
    );
  END IF;
END$$;

-- ─── TaskTemplate ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TaskTemplate" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "projectId"   TEXT,
  "taskShape"   JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "isShared"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TaskTemplate_projectId_idx" ON "TaskTemplate" ("projectId");
CREATE INDEX IF NOT EXISTS "TaskTemplate_createdById_idx" ON "TaskTemplate" ("createdById");

ALTER TABLE "TaskTemplate"
  DROP CONSTRAINT IF EXISTS "TaskTemplate_projectId_fkey",
  ADD  CONSTRAINT "TaskTemplate_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaskTemplate"
  DROP CONSTRAINT IF EXISTS "TaskTemplate_createdById_fkey",
  ADD  CONSTRAINT "TaskTemplate_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── RecurrenceRule ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "RecurrenceRule" (
  "id"              TEXT NOT NULL,
  "templateId"      TEXT NOT NULL,
  "frequency"       "RecurrenceFreq" NOT NULL,
  "interval"        INTEGER NOT NULL DEFAULT 1,
  "byweekday"       INTEGER[] NOT NULL DEFAULT '{}',
  "bymonthday"      INTEGER[] NOT NULL DEFAULT '{}',
  "startDate"       TIMESTAMP(3) NOT NULL,
  "endDate"         TIMESTAMP(3),
  "count"           INTEGER,
  "lastGeneratedAt" TIMESTAMP(3),
  "active"          BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurrenceRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RecurrenceRule_active_lastGeneratedAt_idx"
  ON "RecurrenceRule" ("active", "lastGeneratedAt");
CREATE INDEX IF NOT EXISTS "RecurrenceRule_templateId_idx"
  ON "RecurrenceRule" ("templateId");

ALTER TABLE "RecurrenceRule"
  DROP CONSTRAINT IF EXISTS "RecurrenceRule_templateId_fkey",
  ADD  CONSTRAINT "RecurrenceRule_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Extensiones a Task ───────────────────────────────────────────
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "recurrenceRuleId" TEXT,
  ADD COLUMN IF NOT EXISTS "occurrenceDate"   TIMESTAMP(3);

ALTER TABLE "Task"
  DROP CONSTRAINT IF EXISTS "Task_recurrenceRuleId_fkey",
  ADD  CONSTRAINT "Task_recurrenceRuleId_fkey"
    FOREIGN KEY ("recurrenceRuleId") REFERENCES "RecurrenceRule"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "Task_recurrenceRuleId_occurrenceDate_key"
  ON "Task" ("recurrenceRuleId", "occurrenceDate");
