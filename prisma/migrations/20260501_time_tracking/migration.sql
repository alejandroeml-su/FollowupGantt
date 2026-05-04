-- 2026-05-01 · @Dev · Ola P1 Equipo 4 — Time Tracking + Timesheets.
-- Añade los modelos `TimeEntry` (entries de tiempo, timer + manual) y
-- `UserHourlyRate` (historial de tarifas horarias por usuario). La suma
-- de `TimeEntry.cost` por tarea alimenta `Task.actualCost` real para EVM.
--
-- Aplicación (idempotente):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260501_time_tracking/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
-- Patrón de referencia: prisma/migrations/20260425_task_collaborators_and_reference_url/migration.sql.

-- ─── TimeEntry ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TimeEntry" (
  "id"              TEXT          NOT NULL,
  "userId"          TEXT          NOT NULL,
  "taskId"          TEXT          NOT NULL,
  "startedAt"       TIMESTAMP(3)  NOT NULL,
  "endedAt"         TIMESTAMP(3),
  "durationMinutes" INTEGER       NOT NULL DEFAULT 0,
  "description"     TEXT,
  "hourlyRate"      DECIMAL(10,2),
  "cost"            DECIMAL(12,2),
  "createdAt"       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TimeEntry_userId_startedAt_idx"
  ON "TimeEntry" ("userId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "TimeEntry_taskId_startedAt_idx"
  ON "TimeEntry" ("taskId", "startedAt" DESC);

ALTER TABLE "TimeEntry"
  DROP CONSTRAINT IF EXISTS "TimeEntry_userId_fkey",
  ADD CONSTRAINT  "TimeEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimeEntry"
  DROP CONSTRAINT IF EXISTS "TimeEntry_taskId_fkey",
  ADD CONSTRAINT  "TimeEntry_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── UserHourlyRate ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UserHourlyRate" (
  "id"         TEXT          NOT NULL,
  "userId"     TEXT          NOT NULL,
  "rate"       DECIMAL(10,2) NOT NULL,
  "validFrom"  TIMESTAMP(3)  NOT NULL,
  "validUntil" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserHourlyRate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserHourlyRate_userId_validFrom_idx"
  ON "UserHourlyRate" ("userId", "validFrom");

ALTER TABLE "UserHourlyRate"
  DROP CONSTRAINT IF EXISTS "UserHourlyRate_userId_fkey",
  ADD CONSTRAINT  "UserHourlyRate_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
