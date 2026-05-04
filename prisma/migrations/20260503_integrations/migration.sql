-- 2026-05-03 · @Dev · Ola P4 / Equipo P4-5 — Integraciones externas.
-- Crea el enum `IntegrationType`, la tabla `Integration` (Slack/Teams/GitHub)
-- y la tabla `TaskGitHubLink` para vincular tareas a issues/PRs de GitHub.
--
-- Aplicación (idempotente):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260503_integrations/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa (sólo dev): npx prisma db push.
--
-- Convención del repo: NO ejecutar `prisma db push` en productivo automatizado.
-- Edwin aplica este SQL manualmente al promover entornos (Vercel + Supabase).
-- Patrón de referencia: prisma/migrations/20260501_recurring_templates/migration.sql.

-- ─── Enum IntegrationType ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationType') THEN
    CREATE TYPE "IntegrationType" AS ENUM (
      'SLACK',
      'TEAMS',
      'GITHUB'
    );
  END IF;
END$$;

-- ─── Integration ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Integration" (
  "id"        TEXT NOT NULL,
  "type"      "IntegrationType" NOT NULL,
  "name"      TEXT NOT NULL,
  "config"    JSONB NOT NULL,
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "projectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Integration_type_enabled_idx"
  ON "Integration" ("type", "enabled");
CREATE INDEX IF NOT EXISTS "Integration_projectId_idx"
  ON "Integration" ("projectId");

ALTER TABLE "Integration"
  DROP CONSTRAINT IF EXISTS "Integration_projectId_fkey",
  ADD  CONSTRAINT "Integration_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── TaskGitHubLink ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TaskGitHubLink" (
  "id"           TEXT NOT NULL,
  "taskId"       TEXT NOT NULL,
  "repoFullName" TEXT NOT NULL,
  "issueNumber"  INTEGER NOT NULL,
  "kind"         TEXT NOT NULL DEFAULT 'ISSUE',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskGitHubLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaskGitHubLink_taskId_repoFullName_issueNumber_key"
  ON "TaskGitHubLink" ("taskId", "repoFullName", "issueNumber");
CREATE INDEX IF NOT EXISTS "TaskGitHubLink_taskId_idx"
  ON "TaskGitHubLink" ("taskId");
CREATE INDEX IF NOT EXISTS "TaskGitHubLink_repoFullName_issueNumber_idx"
  ON "TaskGitHubLink" ("repoFullName", "issueNumber");

ALTER TABLE "TaskGitHubLink"
  DROP CONSTRAINT IF EXISTS "TaskGitHubLink_taskId_fkey",
  ADD  CONSTRAINT "TaskGitHubLink_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
