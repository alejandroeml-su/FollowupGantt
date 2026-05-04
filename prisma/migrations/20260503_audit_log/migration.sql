-- 2026-05-03 · @Dev · Ola P3 — Audit Log centralizado (compliance ITIL/SOC2).
-- Añade tabla `AuditEvent` con snapshots before/after, actor, entityType,
-- entityId, ipAddress, userAgent y metadata. Sin enum: el catálogo de
-- `action` se valida en capa app (zod) para permitir extensión sin migrar.
--
-- Aplicación (idempotente):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260503_audit_log/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push  (solo dev local — no productivo).
--
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
-- Patrón de referencia: prisma/migrations/20260501_notifications_center/migration.sql.

-- ─── AuditEvent ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AuditEvent" (
  "id"         TEXT NOT NULL,
  "actorId"    TEXT,
  "action"     TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT,
  "before"     JSONB,
  "after"      JSONB,
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "metadata"   JSONB,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- Índices para los patrones de consulta documentados en el modelo:
--   * "eventos de un actor" (filtro UI por persona).
--   * "eventos sobre una entidad" (drill-down forensic / timeline).
--   * "eventos por acción" (filtro por verb del catálogo).
--   * Listado paginado global por createdAt desc.
CREATE INDEX IF NOT EXISTS "AuditEvent_actorId_createdAt_idx"
  ON "AuditEvent" ("actorId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AuditEvent_entityType_entityId_createdAt_idx"
  ON "AuditEvent" ("entityType", "entityId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AuditEvent_action_createdAt_idx"
  ON "AuditEvent" ("action", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_idx"
  ON "AuditEvent" ("createdAt" DESC);

-- FK con onDelete SET NULL: si se elimina el actor, el evento sobrevive.
-- Compliance ITIL/SOC2 exige preservar la traza aún cuando el actor
-- desaparezca de la tabla User.
ALTER TABLE "AuditEvent"
  DROP CONSTRAINT IF EXISTS "AuditEvent_actorId_fkey",
  ADD CONSTRAINT  "AuditEvent_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
