-- 2026-04-25 · @Dev · Sprint 4 — Colaboradores M:N (Task ↔ User) y URL de referencia.
-- Añade el modelo `TaskCollaborator` (relación M:N adicional al `assigneeId` único)
-- y la columna `Task.referenceUrl` (enlace externo: Confluence, Figma, ticket).
--
-- Aplicación (idempotente):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260425_task_collaborators_and_reference_url/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push --accept-data-loss
--      (toma TODOS los cambios pendientes del schema; aquí no hay data loss
--       porque las nuevas columnas son nullable y la nueva tabla es nueva).
--
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS / ON CONFLICT.
-- Patrón de referencia: prisma/migrations/20260425_mindmap_tables/migration.sql.

-- ─── Task.referenceUrl ────────────────────────────────────────────
-- Columna nullable: backfill no requerido y deploys "verdes" aunque
-- queden filas legacy sin completar este campo.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "referenceUrl" TEXT;

-- ─── TaskCollaborator ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TaskCollaborator" (
  "taskId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskCollaborator_pkey" PRIMARY KEY ("taskId", "userId")
);

CREATE INDEX IF NOT EXISTS "TaskCollaborator_taskId_idx" ON "TaskCollaborator" ("taskId");
CREATE INDEX IF NOT EXISTS "TaskCollaborator_userId_idx" ON "TaskCollaborator" ("userId");

ALTER TABLE "TaskCollaborator"
  DROP CONSTRAINT IF EXISTS "TaskCollaborator_taskId_fkey",
  ADD CONSTRAINT  "TaskCollaborator_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskCollaborator"
  DROP CONSTRAINT IF EXISTS "TaskCollaborator_userId_fkey",
  ADD CONSTRAINT  "TaskCollaborator_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
