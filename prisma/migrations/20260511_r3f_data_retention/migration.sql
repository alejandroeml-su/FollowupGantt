-- R3.0-F · Data Retention Policies (Wave R3 Fase 2 — Compliance)
--
-- Schema aditivo. Sin destrucciones. Idempotente.
--   - 2 enums:  RetentionDomain, RetentionPurgeStatus
--   - 2 tablas: RetentionPolicy, RetentionPurgeRun
--   - FK Cascade desde Workspace → RetentionPolicy → RetentionPurgeRun
--
-- Aplicación recomendada: `prisma db push` (alineado con convención del repo
-- — Edwin / E. Martinez, ver memoria operacional `project_followupgantt_tech.md`).
-- Si se aplica vía MCP execute_sql, todo el bloque puede correr en una sola
-- transacción (no hay ALTER TYPE ... ADD VALUE).

-- ──────────────────────────────────────────────────────────────────────
-- Enums
-- ──────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RetentionDomain') THEN
    CREATE TYPE "RetentionDomain" AS ENUM ('AUDIT_LOG', 'SESSION', 'NOTIFICATION', 'BRAIN_INSIGHT');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RetentionPurgeStatus') THEN
    CREATE TYPE "RetentionPurgeStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
  END IF;
END$$;

-- ──────────────────────────────────────────────────────────────────────
-- RetentionPolicy
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "RetentionPolicy" (
  "id"             TEXT PRIMARY KEY,
  "workspaceId"    TEXT NOT NULL,
  "domain"         "RetentionDomain" NOT NULL,
  "retainDays"     INTEGER NOT NULL,
  "enabled"        BOOLEAN NOT NULL DEFAULT TRUE,
  "lastPurgeAt"    TIMESTAMP(3),
  "lastPurgeCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK Workspace → RetentionPolicy (Cascade: archivar/borrar workspace barre policies).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RetentionPolicy_workspaceId_fkey'
  ) THEN
    ALTER TABLE "RetentionPolicy"
      ADD CONSTRAINT "RetentionPolicy_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- Unique compuesto (workspaceId, domain): una política por dominio × workspace.
CREATE UNIQUE INDEX IF NOT EXISTS "RetentionPolicy_workspaceId_domain_key"
  ON "RetentionPolicy" ("workspaceId", "domain");

CREATE INDEX IF NOT EXISTS "RetentionPolicy_workspaceId_idx"
  ON "RetentionPolicy" ("workspaceId");

CREATE INDEX IF NOT EXISTS "RetentionPolicy_enabled_idx"
  ON "RetentionPolicy" ("enabled");

-- ──────────────────────────────────────────────────────────────────────
-- RetentionPurgeRun
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "RetentionPurgeRun" (
  "id"           TEXT PRIMARY KEY,
  "policyId"     TEXT NOT NULL,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"  TIMESTAMP(3),
  "deletedCount" INTEGER NOT NULL DEFAULT 0,
  "status"       "RetentionPurgeStatus" NOT NULL DEFAULT 'RUNNING',
  "errorMessage" TEXT
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RetentionPurgeRun_policyId_fkey'
  ) THEN
    ALTER TABLE "RetentionPurgeRun"
      ADD CONSTRAINT "RetentionPurgeRun_policyId_fkey"
      FOREIGN KEY ("policyId") REFERENCES "RetentionPolicy"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- Índice clave para historial UI (últimas 10 runs por policy).
CREATE INDEX IF NOT EXISTS "RetentionPurgeRun_policyId_startedAt_idx"
  ON "RetentionPurgeRun" ("policyId", "startedAt" DESC);
