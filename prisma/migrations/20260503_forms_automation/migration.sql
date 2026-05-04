-- 2026-05-03 · @DBA · Ola P5 / Equipo P5-5 — Formularios públicos + motor
-- de automatizaciones (if-this-then-that).
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260503_forms_automation/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios pendientes).
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS donde aplica.
-- IMPORTANTE: convención del proyecto = NO ejecutar `prisma db push` productivo
-- automatizado. Edwin aplica este SQL manualmente al promover entornos.

-- ─── PublicForm ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PublicForm" (
  "id"                      TEXT NOT NULL,
  "slug"                    TEXT NOT NULL,
  "title"                   TEXT NOT NULL,
  "description"             TEXT,
  "projectId"               TEXT,
  "schema"                  JSONB NOT NULL,
  "targetTaskTitleTemplate" TEXT NOT NULL DEFAULT 'Submission de {slug}',
  "isActive"                BOOLEAN NOT NULL DEFAULT true,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicForm_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PublicForm_slug_key" ON "PublicForm" ("slug");
CREATE INDEX IF NOT EXISTS "PublicForm_slug_idx" ON "PublicForm" ("slug");
CREATE INDEX IF NOT EXISTS "PublicForm_projectId_idx" ON "PublicForm" ("projectId");

ALTER TABLE "PublicForm"
  DROP CONSTRAINT IF EXISTS "PublicForm_projectId_fkey",
  ADD  CONSTRAINT "PublicForm_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── FormSubmission ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FormSubmission" (
  "id"          TEXT NOT NULL,
  "formId"      TEXT NOT NULL,
  "payload"     JSONB NOT NULL,
  "taskId"      TEXT,
  "ip"          TEXT,
  "userAgent"   TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FormSubmission_formId_submittedAt_idx"
  ON "FormSubmission" ("formId", "submittedAt" DESC);
CREATE INDEX IF NOT EXISTS "FormSubmission_ip_submittedAt_idx"
  ON "FormSubmission" ("ip", "submittedAt" DESC);

ALTER TABLE "FormSubmission"
  DROP CONSTRAINT IF EXISTS "FormSubmission_formId_fkey",
  ADD  CONSTRAINT "FormSubmission_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "PublicForm"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── AutomationRule ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AutomationRule" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "projectId"  TEXT,
  "trigger"    JSONB NOT NULL,
  "conditions" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "actions"    JSONB NOT NULL DEFAULT '[]'::jsonb,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AutomationRule_isActive_idx" ON "AutomationRule" ("isActive");
CREATE INDEX IF NOT EXISTS "AutomationRule_projectId_idx" ON "AutomationRule" ("projectId");

ALTER TABLE "AutomationRule"
  DROP CONSTRAINT IF EXISTS "AutomationRule_projectId_fkey",
  ADD  CONSTRAINT "AutomationRule_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── AutomationExecution ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AutomationExecution" (
  "id"          TEXT NOT NULL,
  "ruleId"      TEXT NOT NULL,
  "triggeredBy" TEXT NOT NULL,
  "status"      TEXT NOT NULL,
  "result"      JSONB NOT NULL,
  "executedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AutomationExecution_ruleId_executedAt_idx"
  ON "AutomationExecution" ("ruleId", "executedAt" DESC);
CREATE INDEX IF NOT EXISTS "AutomationExecution_status_executedAt_idx"
  ON "AutomationExecution" ("status", "executedAt" DESC);

ALTER TABLE "AutomationExecution"
  DROP CONSTRAINT IF EXISTS "AutomationExecution_ruleId_fkey",
  ADD  CONSTRAINT "AutomationExecution_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
