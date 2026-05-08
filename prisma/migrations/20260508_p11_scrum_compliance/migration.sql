-- Wave P11-Scrum (HU-11.1 + HU-11.2) — Schema additions
--
-- Project.productGoal · commitment Scrum 2020 a nivel producto
-- Sprint.{reviewedAt, reviewNotes, demoUrl} · Sprint Review event
--
-- Aplicar:
--   psql $DATABASE_URL -f prisma/migrations/20260508_p11_scrum_compliance/migration.sql
-- O via prisma:
--   npx prisma migrate deploy
-- O via Supabase MCP `apply_migration` con el contenido de este archivo.

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "productGoal" JSONB;

COMMENT ON COLUMN "Project"."productGoal" IS
  'Wave P11-Scrum (HU-11.1) — Product Goal commitment del Scrum Guide 2020. Shape: { statement, successMetrics[], targetDate, lastReviewedAt }';

ALTER TABLE "Sprint" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "Sprint" ADD COLUMN IF NOT EXISTS "reviewNotes" TEXT;
ALTER TABLE "Sprint" ADD COLUMN IF NOT EXISTS "demoUrl" TEXT;

COMMENT ON COLUMN "Sprint"."reviewedAt" IS
  'Wave P11-Scrum (HU-11.2) — timestamp de cierre del Sprint Review event';
COMMENT ON COLUMN "Sprint"."reviewNotes" IS
  'Wave P11-Scrum (HU-11.2) — feedback de stakeholders en el Sprint Review';
COMMENT ON COLUMN "Sprint"."demoUrl" IS
  'Wave P11-Scrum (HU-11.2) — link de demo del increment (Loom, video, etc)';
