-- ─────────────────────────────────────────────────────────────────
-- R4 · US-7.2 Chat View — Migración Postgres (Supabase)
-- ─────────────────────────────────────────────────────────────────
--
-- Aplicar via MCP `apply_migration` (project_id = bpiugqsjnlwqfhbnkirh)
-- con autorización explícita del operador. Diferida de la rama feature.
--
-- Crea:
--   - enum   `ChatChannelKind`        (GENERAL · TOPIC · PRIVATE)
--   - table  `ChatChannel`            (canal de comunicación por proyecto)
--   - table  `ChatMessage`            (mensajes con threading mínimo +
--                                      soft-edit/soft-delete)
--   - table  `ChatMessageReaction`    (reacciones emoji con toggle único)
--
-- Idempotente: usa IF NOT EXISTS donde aplica para soportar re-aplicación
-- sin error en entornos donde alguien ejecutó parte de la migración.
--
-- Realtime: estas 3 tablas deben publicarse en `supabase_realtime` para
-- que `postgres_changes` reciba INSERT/UPDATE desde el hook del cliente
-- (`use-chat-channel.ts`). El bloque final de la migración lo hace.
-- ─────────────────────────────────────────────────────────────────

-- 1. Enum ChatChannelKind ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChatChannelKind') THEN
    CREATE TYPE "ChatChannelKind" AS ENUM ('GENERAL', 'TOPIC', 'PRIVATE');
  END IF;
END$$;

-- 2. Tabla ChatChannel ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ChatChannel" (
  "id"            TEXT PRIMARY KEY,
  "projectId"     TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "name"          TEXT NOT NULL,
  "kind"          "ChatChannelKind" NOT NULL DEFAULT 'TOPIC',
  "description"   TEXT,
  "lastMessageAt" TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatChannel_projectId_name_key"
  ON "ChatChannel"("projectId", "name");

CREATE INDEX IF NOT EXISTS "ChatChannel_projectId_lastMessageAt_idx"
  ON "ChatChannel"("projectId", "lastMessageAt");

-- 3. Tabla ChatMessage ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ChatMessage" (
  "id"              TEXT PRIMARY KEY,
  "channelId"       TEXT NOT NULL REFERENCES "ChatChannel"("id") ON DELETE CASCADE,
  "authorId"        TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "content"         TEXT NOT NULL,
  "parentMessageId" TEXT REFERENCES "ChatMessage"("id") ON DELETE SET NULL,
  "editedAt"        TIMESTAMP(3),
  "deletedAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ChatMessage_channelId_createdAt_idx"
  ON "ChatMessage"("channelId", "createdAt");

CREATE INDEX IF NOT EXISTS "ChatMessage_parentMessageId_idx"
  ON "ChatMessage"("parentMessageId");

-- 4. Tabla ChatMessageReaction ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ChatMessageReaction" (
  "id"        TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL REFERENCES "ChatMessage"("id") ON DELETE CASCADE,
  "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "emoji"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChatMessageReaction_messageId_userId_emoji_key"
  ON "ChatMessageReaction"("messageId", "userId", "emoji");

CREATE INDEX IF NOT EXISTS "ChatMessageReaction_messageId_idx"
  ON "ChatMessageReaction"("messageId");

-- 5. Publicación supabase_realtime ────────────────────────────────
-- Necesario para que el hook `use-chat-channel.ts` reciba
-- `postgres_changes` (INSERT/UPDATE) en mensajes y canales en vivo.
-- Si la publicación no existe (entorno nuevo) la creamos primero.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END$$;

ALTER PUBLICATION supabase_realtime ADD TABLE "ChatChannel";
ALTER PUBLICATION supabase_realtime ADD TABLE "ChatMessage";
ALTER PUBLICATION supabase_realtime ADD TABLE "ChatMessageReaction";

-- ─────────────────────────────────────────────────────────────────
-- RLS · DEUDA REGISTRADA · APLICAR EN R4-RLS Fase posterior.
--
-- Hoy las server actions filtran via `resolveProjectVisibility`. Para
-- alinear con la política R4 "RLS hardening 100%" añadir luego:
--
--   ALTER TABLE "ChatChannel"          ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE "ChatMessage"          ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE "ChatMessageReaction"  ENABLE ROW LEVEL SECURITY;
--
--   + policies que reúsen `current_setting('app.user_id')` y
--     `current_setting('app.workspace_id')` como otras tablas
--     hardened en R4-A. Se deja fuera del scope de US-7.2.
-- ─────────────────────────────────────────────────────────────────
