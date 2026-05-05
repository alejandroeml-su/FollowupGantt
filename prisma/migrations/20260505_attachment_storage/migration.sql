-- 2026-05-05 · Wave P8 · Equipo P8-4 — Supabase Storage real para Attachments.
--
-- Extiende `Attachment` para soportar uploads reales a bucket `attachments`
-- de Supabase Storage:
--   - `storagePath`     : path dentro del bucket (`{userId}/{uuid}-{name}`).
--   - `mimeType`        : mime validado por whitelist (image/*, application/pdf, text/*, application/zip).
--   - `sizeBytes`       : tamaño real del blob subido (cap 25MB).
--   - `uploadedById`    : FK a `User` (alias semántico de `userId`; se preservan ambos durante transición).
--   - `uploadedAt`      : timestamp del upload (separado de `createdAt` por si se reemplaza el archivo).
--
-- También relaja `url` a NULLABLE: el flujo nuevo no genera URL directa (se usa
-- signed URL bajo demanda con TTL de 1h).
--
-- Aplicación (idempotente · usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS):
--   1. Local:    psql $DATABASE_URL -f prisma/migrations/20260505_attachment_storage/migration.sql
--   2. Supabase: pegar este archivo en SQL Editor (o vía MCP `apply_migration`).
--   3. Alternativa dev: npx prisma db push  (NO en producción).
--
-- Patrón de referencia: prisma/migrations/20260504_user_image_checklist/migration.sql.

-- ─── Relajar `url` a NULLABLE (legacy, deprecated) ────────────────────
ALTER TABLE "Attachment" ALTER COLUMN "url" DROP NOT NULL;

-- ─── Nuevas columnas ─────────────────────────────────────────────────
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "storagePath"  TEXT;
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "mimeType"     TEXT;
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "sizeBytes"    INTEGER;
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "uploadedById" TEXT;
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "uploadedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ─── FK a User para uploadedById (SetNull al borrar usuario) ─────────
ALTER TABLE "Attachment"
  DROP CONSTRAINT IF EXISTS "Attachment_uploadedById_fkey",
  ADD CONSTRAINT  "Attachment_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Índices ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "Attachment_taskId_idx"
  ON "Attachment"("taskId");
CREATE INDEX IF NOT EXISTS "Attachment_uploadedById_uploadedAt_idx"
  ON "Attachment"("uploadedById", "uploadedAt");

-- ─── Notas operativas ────────────────────────────────────────────────
-- 1. Crear el bucket `attachments` en Supabase Dashboard:
--      Storage → New bucket → name=attachments → Public=OFF.
-- 2. Aplicar la RLS policy de storage.objects (ver
--    docs/operations/supabase-storage.md).
-- 3. Configurar env vars:
--      NEXT_PUBLIC_SUPABASE_URL          (URL del proyecto Supabase)
--      NEXT_PUBLIC_SUPABASE_ANON_KEY     (anon key)
--      SUPABASE_SERVICE_ROLE_KEY         (service role · solo server, NO bundle público)
