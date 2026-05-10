-- Wave P14d (Hardening Pre-POC) — Helper SQL para RLS basada en RBAC P13.
--
-- Implementa la función `app.is_project_member(user_id, project_id)` que
-- centraliza la regla de visibilidad jerárquica acumulativa P13:
--
--   USER < GERENTE_AREA < GERENCIA_GENERAL < ADMIN < SUPER_ADMIN
--
-- Defer activación de policies restrictivas: el backend hoy se conecta
-- como `service_role` y bypasea RLS automáticamente. La función se
-- registra para que cuando migremos a Supabase Auth o inyección de
-- contexto via `SET LOCAL app.current_user_id`, las policies puedan
-- usarla con un cambio quirúrgico, sin re-implementar la lógica.
--
-- Patrón típico de activación (NO incluido en esta migration):
--   1. Asegurar que el cliente pasa `SET LOCAL app.current_user_id = '<uuid>'`
--      al inicio de cada session/transaction.
--   2. ALTER POLICY "Impediment_all" ON "Impediment"
--        USING (app.is_project_member(
--          current_setting('app.current_user_id', true),
--          (SELECT s."projectId" FROM "Sprint" s WHERE s.id = "Impediment"."sprintId")
--        ));
--   3. Revocar el bypass del service_role para forzar que TODAS las
--      queries pasen por RLS.
--
-- Idempotente: usa CREATE OR REPLACE FUNCTION + CREATE SCHEMA IF NOT EXISTS.

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.is_project_member(
  p_user_id TEXT,
  p_project_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_role_names TEXT[];
  v_user_gerencia_id TEXT;
  v_project_gerencia_id TEXT;
  v_project_workspace_id TEXT;
  v_user_workspace_ids TEXT[];
BEGIN
  -- Sin contexto de usuario → denegar (defensa en profundidad).
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RETURN FALSE;
  END IF;
  IF p_project_id IS NULL OR p_project_id = '' THEN
    RETURN FALSE;
  END IF;

  -- 1. Cargar roles del usuario.
  SELECT ARRAY_AGG(r.name)
  INTO v_role_names
  FROM "UserRole" ur
  JOIN "Role" r ON r.id = ur."roleId"
  WHERE ur."userId" = p_user_id;

  -- 2. Acceso global · ADMIN/SUPER_ADMIN ven todo.
  IF v_role_names && ARRAY['SUPER_ADMIN', 'ADMIN'] THEN
    RETURN TRUE;
  END IF;

  -- 3. Cargar metadata del usuario y proyecto en paralelo.
  SELECT u."gerenciaId" INTO v_user_gerencia_id
  FROM "User" u WHERE u.id = p_user_id;

  SELECT p."workspaceId", a."gerenciaId"
  INTO v_project_workspace_id, v_project_gerencia_id
  FROM "Project" p
  LEFT JOIN "Area" a ON a.id = p."areaId"
  WHERE p.id = p_project_id;

  -- 4. GERENCIA_GENERAL · todos los proyectos del workspace activo.
  IF v_role_names && ARRAY['GERENCIA_GENERAL']
     AND v_project_workspace_id IS NOT NULL THEN
    SELECT ARRAY_AGG(wm."workspaceId")
    INTO v_user_workspace_ids
    FROM "WorkspaceMember" wm
    WHERE wm."userId" = p_user_id;
    IF v_project_workspace_id = ANY(v_user_workspace_ids) THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- 5. GERENTE_AREA · proyectos de su gerencia.
  IF v_role_names && ARRAY['GERENTE_AREA']
     AND v_user_gerencia_id IS NOT NULL
     AND v_user_gerencia_id = v_project_gerencia_id THEN
    RETURN TRUE;
  END IF;

  -- 6. Asignación directa al proyecto.
  IF EXISTS (
    SELECT 1 FROM "ProjectAssignment" pa
    WHERE pa."userId" = p_user_id AND pa."projectId" = p_project_id
  ) THEN
    RETURN TRUE;
  END IF;

  -- 7. Asignación vía equipo (TeamMember + TeamProject).
  IF EXISTS (
    SELECT 1
    FROM "TeamMember" tm
    JOIN "TeamProject" tp ON tp."teamId" = tm."teamId"
    WHERE tm."userId" = p_user_id AND tp."projectId" = p_project_id
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION app.is_project_member(TEXT, TEXT) IS
  'Wave P14d — Implementa la matriz de visibilidad RBAC P13. Devuelve TRUE si el usuario tiene acceso al proyecto según su rol jerárquico (USER, GERENTE_AREA, GERENCIA_GENERAL, ADMIN, SUPER_ADMIN), gerencia asignada, ProjectAssignment directo o membership de Team con TeamProject.';

-- Helper de testeo · permite verificar la lógica desde fuera.
-- Ejemplo: SELECT app.is_project_member('<userId>', '<projectId>');
