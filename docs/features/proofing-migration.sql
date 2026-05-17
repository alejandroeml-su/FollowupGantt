-- US-7.5 · Proofing (R4) — Migration SQL
--
-- NO APLICADA EN PROD todavía. Aplicar vía Supabase MCP
-- (`mcp__claude_ai_Supabase__apply_migration`) cuando Edwin autorice.
-- Project: bpiugqsjnlwqfhbnkirh.
--
-- Cambios:
--   1. Enum `ProofingAnnotationStatus` (OPEN | RESOLVED | CHANGES_REQUESTED).
--   2. Valor `PROOFING_ANNOTATION` agregado a enum `NotificationType`.
--   3. Tabla `AttachmentVersion` — versionado opcional de assets.
--   4. Tabla `ProofingAnnotation` — anotaciones ancladas con threading
--      self-reference + status workflow + resolver.
--
-- Convenciones del repo:
--   - Coordenadas (x, y) son DOUBLE PRECISION normalizadas en [0..1]
--     (CHECK constraint).
--   - PageNumber se reserva para multi-page PDF; default NULL.
--   - Cascade en attachment / parent thread.
--   - SetNull en author/resolver/uploadedBy para preservar historia
--     post-delete del User (alineado con Comment, Defect).

-- ─────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "ProofingAnnotationStatus" AS ENUM ('OPEN', 'RESOLVED', 'CHANGES_REQUESTED');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PROOFING_ANNOTATION';

-- ─────────────────────────────────────────────────────────────
-- 2. AttachmentVersion (versionado opcional)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "AttachmentVersion" (
  "id"           TEXT PRIMARY KEY,
  "attachmentId" TEXT NOT NULL,
  "version"      INTEGER NOT NULL,
  "storagePath"  TEXT NOT NULL,
  "mimeType"     TEXT,
  "sizeBytes"    INTEGER,
  "uploadedById" TEXT,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AttachmentVersion_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE,
  CONSTRAINT "AttachmentVersion_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "AttachmentVersion_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "AttachmentVersion_attachmentId_version_key"
  ON "AttachmentVersion" ("attachmentId", "version");

CREATE INDEX "AttachmentVersion_attachmentId_version_idx"
  ON "AttachmentVersion" ("attachmentId", "version" DESC);

-- ─────────────────────────────────────────────────────────────
-- 3. ProofingAnnotation
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "ProofingAnnotation" (
  "id"                  TEXT PRIMARY KEY,
  "attachmentId"        TEXT NOT NULL,
  "x"                   DOUBLE PRECISION NOT NULL,
  "y"                   DOUBLE PRECISION NOT NULL,
  "pageNumber"          INTEGER,
  "text"                TEXT NOT NULL,
  "status"              "ProofingAnnotationStatus" NOT NULL DEFAULT 'OPEN',
  "parentAnnotationId"  TEXT,
  "attachmentVersionId" TEXT,
  "authorId"            TEXT,
  "resolvedAt"          TIMESTAMP(3),
  "resolvedById"        TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProofingAnnotation_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE,
  CONSTRAINT "ProofingAnnotation_parentAnnotationId_fkey"
    FOREIGN KEY ("parentAnnotationId") REFERENCES "ProofingAnnotation"("id") ON DELETE CASCADE,
  CONSTRAINT "ProofingAnnotation_attachmentVersionId_fkey"
    FOREIGN KEY ("attachmentVersionId") REFERENCES "AttachmentVersion"("id") ON DELETE SET NULL,
  CONSTRAINT "ProofingAnnotation_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "ProofingAnnotation_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL,

  -- Coordenadas normalizadas en [0..1] respecto al bounding-box renderizado.
  CONSTRAINT "ProofingAnnotation_x_range_check" CHECK ("x" >= 0 AND "x" <= 1),
  CONSTRAINT "ProofingAnnotation_y_range_check" CHECK ("y" >= 0 AND "y" <= 1),
  CONSTRAINT "ProofingAnnotation_pageNumber_check"
    CHECK ("pageNumber" IS NULL OR "pageNumber" >= 1)
);

CREATE INDEX "ProofingAnnotation_attachmentId_status_createdAt_idx"
  ON "ProofingAnnotation" ("attachmentId", "status", "createdAt");

CREATE INDEX "ProofingAnnotation_parentAnnotationId_idx"
  ON "ProofingAnnotation" ("parentAnnotationId");

CREATE INDEX "ProofingAnnotation_authorId_idx"
  ON "ProofingAnnotation" ("authorId");

-- ─────────────────────────────────────────────────────────────
-- 4. RLS (deferred — alineado con `Attachment` actual)
-- ─────────────────────────────────────────────────────────────
-- ProofingAnnotation y AttachmentVersion heredan visibilidad a través de
-- Attachment → Task → Project. Las server actions usan
-- `requireProjectAccess(task.projectId)` para gating, igual que
-- `attachments.ts`. RLS policy a nivel BD se diferirá a Wave R4-A
-- (hardening RLS 100%); por ahora la única superficie de mutación son
-- las server actions y la API v2 NO expone estos modelos.
