-- EPIC-001 · @DBA · Campo position (fractional indexing) + archivedAt + tags
-- Ejecutar en ventana de baja carga. Backfill determinista por createdAt.

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "position"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tags"       TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: posición ascendente por createdAt dentro de (projectId, columnId)
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "projectId", COALESCE("columnId", '')
           ORDER BY "createdAt"
         )::double precision AS pos
  FROM "Task"
)
UPDATE "Task" t
   SET "position" = ordered.pos
  FROM ordered
 WHERE t.id = ordered.id;

CREATE INDEX IF NOT EXISTS "Task_projectId_columnId_position_idx"
  ON "Task"("projectId","columnId","position");

CREATE INDEX IF NOT EXISTS "Task_projectId_parentId_position_idx"
  ON "Task"("projectId","parentId","position");

CREATE INDEX IF NOT EXISTS "Task_archivedAt_idx"
  ON "Task"("archivedAt");
