-- 2026-05-01 · @DBA · Ola P2 / Equipo P2-2 — Sprints + Story Points + Velocity.
-- Extiende la tabla `Sprint` con los campos requeridos para tracking de velocity
-- (capacity, startedAt, endedAt, velocityActual) y añade `storyPoints` a `Task`.
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260501_sprints_velocity/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
-- Idempotente: usa IF NOT EXISTS donde aplica.
-- IMPORTANTE: convención del proyecto = NO ejecutar `prisma db push` productivo
-- automatizado. Edwin aplica este SQL manualmente cuando promueve a entornos.

-- ─── Sprint: capacity / lifecycle / velocityActual ────────────────
ALTER TABLE "Sprint"
  ADD COLUMN IF NOT EXISTS "capacity"       INTEGER,
  ADD COLUMN IF NOT EXISTS "startedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "endedAt"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "velocityActual" INTEGER;

-- ─── Task: storyPoints (Fibonacci) ────────────────────────────────
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "storyPoints" INTEGER;
