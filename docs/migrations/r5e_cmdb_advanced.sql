-- ─────────────────────────────────────────────────────────────────────
-- Wave R5-Extended · CMDB avanzado (13 SP)
--
-- Aplicar vía Supabase MCP (`mcp__claude_ai_Supabase__apply_migration`)
-- bajo autorización explícita de Edwin. El SQL es IDEMPOTENTE: puede
-- correrse varias veces sin error. Cubre:
--   1. Enum `CIChangeStatus`.
--   2. Tabla `CILifecycleEvent` (audit trail de transiciones de CIStatus).
--   3. Tabla `CIChangeRequest` (Change Request ligero por CI).
--
-- Nota: la creación de tablas usa `IF NOT EXISTS` y los `ALTER TABLE`
-- comprobaciones explícitas; los `CREATE INDEX` también usan `IF NOT
-- EXISTS`. Si la migración se aplicó parcialmente y luego se reaplica,
-- los pasos ya completados se omiten.
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. Enum CIChangeStatus ──────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CIChangeStatus') THEN
    CREATE TYPE "CIChangeStatus" AS ENUM (
      'PROPOSED',
      'APPROVED',
      'REJECTED',
      'EXECUTED',
      'CANCELLED'
    );
  END IF;
END$$;

-- ── 2. Tabla CILifecycleEvent ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CILifecycleEvent" (
  "id"         TEXT PRIMARY KEY,
  "ciId"       TEXT NOT NULL,
  "fromStatus" "CIStatus",
  "toStatus"   "CIStatus" NOT NULL,
  "note"       TEXT,
  "actorId"    TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK ciId → ConfigurationItem.id (Cascade)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CILifecycleEvent_ciId_fkey'
  ) THEN
    ALTER TABLE "CILifecycleEvent"
      ADD CONSTRAINT "CILifecycleEvent_ciId_fkey"
      FOREIGN KEY ("ciId") REFERENCES "ConfigurationItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- FK actorId → User.id (SetNull)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CILifecycleEvent_actorId_fkey'
  ) THEN
    ALTER TABLE "CILifecycleEvent"
      ADD CONSTRAINT "CILifecycleEvent_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "CILifecycleEvent_ciId_createdAt_idx"
  ON "CILifecycleEvent" ("ciId", "createdAt");

-- ── 3. Tabla CIChangeRequest ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CIChangeRequest" (
  "id"            TEXT PRIMARY KEY,
  "ciId"          TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "rationale"     TEXT,
  "plannedAt"     TIMESTAMP(3),
  "executedAt"    TIMESTAMP(3),
  "status"        "CIChangeStatus" NOT NULL DEFAULT 'PROPOSED',
  "requestedById" TEXT NOT NULL,
  "approvedById"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- FK ciId → ConfigurationItem.id (Cascade)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CIChangeRequest_ciId_fkey'
  ) THEN
    ALTER TABLE "CIChangeRequest"
      ADD CONSTRAINT "CIChangeRequest_ciId_fkey"
      FOREIGN KEY ("ciId") REFERENCES "ConfigurationItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END$$;

-- FK requestedById → User.id (Restrict/default — preserva integridad
-- referencial; si se requiere borrar al usuario hay que reasignar antes).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CIChangeRequest_requestedById_fkey'
  ) THEN
    ALTER TABLE "CIChangeRequest"
      ADD CONSTRAINT "CIChangeRequest_requestedById_fkey"
      FOREIGN KEY ("requestedById") REFERENCES "User"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END$$;

-- FK approvedById → User.id (SetNull)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'CIChangeRequest_approvedById_fkey'
  ) THEN
    ALTER TABLE "CIChangeRequest"
      ADD CONSTRAINT "CIChangeRequest_approvedById_fkey"
      FOREIGN KEY ("approvedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "CIChangeRequest_ciId_status_idx"
  ON "CIChangeRequest" ("ciId", "status");

-- ─────────────────────────────────────────────────────────────────────
-- Verificación (opcional, no rompe la migración):
--   SELECT COUNT(*) FROM "CILifecycleEvent";   -- → 0
--   SELECT COUNT(*) FROM "CIChangeRequest";    -- → 0
-- ─────────────────────────────────────────────────────────────────────
