-- 2026-05-05 · Equipo P8-2 · Wave P8 — Risk Register + Monte Carlo simulation.
--
-- Modela el risk register PMBOK §11 con:
--   - probability × impact (matriz 5×5) → score app-level.
--   - Mitigation plan + owner asignable.
--   - triggerDelayDays para alimentar simulación Monte Carlo de duración
--     del proyecto reusando el CPM existente (`@/lib/scheduling/cpm`).
--
-- Aplicación (idempotente · usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260505_risk_register/migration.sql
--   2. Supabase: pegar este archivo en SQL Editor (o vía MCP `apply_migration`).
--   3. Alternativa dev: npx prisma db push  (NO en producción).
--
-- Patrón de referencia: prisma/migrations/20260504_user_image_checklist/migration.sql.

-- ─── Enum RiskStatus ────────────────────────────────────────────────
-- Postgres no soporta CREATE TYPE IF NOT EXISTS, así que envolvemos en
-- DO block que verifica `pg_type`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RiskStatus') THEN
    CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MITIGATING', 'ACCEPTED', 'CLOSED');
  END IF;
END $$;

-- ─── Risk ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Risk" (
  "id"               TEXT NOT NULL,
  "projectId"        TEXT NOT NULL,
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "probability"      INTEGER NOT NULL,
  "impact"           INTEGER NOT NULL,
  "status"           "RiskStatus" NOT NULL DEFAULT 'OPEN',
  "ownerId"          TEXT,
  "mitigation"       TEXT,
  "triggerDelayDays" INTEGER,
  "detectedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"         TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Risk_projectId_status_idx"
  ON "Risk"("projectId", "status");
CREATE INDEX IF NOT EXISTS "Risk_probability_impact_idx"
  ON "Risk"("probability", "impact");

ALTER TABLE "Risk"
  DROP CONSTRAINT IF EXISTS "Risk_projectId_fkey",
  ADD CONSTRAINT  "Risk_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Risk"
  DROP CONSTRAINT IF EXISTS "Risk_ownerId_fkey",
  ADD CONSTRAINT  "Risk_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
