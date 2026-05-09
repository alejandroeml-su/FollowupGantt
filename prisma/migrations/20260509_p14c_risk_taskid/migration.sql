-- Wave P14c (Brain AI · Risk per task) — Risk.taskId opcional FK a Task.
-- Aditivo, idempotente.

ALTER TABLE "Risk" ADD COLUMN IF NOT EXISTS "taskId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Risk_taskId_fkey' AND table_name = 'Risk'
  ) THEN
    ALTER TABLE "Risk"
      ADD CONSTRAINT "Risk_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "Task"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Risk_taskId_idx" ON "Risk"("taskId");

COMMENT ON COLUMN "Risk"."taskId" IS
  'Wave P14c — Tarea específica del proyecto que origina/contiene el riesgo. Permite drill-down y dedupe de alertas LLM.';
