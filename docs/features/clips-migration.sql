-- ─────────────────────────────────────────────────────────────────────
-- Migration · US-7.3 · Clips de video (R4)
-- Branch: feat/us-7-3-clips-video
-- Fecha: 2026-05-16
-- ─────────────────────────────────────────────────────────────────────
--
-- NO aplicar automáticamente. Edwin autoriza vía MCP
-- (mcp__claude_ai_Supabase__apply_migration) cuando proceda.
--
-- Crea la tabla "Clip" para grabaciones de pantalla in-browser:
--   - Asociada a Task O a Comment (XOR, enforced por CHECK).
--   - storagePath apunta al bucket "clips".
--   - thumbnailPath apunta al primer frame (jpeg) en el mismo bucket.
--   - durationSec capturado del MediaRecorder, sizeBytes del blob.
--   - mimeType siempre "video/webm" (vp9/opus o vp8/opus fallback).
--
-- Convenciones del repo:
--   - id uuid default uuid_generate_v4() / gen_random_uuid().
--   - createdAt timestamp con default now().
--   - FK ON DELETE CASCADE para Task/Comment (al borrar el padre se
--     borran sus clips); ON DELETE SET NULL para authorId (preservamos
--     historial aunque el author sea archivado).
--
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Clip" (
  "id"            TEXT PRIMARY KEY,
  "taskId"        TEXT NULL,
  "commentId"     TEXT NULL,
  "authorId"      TEXT NULL,

  -- Rutas en bucket "clips/{userId}/{clipId}/video.webm" + "/thumb.jpg".
  "storagePath"   TEXT NOT NULL,
  "thumbnailPath" TEXT NULL,

  "durationSec"   INTEGER NOT NULL DEFAULT 0,
  "sizeBytes"     INTEGER NOT NULL DEFAULT 0,
  "mimeType"      TEXT NOT NULL DEFAULT 'video/webm',

  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- XOR: el clip pertenece a una task O a un comment, no ambos ni ninguno.
  CONSTRAINT "Clip_target_xor"
    CHECK (
      ("taskId" IS NOT NULL AND "commentId" IS NULL)
      OR
      ("taskId" IS NULL AND "commentId" IS NOT NULL)
    ),

  CONSTRAINT "Clip_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT "Clip_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "Comment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT "Clip_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- Índices para listar clips por task/comment ordenados por fecha desc.
CREATE INDEX IF NOT EXISTS "Clip_taskId_createdAt_idx"
  ON "Clip" ("taskId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Clip_commentId_createdAt_idx"
  ON "Clip" ("commentId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "Clip_authorId_idx"
  ON "Clip" ("authorId");

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK manual (si fuera necesario):
--   DROP TABLE IF EXISTS "Clip" CASCADE;
-- ─────────────────────────────────────────────────────────────────────
