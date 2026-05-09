-- Wave P14 (Project Definition) — metodología del proyecto.
-- Aditivo, idempotente.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProjectMethodology') THEN
    CREATE TYPE "ProjectMethodology" AS ENUM ('SCRUM', 'PMI', 'HYBRID');
  END IF;
END $$;

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "methodology" "ProjectMethodology" NOT NULL DEFAULT 'HYBRID';

COMMENT ON COLUMN "Project"."methodology" IS
  'Wave P14 — Metodología de gestión: SCRUM (ágil puro) · PMI (PMBOK plan-driven) · HYBRID (ambos). Default HYBRID para proyectos legacy.';
