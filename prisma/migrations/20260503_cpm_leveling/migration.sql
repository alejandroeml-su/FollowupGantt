-- 2026-05-03 · @DBA · Ola P5 / Equipo P5-2 — Hard Deadlines + Resource Leveling.
-- Añade dos campos opcionales sobre `Task` que alimentan los algoritmos
-- de detección de violaciones (`hardDeadline`) y planificación de carga
-- por recurso (`dailyEffortHours`).
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260503_cpm_leveling/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios pendientes).
-- Idempotente: usa IF NOT EXISTS donde aplica.
-- IMPORTANTE: convención del proyecto = NO ejecutar `prisma db push` productivo
-- automatizado. Edwin aplica este SQL manualmente cuando promueve a entornos.

-- ─── Task.hardDeadline ────────────────────────────────────────────
-- Fecha límite forzosa de finalización. Si CPM calcula que la tarea
-- terminará después de esta fecha ⇒ violación visible en /leveling.
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "hardDeadline" TIMESTAMP(3);

-- Índice para acelerar el filtro de tareas con hardDeadline en el
-- chequeo periódico (excluye los NULL automáticamente: postgres ignora
-- los NULL en btree por defecto, lo cual es exactamente lo que queremos).
CREATE INDEX IF NOT EXISTS "Task_hardDeadline_idx"
  ON "Task" ("hardDeadline")
  WHERE "hardDeadline" IS NOT NULL;

-- ─── Task.dailyEffortHours ────────────────────────────────────────
-- Esfuerzo diario estimado por defecto (horas). Se usa para calcular
-- la carga del recurso (assignee) durante el resource leveling. Si NULL,
-- el algoritmo cae al workdayHours del calendario o 8h.
ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "dailyEffortHours" DOUBLE PRECISION;
