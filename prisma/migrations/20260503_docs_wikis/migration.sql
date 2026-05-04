-- 2026-05-03 · @DBA · Ola P2 / Equipo P2-5 — Docs / Wikis (editor markdown
-- + tree jerárquico + versionado + vinculación opcional a Project/Task).
--
-- Aplicación:
--   1. Local:    psql $DATABASE_URL -f prisma/migrations/20260503_docs_wikis/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS donde aplica.
-- Convención del proyecto: NO ejecutamos `prisma db push` automatizado.
-- Edwin aplica este SQL manualmente al promover entornos.

-- ─── Doc ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Doc" (
  "id"           TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "content"      TEXT NOT NULL DEFAULT '',
  "parentId"     TEXT,
  "position"     DOUBLE PRECISION NOT NULL DEFAULT 1,
  "projectId"    TEXT,
  "taskId"       TEXT,
  "authorId"     TEXT NOT NULL,
  "lastEditorId" TEXT,
  "isArchived"   BOOLEAN NOT NULL DEFAULT false,
  "isPublic"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Doc_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Doc_parentId_position_idx"
  ON "Doc" ("parentId", "position");
CREATE INDEX IF NOT EXISTS "Doc_projectId_idx" ON "Doc" ("projectId");
CREATE INDEX IF NOT EXISTS "Doc_taskId_idx"    ON "Doc" ("taskId");
CREATE INDEX IF NOT EXISTS "Doc_isArchived_idx" ON "Doc" ("isArchived");

-- FKs (idempotentes vía DROP IF EXISTS + ADD)
ALTER TABLE "Doc"
  DROP CONSTRAINT IF EXISTS "Doc_parentId_fkey",
  ADD  CONSTRAINT "Doc_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Doc"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Doc"
  DROP CONSTRAINT IF EXISTS "Doc_projectId_fkey",
  ADD  CONSTRAINT "Doc_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Doc"
  DROP CONSTRAINT IF EXISTS "Doc_taskId_fkey",
  ADD  CONSTRAINT "Doc_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Doc"
  DROP CONSTRAINT IF EXISTS "Doc_authorId_fkey",
  ADD  CONSTRAINT "Doc_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Doc"
  DROP CONSTRAINT IF EXISTS "Doc_lastEditorId_fkey",
  ADD  CONSTRAINT "Doc_lastEditorId_fkey"
    FOREIGN KEY ("lastEditorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── DocVersion ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DocVersion" (
  "id"         TEXT NOT NULL,
  "docId"      TEXT NOT NULL,
  "content"    TEXT NOT NULL,
  "authorId"   TEXT NOT NULL,
  "changeNote" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DocVersion_docId_createdAt_idx"
  ON "DocVersion" ("docId", "createdAt" DESC);

ALTER TABLE "DocVersion"
  DROP CONSTRAINT IF EXISTS "DocVersion_docId_fkey",
  ADD  CONSTRAINT "DocVersion_docId_fkey"
    FOREIGN KEY ("docId") REFERENCES "Doc"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocVersion"
  DROP CONSTRAINT IF EXISTS "DocVersion_authorId_fkey",
  ADD  CONSTRAINT "DocVersion_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
