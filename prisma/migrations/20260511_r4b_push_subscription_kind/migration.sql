-- 2026-05-11 · Wave R4-B · Backend Push Dual (web + native).
-- Extiende `PushSubscription` (Wave P6) para soportar tokens nativos
-- APNs (iOS) y FCM (Android) además del Web Push estándar (VAPID).
--
-- Cambios:
--   1. Nuevo enum `PushSubscriptionKind` con valores WEB_PUSH/APNS/FCM.
--   2. Nueva columna `kind` NOT NULL DEFAULT 'WEB_PUSH' — backfill cubre
--      todas las rows existentes (Wave P6 son browser).
--   3. `keys` pasa de NOT NULL a NULLable: APNs/FCM no requieren claves
--      p256dh/auth (el cifrado lo gestiona TLS contra el proveedor).
--   4. Índice por `kind` para queries del dispatcher (rutea por transporte).
--
-- Aplicación (idempotente):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260511_r4b_push_subscription_kind/migration.sql
--   2. Supabase prod: aplicar via MCP `apply_migration` o SQL Editor.
--
-- Backward-compat 100%: rows existentes preservan `keys`, `endpoint` y se
-- les asigna `kind = 'WEB_PUSH'` automáticamente por DEFAULT.
-- Patrón de referencia: prisma/migrations/20260504_push_subscriptions/migration.sql.

-- ─── 1. Enum PushSubscriptionKind ─────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PushSubscriptionKind" AS ENUM ('WEB_PUSH', 'APNS', 'FCM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── 2. Columna `kind` con default + backfill implícito ───────────
ALTER TABLE "PushSubscription"
  ADD COLUMN IF NOT EXISTS "kind" "PushSubscriptionKind" NOT NULL DEFAULT 'WEB_PUSH';

-- ─── 3. Relajar `keys` a NULLable (APNs/FCM no las usan) ──────────
ALTER TABLE "PushSubscription"
  ALTER COLUMN "keys" DROP NOT NULL;

-- ─── 4. Índice por `kind` para el dispatcher ──────────────────────
CREATE INDEX IF NOT EXISTS "PushSubscription_kind_idx"
  ON "PushSubscription" ("kind");
