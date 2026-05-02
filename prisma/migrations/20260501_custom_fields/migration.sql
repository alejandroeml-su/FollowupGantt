-- 2026-05-01 · @DBA · Ola P1 / Equipo 3 — Custom Fields configurables por proyecto.
-- Crea el enum `CustomFieldType` y las tablas `CustomFieldDef` /
-- `CustomFieldValue` que soportan campos personalizados sobre `Task`.
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260501_custom_fields/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios pendientes del schema).
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS donde aplica.
-- IMPORTANTE: convención del proyecto = NO ejecutar `prisma db push` productivo
-- automatizado. Edwin aplica este SQL manualmente cuando promueve a entornos.

-- ─── enum CustomFieldType ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomFieldType') THEN
    CREATE TYPE "CustomFieldType" AS ENUM (
      'TEXT',
      'NUMBER',
      'DATE',
      'BOOLEAN',
      'SELECT',
      'MULTI_SELECT',
      'URL'
    );
  END IF;
END$$;

-- ─── CustomFieldDef ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CustomFieldDef" (
  "id"           TEXT NOT NULL,
  "projectId"    TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "label"        TEXT NOT NULL,
  "type"         "CustomFieldType" NOT NULL,
  "required"     BOOLEAN NOT NULL DEFAULT false,
  "defaultValue" JSONB,
  "options"      JSONB,
  "position"     DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldDef_projectId_key_key"
  ON "CustomFieldDef" ("projectId", "key");
CREATE INDEX IF NOT EXISTS "CustomFieldDef_projectId_position_idx"
  ON "CustomFieldDef" ("projectId", "position");

ALTER TABLE "CustomFieldDef"
  DROP CONSTRAINT IF EXISTS "CustomFieldDef_projectId_fkey",
  ADD  CONSTRAINT "CustomFieldDef_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── CustomFieldValue ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CustomFieldValue" (
  "id"      TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "taskId"  TEXT NOT NULL,
  "value"   JSONB NOT NULL,
  CONSTRAINT "CustomFieldValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomFieldValue_fieldId_taskId_key"
  ON "CustomFieldValue" ("fieldId", "taskId");
CREATE INDEX IF NOT EXISTS "CustomFieldValue_taskId_idx"
  ON "CustomFieldValue" ("taskId");

ALTER TABLE "CustomFieldValue"
  DROP CONSTRAINT IF EXISTS "CustomFieldValue_fieldId_fkey",
  ADD  CONSTRAINT "CustomFieldValue_fieldId_fkey"
    FOREIGN KEY ("fieldId") REFERENCES "CustomFieldDef"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomFieldValue"
  DROP CONSTRAINT IF EXISTS "CustomFieldValue_taskId_fkey",
  ADD  CONSTRAINT "CustomFieldValue_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
