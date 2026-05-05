-- 2026-05-04 · Equipo C-DEBT-1 · Wave C-debt — User.image + Checklists relacionales.
--
-- Resuelve dos deudas técnicas registradas:
--   1. `User.image` (URL/data-URI de avatar). Originalmente B1 (Wave P6) lo
--      dejó como TODO en `getCurrentUserPresence`. Necesario para
--      PresenceAvatars y futuro UX (avatares en menu/comentarios).
--   2. `Checklist` + `ChecklistItem` — modelo relacional que reemplaza el
--      hack P7-5 que guardaba la sugerencia IA como markdown anexado a
--      `task.description`.
--
-- Aplicación (idempotente · usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260504_user_image_checklist/migration.sql
--   2. Supabase: pegar este archivo en SQL Editor (o vía MCP `apply_migration`).
--   3. Alternativa dev: npx prisma db push  (NO en producción).
--
-- Patrón de referencia: prisma/migrations/20260504_push_subscriptions/migration.sql.

-- ─── User.image ─────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "image" TEXT;

-- ─── Checklist ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Checklist" (
  "id"        TEXT NOT NULL,
  "taskId"    TEXT NOT NULL,
  "title"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Checklist_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Checklist_taskId_idx" ON "Checklist"("taskId");

ALTER TABLE "Checklist"
  DROP CONSTRAINT IF EXISTS "Checklist_taskId_fkey",
  ADD CONSTRAINT  "Checklist_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── ChecklistItem ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ChecklistItem" (
  "id"          TEXT NOT NULL,
  "checklistId" TEXT NOT NULL,
  "text"        TEXT NOT NULL,
  "done"        BOOLEAN NOT NULL DEFAULT false,
  "position"    DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "doneAt"      TIMESTAMP(3),
  "doneById"    TEXT,
  CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChecklistItem_checklistId_position_idx"
  ON "ChecklistItem"("checklistId", "position");
CREATE INDEX IF NOT EXISTS "ChecklistItem_done_idx"
  ON "ChecklistItem"("done");

ALTER TABLE "ChecklistItem"
  DROP CONSTRAINT IF EXISTS "ChecklistItem_checklistId_fkey",
  ADD CONSTRAINT  "ChecklistItem_checklistId_fkey"
    FOREIGN KEY ("checklistId") REFERENCES "Checklist"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
