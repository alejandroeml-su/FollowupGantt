-- Wave P17-B (API pública v2 + Webhooks v2) · Equipo B
--
-- Migración 100% aditiva. NO toca ApiToken/Webhook v1 — coexisten.
-- RLS aditiva por workspace (`USING (workspaceId = current_setting('app.workspace_id', true)::text)`)
-- para alineamiento con el patrón aprobado en Wave P4 (Workspaces).
--
-- Decisiones:
--   - `scopes` y `events` son `TEXT[]` (no JSONB) — permiten queries
--     `WHERE scopes @> ARRAY['read:projects']` con índice GIN futuro.
--   - `payload` en WebhookDelivery es JSONB para preservar shape sin
--     pérdida de tipo en re-emisiones.
--   - `prefix` indexado para lookup O(1) durante autenticación
--     (`WHERE prefix = 'abcd1234' AND revokedAt IS NULL`).
--   - `failureCount` int normal (no nullable) inicializa a 0.

-- ─────────────────────────────────────────────────────────────
-- ApiKey: credenciales workspace-scoped con scopes granulares.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"        TEXT NOT NULL,
  "prefix"      TEXT NOT NULL,
  "hashedKey"   TEXT NOT NULL,
  "scopes"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "workspaceId" TEXT NOT NULL,
  "createdById" TEXT,
  "lastUsedAt"  TIMESTAMP(3),
  "expiresAt"   TIMESTAMP(3),
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApiKey_hashedKey_key" UNIQUE ("hashedKey"),
  CONSTRAINT "ApiKey_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
  CONSTRAINT "ApiKey_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "ApiKey_workspaceId_idx" ON "ApiKey"("workspaceId");
CREATE INDEX IF NOT EXISTS "ApiKey_prefix_idx"      ON "ApiKey"("prefix");
CREATE INDEX IF NOT EXISTS "ApiKey_revokedAt_idx"   ON "ApiKey"("revokedAt");

-- ─────────────────────────────────────────────────────────────
-- WebhookSubscription: configuración por workspace, durable.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WebhookSubscription" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId"    TEXT NOT NULL,
  "url"            TEXT NOT NULL,
  "secret"         TEXT NOT NULL,
  "events"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "active"         BOOLEAN NOT NULL DEFAULT TRUE,
  "lastDeliveryAt" TIMESTAMP(3),
  "failureCount"   INT NOT NULL DEFAULT 0,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WebhookSubscription_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
  CONSTRAINT "WebhookSubscription_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "WebhookSubscription_workspaceId_idx"
  ON "WebhookSubscription"("workspaceId");
CREATE INDEX IF NOT EXISTS "WebhookSubscription_active_idx"
  ON "WebhookSubscription"("active");

-- ─────────────────────────────────────────────────────────────
-- WebhookDelivery: histórico inmutable de cada intento de entrega.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
  "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "subscriptionId" TEXT NOT NULL,
  "event"          TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  "responseStatus" INT,
  "responseBody"   TEXT,
  "attemptedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retryCount"     INT NOT NULL DEFAULT 0,

  CONSTRAINT "WebhookDelivery_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "WebhookSubscription"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "WebhookDelivery_subscriptionId_attemptedAt_idx"
  ON "WebhookDelivery"("subscriptionId", "attemptedAt");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_event_idx"
  ON "WebhookDelivery"("event");

-- ─────────────────────────────────────────────────────────────
-- RLS aditiva por workspace.
--
-- El patrón establecido en Wave P4 usa `current_setting('app.workspace_id', true)`
-- para filtrar recursos del workspace activo. Con `true` la función NO
-- lanza si el setting no existe (devuelve NULL → la fila NO matchea, lo
-- cual es el comportamiento seguro por defecto).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ApiKey_workspace_isolation" ON "ApiKey";
CREATE POLICY "ApiKey_workspace_isolation" ON "ApiKey"
  FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

ALTER TABLE "WebhookSubscription" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "WebhookSubscription_workspace_isolation" ON "WebhookSubscription";
CREATE POLICY "WebhookSubscription_workspace_isolation" ON "WebhookSubscription"
  FOR ALL
  USING ("workspaceId" = current_setting('app.workspace_id', true))
  WITH CHECK ("workspaceId" = current_setting('app.workspace_id', true));

-- WebhookDelivery hereda aislamiento via subscription FK; añadimos política
-- vía subquery para que el RLS sea consistente al leer histórico.
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "WebhookDelivery_workspace_isolation" ON "WebhookDelivery";
CREATE POLICY "WebhookDelivery_workspace_isolation" ON "WebhookDelivery"
  FOR ALL
  USING (
    "subscriptionId" IN (
      SELECT "id" FROM "WebhookSubscription"
      WHERE "workspaceId" = current_setting('app.workspace_id', true)
    )
  )
  WITH CHECK (
    "subscriptionId" IN (
      SELECT "id" FROM "WebhookSubscription"
      WHERE "workspaceId" = current_setting('app.workspace_id', true)
    )
  );

-- Comentarios documentales.
COMMENT ON TABLE "ApiKey" IS
  'Wave P17-B · Credenciales workspace-scoped para API pública v2. Plain key se muestra UNA SOLA VEZ; persistimos sólo SHA-256 hash.';
COMMENT ON TABLE "WebhookSubscription" IS
  'Wave P17-B · Configuración de webhooks outbound v2. Auto-disable tras 10 fallos consecutivos.';
COMMENT ON TABLE "WebhookDelivery" IS
  'Wave P17-B · Histórico de cada intento de delivery (incluye reintentos). Útil para forensics/replay.';
