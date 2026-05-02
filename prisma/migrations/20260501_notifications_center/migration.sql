-- 2026-05-01 · @Dev · Ola P1 — Centro de notificaciones in-app + preferencias.
-- Añade `NotificationType` enum, tabla `Notification`, tabla
-- `NotificationPreference` (1:1 con User) e índices para listado y badge
-- de no-leídas.
--
-- Aplicación (idempotente):
--   1. Local: psql $DATABASE_URL -f prisma/migrations/20260501_notifications_center/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push  (solo dev local — no productivo).
--
-- Idempotente: usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS.
-- Patrón de referencia: prisma/migrations/20260425_task_collaborators_and_reference_url/migration.sql.

-- ─── Enum NotificationType ────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM (
    'MENTION',
    'TASK_ASSIGNED',
    'COMMENT_REPLY',
    'BASELINE_CAPTURED',
    'DEPENDENCY_VIOLATION',
    'IMPORT_COMPLETED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Notification ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Notification" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "type"      "NotificationType" NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT,
  "link"      TEXT,
  "data"      JSONB,
  "readAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx"
  ON "Notification" ("userId", "readAt");
-- Índice descendente por createdAt para `findMany({ orderBy: createdAt desc })`.
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
  ON "Notification" ("userId", "createdAt" DESC);

ALTER TABLE "Notification"
  DROP CONSTRAINT IF EXISTS "Notification_userId_fkey",
  ADD CONSTRAINT  "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── NotificationPreference ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NotificationPreference" (
  "id"               TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "emailMentions"    BOOLEAN NOT NULL DEFAULT TRUE,
  "emailAssignments" BOOLEAN NOT NULL DEFAULT TRUE,
  "emailDigest"      BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPreference_userId_key"
  ON "NotificationPreference" ("userId");

ALTER TABLE "NotificationPreference"
  DROP CONSTRAINT IF EXISTS "NotificationPreference_userId_fkey",
  ADD CONSTRAINT  "NotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
