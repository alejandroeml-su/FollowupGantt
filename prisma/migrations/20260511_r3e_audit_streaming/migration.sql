-- R3.0 Fase 2 · Equipo R3-E · Audit Streaming a SIEM externos.
-- Aditiva. Sin destrucciones. Idempotente vía IF NOT EXISTS / DO blocks.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditStreamKind') THEN
    CREATE TYPE "AuditStreamKind" AS ENUM (
      'SPLUNK', 'DATADOG', 'GENERIC_WEBHOOK'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditStreamDeliveryStatus') THEN
    CREATE TYPE "AuditStreamDeliveryStatus" AS ENUM (
      'PENDING', 'SUCCESS', 'FAILED', 'RETRYING'
    );
  END IF;
END$$;

-- ─── AuditStreamTarget ───
CREATE TABLE IF NOT EXISTS "AuditStreamTarget" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId"    TEXT NOT NULL,
  "kind"           "AuditStreamKind" NOT NULL,
  "endpoint"       TEXT NOT NULL,
  "secret"         TEXT NOT NULL,
  "batchSize"      INTEGER NOT NULL DEFAULT 100,
  "enabled"        BOOLEAN NOT NULL DEFAULT TRUE,
  "lastDeliveryAt" TIMESTAMP(3),
  "lastError"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "AuditStreamTarget_workspaceId_enabled_idx"
  ON "AuditStreamTarget"("workspaceId", "enabled");

-- ─── AuditStreamDelivery ───
CREATE TABLE IF NOT EXISTS "AuditStreamDelivery" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "targetId"    TEXT NOT NULL REFERENCES "AuditStreamTarget"("id") ON DELETE CASCADE,
  "batchId"     TEXT NOT NULL,
  "count"       INTEGER NOT NULL,
  "status"      "AuditStreamDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempt"     INTEGER NOT NULL DEFAULT 0,
  "lastError"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "deliveredAt" TIMESTAMP(3)
);

CREATE INDEX IF NOT EXISTS "AuditStreamDelivery_targetId_status_createdAt_idx"
  ON "AuditStreamDelivery"("targetId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AuditStreamDelivery_batchId_idx"
  ON "AuditStreamDelivery"("batchId");

-- ─── RLS open-policy inicial (P18+ endurecerá) ───
ALTER TABLE "AuditStreamTarget" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AuditStreamTarget_all" ON "AuditStreamTarget";
CREATE POLICY "AuditStreamTarget_all" ON "AuditStreamTarget"
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "AuditStreamDelivery" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AuditStreamDelivery_all" ON "AuditStreamDelivery";
CREATE POLICY "AuditStreamDelivery_all" ON "AuditStreamDelivery"
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE "AuditStreamTarget" IS
  'R3-E — Destino SIEM (Splunk/Datadog/Generic webhook) configurado por workspace para reenviar AuditEvent en batches.';
COMMENT ON TABLE "AuditStreamDelivery" IS
  'R3-E — Bitácora de entregas batched al SIEM. Status PENDING→RETRYING→SUCCESS|FAILED con retry exponencial (1s, 5s, 30s).';
