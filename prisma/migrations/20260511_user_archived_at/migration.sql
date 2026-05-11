-- Soft delete para User · permite dar de baja preservando audit/historial.
-- Aditiva e idempotente.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

-- Índice parcial: el listado de usuarios activos es la query caliente
-- (90%+ de los reads). Sin índice parcial Postgres escanearía toda la
-- tabla y filtraría en memoria.
CREATE INDEX IF NOT EXISTS "User_archivedAt_idx"
  ON "User" ("archivedAt")
  WHERE "archivedAt" IS NULL;
