-- Wave P17-C · Self-Service Admin (panel /admin SUPER_ADMIN)
-- Aditiva: amplía Workspace con description + archivedAt y crea
-- el catálogo central GlobalTemplate.

-- ───────────────────────── Workspace · campos extra ─────────────────────────
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "archivedAt"  TIMESTAMP(3);

-- Index para listar rápidamente workspaces activos en el switcher.
CREATE INDEX IF NOT EXISTS "Workspace_archivedAt_idx"
  ON "Workspace"("archivedAt");

-- ───────────────────────── GlobalTemplate · catálogo central ─────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GlobalTemplateKind') THEN
    CREATE TYPE "GlobalTemplateKind" AS ENUM ('PROJECT', 'WBS', 'DOR_DOD', 'COMM_PLAN');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "GlobalTemplate" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name"        TEXT NOT NULL,
  "kind"        "GlobalTemplateKind" NOT NULL,
  "payload"     JSONB NOT NULL,
  "workspaceId" TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "createdById" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "GlobalTemplate_kind_idx"
  ON "GlobalTemplate"("kind");
CREATE INDEX IF NOT EXISTS "GlobalTemplate_workspaceId_idx"
  ON "GlobalTemplate"("workspaceId");

-- RLS: Open policy mientras el guard `requireSuperAdmin()` sea la frontera
-- de seguridad real. Mantenemos el patrón de las migraciones P15/P14.
ALTER TABLE "GlobalTemplate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "GlobalTemplate_all" ON "GlobalTemplate";
CREATE POLICY "GlobalTemplate_all" ON "GlobalTemplate" FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE "GlobalTemplate" IS
  'Wave P17-C — Plantillas globales gestionadas desde el panel /admin (SUPER_ADMIN). workspaceId NULL = catálogo global; set = clon atado al workspace tras "Aplicar".';
