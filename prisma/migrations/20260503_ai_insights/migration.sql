-- 2026-05-03 · Equipo P5-4 · Ola P5 — AI Insights heurísticos.
-- Crea el enum `InsightKind` y la tabla `TaskInsight` que persiste las
-- sugerencias derivadas por las heurísticas locales (sin LLM externo).
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260503_ai_insights/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios pendientes).
--
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS donde aplica.
-- IMPORTANTE: convención del proyecto = NO ejecutar `prisma db push` productivo
-- automatizado. Edwin aplica este SQL manualmente cuando promueve a entornos.

-- ─── enum InsightKind ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InsightKind') THEN
    CREATE TYPE "InsightKind" AS ENUM (
      'CATEGORIZATION',
      'DELAY_RISK',
      'NEXT_ACTION'
    );
  END IF;
END$$;

-- ─── TaskInsight ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TaskInsight" (
  "id"          TEXT NOT NULL,
  "taskId"      TEXT NOT NULL,
  "kind"        "InsightKind" NOT NULL,
  "score"       DOUBLE PRECISION NOT NULL,
  "payload"     JSONB NOT NULL,
  "dismissedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaskInsight_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TaskInsight_taskId_kind_createdAt_idx"
  ON "TaskInsight" ("taskId", "kind", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "TaskInsight_kind_dismissedAt_idx"
  ON "TaskInsight" ("kind", "dismissedAt");

ALTER TABLE "TaskInsight"
  DROP CONSTRAINT IF EXISTS "TaskInsight_taskId_fkey",
  ADD  CONSTRAINT "TaskInsight_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
