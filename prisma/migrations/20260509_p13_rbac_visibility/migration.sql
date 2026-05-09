-- Wave P13 (RBAC visibilidad) — extiende RBAC con jerarquía de gerencia
-- y visibilidad por equipo. Aditivo, idempotente.

-- ─────────────────────────────────────────────────────────────────────
-- User.gerenciaId · solo aplica si el rol es GERENTE_AREA
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "gerenciaId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'User_gerenciaId_fkey' AND table_name = 'User'
  ) THEN
    ALTER TABLE "User"
      ADD CONSTRAINT "User_gerenciaId_fkey"
      FOREIGN KEY ("gerenciaId") REFERENCES "Gerencia"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "User_gerenciaId_idx" ON "User"("gerenciaId");

COMMENT ON COLUMN "User"."gerenciaId" IS
  'Wave P13 — Gerencia que el usuario gestiona si rol = GERENTE_AREA. NULL para roles superiores o estándar.';

-- ─────────────────────────────────────────────────────────────────────
-- TeamProject · M2M Team↔Project para visibilidad por equipo
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TeamProject" (
  "teamId"    TEXT NOT NULL REFERENCES "Team"("id") ON DELETE CASCADE,
  "projectId" TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("teamId", "projectId")
);
CREATE INDEX IF NOT EXISTS "TeamProject_projectId_idx" ON "TeamProject"("projectId");

ALTER TABLE "TeamProject" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "TeamProject_all" ON "TeamProject";
CREATE POLICY "TeamProject_all" ON "TeamProject" FOR ALL USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────
-- Roles RBAC · seed de los 5 roles jerárquicos (idempotente)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO "Role" (id, name, description, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'USER',             'Usuario estándar · solo proyectos asignados directos o por equipo.',          NOW(), NOW()),
  (gen_random_uuid()::text, 'GERENTE_AREA',     'Gerente de área · proyectos de su gerencia + asignados.',                     NOW(), NOW()),
  (gen_random_uuid()::text, 'GERENCIA_GENERAL', 'Gerencia General · todos los proyectos del workspace activo.',                 NOW(), NOW()),
  (gen_random_uuid()::text, 'ADMIN',            'Administrador · todos los proyectos en todos los workspaces.',                 NOW(), NOW()),
  (gen_random_uuid()::text, 'SUPER_ADMIN',      'Super Administrador · acceso total + configuración del sistema.',              NOW(), NOW())
ON CONFLICT (name) DO NOTHING;
