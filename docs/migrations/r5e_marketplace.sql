-- ─────────────────────────────────────────────────────────────────
-- Wave R5 Extended · US R5E-Marketplace — Migración Supabase prod
-- ─────────────────────────────────────────────────────────────────
--
-- Aplicar via MCP `apply_migration` (project_id = bpiugqsjnlwqfhbnkirh)
-- con autorización explícita de Edwin. NO ejecutar `prisma migrate` local —
-- la BD se gestiona via MCP.
--
-- Crea:
--   - enum  `IntegrationStatus`   (CONNECTED / DISCONNECTED / ERROR)
--   - table `IntegrationInstall`  (1 install por (workspace, providerKey))
--   - column `Task.externalRefs`  (Json? con `{ github: {...} }` opcional)
--
-- Idempotente: usa `IF NOT EXISTS` y `DO $$ … END$$` para tolerar
-- re-aplicación parcial sin error.
-- ─────────────────────────────────────────────────────────────────

-- 1. Enum IntegrationStatus ───────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntegrationStatus') THEN
    CREATE TYPE "IntegrationStatus" AS ENUM (
      'CONNECTED', 'DISCONNECTED', 'ERROR'
    );
  END IF;
END$$;

-- 2. Tabla IntegrationInstall ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "IntegrationInstall" (
  "id"                  TEXT PRIMARY KEY,
  "workspaceId"         TEXT NOT NULL,
  "providerKey"         TEXT NOT NULL,
  "status"              "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
  "config"              JSONB NOT NULL,
  "installedById"       TEXT,
  "installedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"          TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0
);

-- Unique constraint: 1 install por (workspace, provider).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'IntegrationInstall_workspaceId_providerKey_key'
  ) THEN
    CREATE UNIQUE INDEX "IntegrationInstall_workspaceId_providerKey_key"
      ON "IntegrationInstall" ("workspaceId", "providerKey");
  END IF;
END$$;

-- Index para listados filtrados por workspace+status (UI marketplace).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'IntegrationInstall_workspaceId_status_idx'
  ) THEN
    CREATE INDEX "IntegrationInstall_workspaceId_status_idx"
      ON "IntegrationInstall" ("workspaceId", "status");
  END IF;
END$$;

-- FK a Workspace (cascade onDelete).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'IntegrationInstall_workspaceId_fkey'
      AND table_name = 'IntegrationInstall'
  ) THEN
    ALTER TABLE "IntegrationInstall"
      ADD CONSTRAINT "IntegrationInstall_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- FK a User (SetNull onDelete — preserva el install si se borra el usuario).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'IntegrationInstall_installedById_fkey'
      AND table_name = 'IntegrationInstall'
  ) THEN
    ALTER TABLE "IntegrationInstall"
      ADD CONSTRAINT "IntegrationInstall_installedById_fkey"
      FOREIGN KEY ("installedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- 3. Task.externalRefs ────────────────────────────────────────────
-- Añade la columna sólo si no existe. Json nullable, default NULL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Task'
      AND column_name = 'externalRefs'
  ) THEN
    ALTER TABLE "Task" ADD COLUMN "externalRefs" JSONB;
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────
-- Fin migración R5E Marketplace
-- ─────────────────────────────────────────────────────────────────
