-- Wave P8 · Equipo P8-5 — Calendar sync (Google + Microsoft + ICS export).
--
-- Tablas nuevas:
--   - "CalendarConnection": una fila por (userId, provider). Persiste
--     OAuth tokens (Google/MS) o token público (ICS). Toggles granulares
--     por tipo de evento (milestones / deadlines / sprints).
--   - "CalendarEvent": ledger de items sincronizados. `externalEventId`
--     habilita upsert idempotente al re-correr el cron.
--
-- Idempotente: usa `IF NOT EXISTS` en enum/tablas/índices/FKs.

-- 1. Enum del provider
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CalendarProvider') THEN
    CREATE TYPE "CalendarProvider" AS ENUM ('GOOGLE', 'MICROSOFT', 'ICS');
  END IF;
END
$$;

-- 2. Tabla CalendarConnection
CREATE TABLE IF NOT EXISTS "CalendarConnection" (
  "id"             TEXT PRIMARY KEY,
  "userId"         TEXT NOT NULL,
  "provider"       "CalendarProvider" NOT NULL,
  "accessToken"    TEXT,
  "refreshToken"   TEXT,
  "expiresAt"      TIMESTAMP(3),
  "externalId"     TEXT,
  "syncEnabled"    BOOLEAN NOT NULL DEFAULT true,
  "syncMilestones" BOOLEAN NOT NULL DEFAULT true,
  "syncDeadlines"  BOOLEAN NOT NULL DEFAULT true,
  "syncSprints"    BOOLEAN NOT NULL DEFAULT false,
  "icsToken"       TEXT,
  "lastSyncAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarConnection_icsToken_key"
  ON "CalendarConnection" ("icsToken");

CREATE UNIQUE INDEX IF NOT EXISTS "CalendarConnection_userId_provider_key"
  ON "CalendarConnection" ("userId", "provider");

CREATE INDEX IF NOT EXISTS "CalendarConnection_userId_idx"
  ON "CalendarConnection" ("userId");

-- 3. Tabla CalendarEvent
CREATE TABLE IF NOT EXISTS "CalendarEvent" (
  "id"              TEXT PRIMARY KEY,
  "connectionId"    TEXT NOT NULL,
  "externalEventId" TEXT,
  "taskId"          TEXT,
  "type"            TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "startsAt"        TIMESTAMP(3) NOT NULL,
  "endsAt"          TIMESTAMP(3) NOT NULL,
  "syncedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "CalendarEvent_connectionId_type_idx"
  ON "CalendarEvent" ("connectionId", "type");

CREATE INDEX IF NOT EXISTS "CalendarEvent_taskId_idx"
  ON "CalendarEvent" ("taskId");

-- 4. Foreign keys (DO blocks para idempotencia)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CalendarConnection_userId_fkey'
  ) THEN
    ALTER TABLE "CalendarConnection"
      ADD CONSTRAINT "CalendarConnection_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CalendarEvent_connectionId_fkey'
  ) THEN
    ALTER TABLE "CalendarEvent"
      ADD CONSTRAINT "CalendarEvent_connectionId_fkey"
      FOREIGN KEY ("connectionId") REFERENCES "CalendarConnection"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
