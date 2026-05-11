-- R3.0 · Fase 2 · SSO/SAML (Equipo R3-D)
-- Aditiva e idempotente: crea SsoProvider + SsoUserLink + enum
-- SsoProviderKind. Reaplicable sin efectos colaterales — todas las
-- sentencias usan IF NOT EXISTS / DO $$ ... $$ guards.

-- ───────────────────────── Enum SsoProviderKind ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SsoProviderKind') THEN
    CREATE TYPE "SsoProviderKind" AS ENUM ('SAML');
  END IF;
END$$;

-- ───────────────────────── Tabla SsoProvider ─────────────────────────
CREATE TABLE IF NOT EXISTS "SsoProvider" (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workspaceId"  TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "name"         TEXT NOT NULL,
  "kind"         "SsoProviderKind" NOT NULL DEFAULT 'SAML',
  "entityId"     TEXT NOT NULL,
  "ssoUrl"       TEXT NOT NULL,
  "x509Cert"     TEXT NOT NULL,
  "attributeMap" JSONB NOT NULL,
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "SsoProvider_workspaceId_entityId_key"
  ON "SsoProvider"("workspaceId", "entityId");
CREATE INDEX IF NOT EXISTS "SsoProvider_workspaceId_idx"
  ON "SsoProvider"("workspaceId");
CREATE INDEX IF NOT EXISTS "SsoProvider_enabled_idx"
  ON "SsoProvider"("enabled");

-- ───────────────────────── Tabla SsoUserLink ─────────────────────────
CREATE TABLE IF NOT EXISTS "SsoUserLink" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"      TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "providerId"  TEXT NOT NULL REFERENCES "SsoProvider"("id") ON DELETE CASCADE,
  "externalId"  TEXT NOT NULL,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "SsoUserLink_providerId_externalId_key"
  ON "SsoUserLink"("providerId", "externalId");
CREATE UNIQUE INDEX IF NOT EXISTS "SsoUserLink_providerId_userId_key"
  ON "SsoUserLink"("providerId", "userId");
CREATE INDEX IF NOT EXISTS "SsoUserLink_userId_idx"
  ON "SsoUserLink"("userId");

-- ───────────────────────── RLS ─────────────────────────
-- Open policy mientras los guards `requireSuperAdminOrThrow()` y
-- `requireWorkspaceAccess()` sean la frontera de seguridad real (mismo
-- patrón que P17-C GlobalTemplate). RLS dura llegará en una migración
-- subsiguiente cuando se active el flag `workspace.id` en session var.
ALTER TABLE "SsoProvider" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SsoProvider_all" ON "SsoProvider";
CREATE POLICY "SsoProvider_all" ON "SsoProvider" FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE "SsoUserLink" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SsoUserLink_all" ON "SsoUserLink";
CREATE POLICY "SsoUserLink_all" ON "SsoUserLink" FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE "SsoProvider" IS
  'R3.0 Fase 2 — Proveedores SAML por workspace. x509Cert es la clave pública del IdP (no secreto).';
COMMENT ON TABLE "SsoUserLink" IS
  'R3.0 Fase 2 — Vínculo User↔IdP. externalId = NameID/subject del SAML Assertion.';
