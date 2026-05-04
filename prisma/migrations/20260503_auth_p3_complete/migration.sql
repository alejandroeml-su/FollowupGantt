-- 2026-05-03 · @Dev + @SRE · Ola P3 — Completar Auth con SSO + 2FA + reset.
--
-- Cambios:
--   1. User.twoFactorSecret  (TEXT, nullable) — TOTP RFC 6238 secret base32.
--   2. Session.userAgent / ipAddress / lastSeenAt / createdAt — metadata para
--      la UI de "Sesiones activas".
--   3. PasswordResetToken — tabla nueva, token hasheado SHA-256, TTL 1h.
--
-- Aplicación (idempotente):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260503_auth_p3_complete/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa dev: npx prisma db push (NO en prod).
--
-- Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
-- Patrón de referencia: prisma/migrations/20260501_notifications_center/migration.sql.

-- ─── User: 2FA TOTP secret ────────────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;

-- ─── Session: metadata de dispositivo ────────────────────────────
ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "userAgent"  TEXT,
  ADD COLUMN IF NOT EXISTS "ipAddress"  TEXT,
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─── PasswordResetToken ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key"
  ON "PasswordResetToken" ("tokenHash");

CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx"
  ON "PasswordResetToken" ("userId");

CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx"
  ON "PasswordResetToken" ("expiresAt");

ALTER TABLE "PasswordResetToken"
  DROP CONSTRAINT IF EXISTS "PasswordResetToken_userId_fkey",
  ADD CONSTRAINT  "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
