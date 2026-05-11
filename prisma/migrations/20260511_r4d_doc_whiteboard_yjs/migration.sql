-- ============================================================================
-- R4-D · DocSpace + Real-time co-edit · Yjs CRDT state snapshots
-- ----------------------------------------------------------------------------
-- Añade columnas binarias (bytea) para persistir el state Yjs serializado
-- (state vector + document) tanto en `Doc` como en `Whiteboard`.
--
-- Diseño:
--   - Aditivo, idempotente: `ADD COLUMN IF NOT EXISTS` no rompe si la
--     migración corre dos veces (Edwin a veces re-aplica via `prisma db push`).
--   - Nullable: backward compat con docs/whiteboards creados antes de R4-D.
--     El editor colaborativo hace lazy-init de Yjs desde `content` (markdown)
--     o desde la lista relacional de `WhiteboardElement` al primer co-edit.
--   - `Bytes` en Prisma → `bytea` en PostgreSQL. Tamaño esperado < 2 MB
--     (Supabase Realtime payload limit es ~10 MB; un document Yjs comprimido
--     bien por debajo). Si crece, considerar TOAST o storage externo.
-- ============================================================================

ALTER TABLE "Doc"
  ADD COLUMN IF NOT EXISTS "contentYjs" bytea;

ALTER TABLE "Whiteboard"
  ADD COLUMN IF NOT EXISTS "stateYjs" bytea;
