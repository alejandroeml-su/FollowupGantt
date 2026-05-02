-- 2026-05-01 · @DBA · Ola P2 / Equipo P2-1 — Vistas guardadas + agrupación
-- dinámica multi-surface. Crea el enum `ViewSurface` y la tabla `SavedView`.
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260501_saved_views/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios pendientes).
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS donde aplica.
-- IMPORTANTE: convención del proyecto = NO ejecutar `prisma db push` productivo
-- automatizado. Edwin aplica este SQL manualmente al promover entornos.

-- ─── enum ViewSurface ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ViewSurface') THEN
    CREATE TYPE "ViewSurface" AS ENUM (
      'LIST',
      'KANBAN',
      'GANTT',
      'CALENDAR',
      'TABLE'
    );
  END IF;
END$$;

-- ─── SavedView ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SavedView" (
  "id"          TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "surface"     "ViewSurface" NOT NULL,
  "filters"     JSONB NOT NULL,
  "grouping"    TEXT,
  "sorting"     JSONB,
  "columnPrefs" JSONB,
  "isShared"    BOOLEAN NOT NULL DEFAULT false,
  "isDefault"   BOOLEAN NOT NULL DEFAULT false,
  "position"    DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SavedView_userId_surface_idx"
  ON "SavedView" ("userId", "surface");
CREATE INDEX IF NOT EXISTS "SavedView_surface_isShared_idx"
  ON "SavedView" ("surface", "isShared");

ALTER TABLE "SavedView"
  DROP CONSTRAINT IF EXISTS "SavedView_userId_fkey",
  ADD  CONSTRAINT "SavedView_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
