-- 2026-05-04 · Equipo A4 · Wave P6 — Web Push API (suscripciones VAPID).
-- Añade tabla `PushSubscription` para persistir suscripciones del navegador
-- (PushManager.subscribe → endpoint + keys p256dh/auth) por usuario.
--
-- Aplicación (idempotente):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260504_push_subscriptions/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push  (solo dev local — no productivo).
--
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
-- Patrón de referencia: prisma/migrations/20260501_notifications_center/migration.sql.

-- ─── PushSubscription ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "endpoint"   TEXT NOT NULL,
  "keys"       JSONB NOT NULL,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key"
  ON "PushSubscription" ("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx"
  ON "PushSubscription" ("userId");

ALTER TABLE "PushSubscription"
  DROP CONSTRAINT IF EXISTS "PushSubscription_userId_fkey",
  ADD CONSTRAINT  "PushSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
