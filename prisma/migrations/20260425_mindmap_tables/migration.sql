-- 2026-04-25 · @DBA · Crear tablas del módulo Mapas Mentales (MindMup 3-style).
-- Recupera /mindmaps en producción tras merge de PR #8 que añadió los modelos
-- al schema.prisma pero no aplicó cambios a la BD (flujo del proyecto: db push).
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260425_mindmap_tables/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios pendientes del schema).
-- Idempotente: usa IF NOT EXISTS / ON CONFLICT donde aplica.

-- ─── MindMap ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MindMap" (
  "id"          TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "projectId"   TEXT,
  "ownerId"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MindMap_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MindMap_projectId_idx" ON "MindMap" ("projectId");
CREATE INDEX IF NOT EXISTS "MindMap_ownerId_idx"   ON "MindMap" ("ownerId");

ALTER TABLE "MindMap"
  DROP CONSTRAINT IF EXISTS "MindMap_projectId_fkey",
  ADD CONSTRAINT  "MindMap_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MindMap"
  DROP CONSTRAINT IF EXISTS "MindMap_ownerId_fkey",
  ADD CONSTRAINT  "MindMap_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── MindMapNode ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MindMapNode" (
  "id"        TEXT NOT NULL,
  "mindMapId" TEXT NOT NULL,
  "label"     TEXT NOT NULL DEFAULT 'Nuevo nodo',
  "note"      TEXT,
  "x"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "y"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "color"     TEXT,
  "isRoot"    BOOLEAN NOT NULL DEFAULT false,
  "taskId"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MindMapNode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MindMapNode_mindMapId_idx" ON "MindMapNode" ("mindMapId");
CREATE INDEX IF NOT EXISTS "MindMapNode_taskId_idx"    ON "MindMapNode" ("taskId");

ALTER TABLE "MindMapNode"
  DROP CONSTRAINT IF EXISTS "MindMapNode_mindMapId_fkey",
  ADD CONSTRAINT  "MindMapNode_mindMapId_fkey"
    FOREIGN KEY ("mindMapId") REFERENCES "MindMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MindMapNode"
  DROP CONSTRAINT IF EXISTS "MindMapNode_taskId_fkey",
  ADD CONSTRAINT  "MindMapNode_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── MindMapEdge ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MindMapEdge" (
  "id"        TEXT NOT NULL,
  "mindMapId" TEXT NOT NULL,
  "sourceId"  TEXT NOT NULL,
  "targetId"  TEXT NOT NULL,
  "label"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MindMapEdge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MindMapEdge_sourceId_targetId_key"
  ON "MindMapEdge" ("sourceId", "targetId");
CREATE INDEX IF NOT EXISTS "MindMapEdge_mindMapId_idx" ON "MindMapEdge" ("mindMapId");

ALTER TABLE "MindMapEdge"
  DROP CONSTRAINT IF EXISTS "MindMapEdge_mindMapId_fkey",
  ADD CONSTRAINT  "MindMapEdge_mindMapId_fkey"
    FOREIGN KEY ("mindMapId") REFERENCES "MindMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MindMapEdge"
  DROP CONSTRAINT IF EXISTS "MindMapEdge_sourceId_fkey",
  ADD CONSTRAINT  "MindMapEdge_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "MindMapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MindMapEdge"
  DROP CONSTRAINT IF EXISTS "MindMapEdge_targetId_fkey",
  ADD CONSTRAINT  "MindMapEdge_targetId_fkey"
    FOREIGN KEY ("targetId") REFERENCES "MindMapNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
