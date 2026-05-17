-- ─────────────────────────────────────────────────────────────────
-- Wave R5 · US-9.3 — CMDB simplificado · Migración Postgres (Supabase)
-- ─────────────────────────────────────────────────────────────────
--
-- Aplicar via MCP `apply_migration` (project_id = bpiugqsjnlwqfhbnkirh)
-- con autorización explícita de Edwin. Diferida del feature branch.
--
-- Crea:
--   - enum  `CIType`         (10 categorías de Configuration Item)
--   - enum  `CIStatus`        (5 estados operativos)
--   - enum  `CICriticality`   (LOW/MEDIUM/HIGH/CRITICAL)
--   - enum  `CIRelationKind`  (5 verbos de relación entre CIs)
--   - enum  `CILinkRole`      (4 roles de afectación Task→CI)
--   - table `ConfigurationItem`  (CI workspace-scoped + atributos Json)
--   - table `CIRelation`         (M:N CI↔CI tipificado por kind)
--   - table `TaskCILink`         (M:N Task↔CI tipificado por role)
--
-- Idempotente: usa IF NOT EXISTS / DO $$ donde aplica para tolerar
-- re-aplicación parcial.
-- ─────────────────────────────────────────────────────────────────

-- 1. Enums ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CIType') THEN
    CREATE TYPE "CIType" AS ENUM (
      'SERVICE', 'APPLICATION', 'SERVER', 'DATABASE', 'NETWORK_DEVICE',
      'ENDPOINT', 'DOCUMENT', 'BUSINESS_PROCESS', 'CONTRACT', 'OTHER'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CIStatus') THEN
    CREATE TYPE "CIStatus" AS ENUM (
      'PLANNED', 'ACTIVE', 'MAINTENANCE', 'RETIRED', 'INCIDENT'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CICriticality') THEN
    CREATE TYPE "CICriticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CIRelationKind') THEN
    CREATE TYPE "CIRelationKind" AS ENUM (
      'DEPENDS_ON', 'RUNS_ON', 'USES', 'CONTAINS', 'RELATED_TO'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CILinkRole') THEN
    CREATE TYPE "CILinkRole" AS ENUM (
      'AFFECTED', 'CAUSE', 'AFFECTED_DOWNSTREAM', 'INFORMATIONAL'
    );
  END IF;
END$$;

-- 2. Tabla ConfigurationItem ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ConfigurationItem" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "type"        "CIType" NOT NULL DEFAULT 'OTHER',
  "status"      "CIStatus" NOT NULL DEFAULT 'ACTIVE',
  "criticality" "CICriticality" NOT NULL DEFAULT 'MEDIUM',
  "ownerId"     TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "environment" TEXT,
  "description" TEXT,
  "attributes"  JSONB,
  "retiredAt"   TIMESTAMP(3),
  "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConfigurationItem_workspaceId_code_key"
  ON "ConfigurationItem" ("workspaceId", "code");

CREATE INDEX IF NOT EXISTS "ConfigurationItem_workspaceId_type_idx"
  ON "ConfigurationItem" ("workspaceId", "type");
CREATE INDEX IF NOT EXISTS "ConfigurationItem_workspaceId_status_idx"
  ON "ConfigurationItem" ("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "ConfigurationItem_workspaceId_criticality_idx"
  ON "ConfigurationItem" ("workspaceId", "criticality");
CREATE INDEX IF NOT EXISTS "ConfigurationItem_workspaceId_retiredAt_idx"
  ON "ConfigurationItem" ("workspaceId", "retiredAt");
CREATE INDEX IF NOT EXISTS "ConfigurationItem_ownerId_idx"
  ON "ConfigurationItem" ("ownerId");

-- 3. Tabla CIRelation ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CIRelation" (
  "id"        TEXT PRIMARY KEY,
  "fromCIId"  TEXT NOT NULL REFERENCES "ConfigurationItem"("id") ON DELETE CASCADE,
  "toCIId"    TEXT NOT NULL REFERENCES "ConfigurationItem"("id") ON DELETE CASCADE,
  "kind"      "CIRelationKind" NOT NULL DEFAULT 'DEPENDS_ON',
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "CIRelation_fromCIId_toCIId_kind_key"
  ON "CIRelation" ("fromCIId", "toCIId", "kind");
CREATE INDEX IF NOT EXISTS "CIRelation_fromCIId_idx"
  ON "CIRelation" ("fromCIId");
CREATE INDEX IF NOT EXISTS "CIRelation_toCIId_idx"
  ON "CIRelation" ("toCIId");

-- 4. Tabla TaskCILink ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TaskCILink" (
  "id"        TEXT PRIMARY KEY,
  "taskId"    TEXT NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE,
  "ciId"      TEXT NOT NULL REFERENCES "ConfigurationItem"("id") ON DELETE CASCADE,
  "role"      "CILinkRole" NOT NULL DEFAULT 'AFFECTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaskCILink_taskId_ciId_role_key"
  ON "TaskCILink" ("taskId", "ciId", "role");
CREATE INDEX IF NOT EXISTS "TaskCILink_taskId_idx"
  ON "TaskCILink" ("taskId");
CREATE INDEX IF NOT EXISTS "TaskCILink_ciId_idx"
  ON "TaskCILink" ("ciId");

-- 5. RLS opcional (no la activamos en esta migración para mantener
-- paridad con el resto de tablas workspace-scoped; lo cubrirá la wave
-- de RLS hardening junto con el resto del módulo CMDB cuando se decida).
