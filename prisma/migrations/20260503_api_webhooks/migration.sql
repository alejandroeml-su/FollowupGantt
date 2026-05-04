-- 2026-05-03 · @DBA · Ola P4 / Equipo P4-2 — API REST pública + Webhooks.
-- Crea las tablas `ApiToken` y `Webhook` que soportan la integración HTTP
-- pública de FollowupGantt:
--   - ApiToken: tokens portables hash-SHA256 con scopes JSON y expiración
--     opcional. Auth Bearer en `Authorization: Bearer <token>`.
--   - Webhook: suscripciones outbound con HMAC SHA-256 (`X-FollowupGantt-Signature`).
--
-- Aplicación:
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260503_api_webhooks/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios del schema).
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS donde aplica.
-- Convención del proyecto: NO ejecutar `prisma db push` productivo
-- automatizado. Edwin aplica este SQL manualmente al promover entornos.

-- ─── ApiToken ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ApiToken" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "tokenHash"   TEXT NOT NULL,
  "prefix"      TEXT NOT NULL,
  "scopes"      JSONB NOT NULL,
  "userId"      TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3),
  "lastUsedAt"  TIMESTAMP(3),
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiToken_tokenHash_key"
  ON "ApiToken" ("tokenHash");
CREATE INDEX IF NOT EXISTS "ApiToken_userId_idx"
  ON "ApiToken" ("userId");
CREATE INDEX IF NOT EXISTS "ApiToken_revokedAt_idx"
  ON "ApiToken" ("revokedAt");

ALTER TABLE "ApiToken"
  DROP CONSTRAINT IF EXISTS "ApiToken_userId_fkey",
  ADD CONSTRAINT "ApiToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Webhook ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Webhook" (
  "id"                 TEXT NOT NULL,
  "url"                TEXT NOT NULL,
  "secret"             TEXT NOT NULL,
  "events"             JSONB NOT NULL,
  "active"             BOOLEAN NOT NULL DEFAULT true,
  "userId"             TEXT NOT NULL,
  "lastDeliveryAt"     TIMESTAMP(3),
  "lastDeliveryStatus" INTEGER,
  "failureCount"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Webhook_userId_idx"
  ON "Webhook" ("userId");
CREATE INDEX IF NOT EXISTS "Webhook_active_idx"
  ON "Webhook" ("active");

ALTER TABLE "Webhook"
  DROP CONSTRAINT IF EXISTS "Webhook_userId_fkey",
  ADD CONSTRAINT "Webhook_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
