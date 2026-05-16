-- R4 · US-7.4 · Email ClickApp (Email-to-Task)
--
-- NO APLICAR automáticamente — requiere autorización explícita de Edwin
-- vía `si procede`. Aplicar luego con la herramienta MCP de Supabase
-- (`mcp__claude_ai_Supabase__apply_migration`) sobre el proyecto
-- `bpiugqsjnlwqfhbnkirh`.
--
-- Cambios:
--   1. Project.inboundEmailAlias TEXT? UNIQUE
--   2. InboundEmailStatus enum (PENDING/PROCESSED/FAILED)
--   3. InboundEmail tabla — registro de correos recibidos por el webhook
--      `/api/inbound/email` (SendGrid Inbound Parse).

BEGIN;

-- 1. Alias por proyecto (nullable; backfill manual cuando se requiera).
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "inboundEmailAlias" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Project_inboundEmailAlias_key"
  ON "Project"("inboundEmailAlias");

-- 2. Enum de estados del procesamiento.
DO $$ BEGIN
  CREATE TYPE "InboundEmailStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Tabla InboundEmail.
CREATE TABLE IF NOT EXISTS "InboundEmail" (
  "id"          TEXT PRIMARY KEY,
  "projectId"   TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "fromEmail"   TEXT NOT NULL,
  "fromName"    TEXT,
  "subject"     TEXT NOT NULL,
  "bodyText"    TEXT NOT NULL,
  "bodyHtml"    TEXT,
  "taskId"      TEXT,
  "commentId"   TEXT,
  "status"      "InboundEmailStatus" NOT NULL DEFAULT 'PENDING',
  "errorMsg"    TEXT,
  "processedAt" TIMESTAMP(3),
  "receivedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "headers"     JSONB,
  "spamScore"   DOUBLE PRECISION,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "InboundEmail_projectId_receivedAt_idx"
  ON "InboundEmail"("projectId", "receivedAt");

CREATE INDEX IF NOT EXISTS "InboundEmail_status_idx"
  ON "InboundEmail"("status");

-- 4. RLS opcional — InboundEmail no expone PII más allá del Project ya
-- protegido por RLS (Wave R4-A). Si se quiere endurecer:
--   ALTER TABLE "InboundEmail" ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "inbound_email_project_member" ON "InboundEmail"
--     USING (EXISTS (
--       SELECT 1 FROM "ProjectAssignment" pa
--       WHERE pa."projectId" = "InboundEmail"."projectId"
--         AND pa."userId" = (current_setting('request.jwt.claims', true)::json->>'sub')
--     ));
-- Por ahora dejamos sin RLS — el endpoint webhook escribe con service-role
-- y la lectura sólo ocurre desde server actions que ya gatean por proyecto.

COMMIT;
