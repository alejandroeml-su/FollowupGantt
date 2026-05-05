-- 2026-05-05 · Equipo P8-1 · Wave P8 — Resource Management Visual.
--
-- Crea la matriz de skills + override de capacidad por sprint:
--   1. `Skill` — catálogo global de habilidades (frontend, qa, design, ...).
--   2. `UserSkill` — tabla pivote M:N con nivel 1-5 (1=novato, 5=experto).
--   3. `Sprint.capacityPerUser` JSON — overrides puntuales por user/sprint
--      (vacaciones, on-call, dailyHours sobre default del calendar).
--
-- Aplicación (idempotente · usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260505_resource_skills/migration.sql
--   2. Supabase: pegar este archivo en SQL Editor (o vía MCP `apply_migration`).
--   3. Alternativa dev: npx prisma db push  (NO en producción).
--
-- Patrón de referencia: prisma/migrations/20260504_user_image_checklist/migration.sql.

-- ─── Sprint.capacityPerUser ─────────────────────────────────────────
ALTER TABLE "Sprint"
  ADD COLUMN IF NOT EXISTS "capacityPerUser" JSONB;

-- ─── Skill ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Skill" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "category"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Skill_name_key" ON "Skill"("name");

-- ─── UserSkill ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UserSkill" (
  "userId"    TEXT NOT NULL,
  "skillId"   TEXT NOT NULL,
  "level"     INTEGER NOT NULL DEFAULT 3,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserSkill_pkey" PRIMARY KEY ("userId", "skillId")
);

CREATE INDEX IF NOT EXISTS "UserSkill_skillId_idx" ON "UserSkill"("skillId");

ALTER TABLE "UserSkill"
  DROP CONSTRAINT IF EXISTS "UserSkill_userId_fkey",
  ADD CONSTRAINT  "UserSkill_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSkill"
  DROP CONSTRAINT IF EXISTS "UserSkill_skillId_fkey",
  ADD CONSTRAINT  "UserSkill_skillId_fkey"
    FOREIGN KEY ("skillId") REFERENCES "Skill"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
