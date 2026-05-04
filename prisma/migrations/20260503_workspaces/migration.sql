-- 2026-05-03 · @DBA · Ola P4 / Equipo P4-1 — Multi-tenancy / Workspaces.
-- Crea los enums `WorkspacePlan` y `WorkspaceRole`, las tablas `Workspace`,
-- `WorkspaceMember`, `WorkspaceInvitation` y añade `workspaceId` opcional a
-- `Project` (con su FK e índice).
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260503_workspaces/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios pendientes).
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS donde aplica.
-- IMPORTANTE: convención del proyecto = NO ejecutar `prisma db push` productivo
-- automatizado. Edwin aplica este SQL manualmente al promover entornos.

-- ─── enums ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspacePlan') THEN
    CREATE TYPE "WorkspacePlan" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkspaceRole') THEN
    CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
  END IF;
END$$;

-- ─── Workspace ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Workspace" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "slug"      TEXT NOT NULL,
  "plan"      "WorkspacePlan" NOT NULL DEFAULT 'FREE',
  "ownerId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_slug_key" ON "Workspace" ("slug");
CREATE INDEX IF NOT EXISTS "Workspace_ownerId_idx" ON "Workspace" ("ownerId");

ALTER TABLE "Workspace"
  DROP CONSTRAINT IF EXISTS "Workspace_ownerId_fkey",
  ADD  CONSTRAINT "Workspace_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── WorkspaceMember ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WorkspaceMember" (
  "workspaceId" TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "role"        "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("workspaceId", "userId")
);

CREATE INDEX IF NOT EXISTS "WorkspaceMember_userId_idx"
  ON "WorkspaceMember" ("userId");

ALTER TABLE "WorkspaceMember"
  DROP CONSTRAINT IF EXISTS "WorkspaceMember_workspaceId_fkey",
  ADD  CONSTRAINT "WorkspaceMember_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceMember"
  DROP CONSTRAINT IF EXISTS "WorkspaceMember_userId_fkey",
  ADD  CONSTRAINT "WorkspaceMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── WorkspaceInvitation ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WorkspaceInvitation" (
  "id"          TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "token"       TEXT NOT NULL,
  "role"        "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "invitedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceInvitation_token_key"
  ON "WorkspaceInvitation" ("token");
CREATE INDEX IF NOT EXISTS "WorkspaceInvitation_workspaceId_idx"
  ON "WorkspaceInvitation" ("workspaceId");
CREATE INDEX IF NOT EXISTS "WorkspaceInvitation_email_idx"
  ON "WorkspaceInvitation" ("email");

ALTER TABLE "WorkspaceInvitation"
  DROP CONSTRAINT IF EXISTS "WorkspaceInvitation_workspaceId_fkey",
  ADD  CONSTRAINT "WorkspaceInvitation_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceInvitation"
  DROP CONSTRAINT IF EXISTS "WorkspaceInvitation_invitedById_fkey",
  ADD  CONSTRAINT "WorkspaceInvitation_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Project.workspaceId (opcional inicial) ──────────────────────
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

CREATE INDEX IF NOT EXISTS "Project_workspaceId_idx"
  ON "Project" ("workspaceId");

ALTER TABLE "Project"
  DROP CONSTRAINT IF EXISTS "Project_workspaceId_fkey",
  ADD  CONSTRAINT "Project_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
