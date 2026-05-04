-- 2026-05-03 · Equipo P5-1 · Módulo Whiteboards (estilo Miro).
-- Crea las tablas Whiteboard y WhiteboardElement junto con el enum
-- WhiteboardElementType. Idempotente con IF NOT EXISTS.
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260503_whiteboards/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor.
--   3. Alternativa: npx prisma db push (recoge TODOS los cambios del schema).

-- ─── Enum WhiteboardElementType ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WhiteboardElementType') THEN
    CREATE TYPE "WhiteboardElementType" AS ENUM (
      'STICKY', 'SHAPE', 'CONNECTOR', 'TEXT', 'IMAGE'
    );
  END IF;
END$$;

-- ─── Whiteboard ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Whiteboard" (
  "id"          TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "projectId"   TEXT,
  "createdById" TEXT,
  "isArchived"  BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Whiteboard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Whiteboard_projectId_isArchived_idx"
  ON "Whiteboard" ("projectId", "isArchived");
CREATE INDEX IF NOT EXISTS "Whiteboard_createdById_idx"
  ON "Whiteboard" ("createdById");

ALTER TABLE "Whiteboard"
  DROP CONSTRAINT IF EXISTS "Whiteboard_projectId_fkey",
  ADD CONSTRAINT  "Whiteboard_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Whiteboard"
  DROP CONSTRAINT IF EXISTS "Whiteboard_createdById_fkey",
  ADD CONSTRAINT  "Whiteboard_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── WhiteboardElement ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WhiteboardElement" (
  "id"           TEXT NOT NULL,
  "whiteboardId" TEXT NOT NULL,
  "type"         "WhiteboardElementType" NOT NULL,
  "x"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "y"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "width"        DOUBLE PRECISION NOT NULL DEFAULT 160,
  "height"       DOUBLE PRECISION NOT NULL DEFAULT 120,
  "rotation"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "data"         JSONB NOT NULL,
  "zIndex"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhiteboardElement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WhiteboardElement_whiteboardId_zIndex_idx"
  ON "WhiteboardElement" ("whiteboardId", "zIndex");

ALTER TABLE "WhiteboardElement"
  DROP CONSTRAINT IF EXISTS "WhiteboardElement_whiteboardId_fkey",
  ADD CONSTRAINT  "WhiteboardElement_whiteboardId_fkey"
    FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
