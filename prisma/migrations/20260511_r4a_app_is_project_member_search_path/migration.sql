-- R4-A · Hardening helper `app.is_project_member` con `SET search_path`.
--
-- Cierra advisor Supabase `function_search_path_mutable`:
--
--   Funciones SECURITY DEFINER sin `search_path` fijado son un vector
--   de SQL injection — si un atacante con permisos para crear schemas
--   altera `search_path` antes de invocar la función, puede inyectar
--   código (shadowing de tablas/funciones). Forzar
--   `SET search_path = pg_catalog, public` neutraliza el vector:
--   la función SIEMPRE resuelve identificadores en ese orden,
--   ignorando cualquier `search_path` del caller.
--
-- Recreamos la función con la MISMA lógica de Wave P14d (jerarquía
-- USER < GERENTE_AREA < GERENCIA_GENERAL < ADMIN < SUPER_ADMIN) +
-- la cláusula `SET search_path` al nivel de función.
--
-- También añadimos un helper paralelo `app.is_workspace_member` para
-- tablas workspace-scoped (Vendor, GlobalTemplate, AutoPilotRun,
-- BrainStrategistInsight, AuditStreamTarget, AuditStreamDelivery) que
-- todavía no tenían un equivalente al `is_project_member`.
--
-- Orden: aplicar ANTES de las otras migraciones R4-A para que las
-- nuevas policies referencien la versión hardened.
--
-- Idempotente: `CREATE OR REPLACE FUNCTION` + `CREATE SCHEMA IF NOT EXISTS`.

CREATE SCHEMA IF NOT EXISTS app;

-- ── app.is_project_member ── (re-define con SET search_path)
CREATE OR REPLACE FUNCTION app.is_project_member(
  p_user_id TEXT,
  p_project_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
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

  -- 3. Cargar metadata del usuario y proyecto.
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
  'R4-A hardened (2026-05-11) · Wave P14d helper de visibilidad RBAC P13. '
  'SET search_path=pg_catalog,public cierra advisor function_search_path_mutable. '
  'Devuelve TRUE si el usuario tiene acceso al proyecto vía rol jerárquico '
  '(USER<GERENTE_AREA<GERENCIA_GENERAL<ADMIN<SUPER_ADMIN), gerencia asignada, '
  'ProjectAssignment directo o membership de Team con TeamProject.';

-- ── app.is_workspace_member ── (nuevo · scope workspace)
--
-- Para tablas workspace-scoped que no tienen `projectId` directo (Vendor,
-- GlobalTemplate, AutoPilotRun, BrainStrategistInsight, AuditStreamTarget,
-- AuditStreamDelivery). Misma jerarquía: ADMIN/SUPER_ADMIN bypass,
-- GERENCIA_GENERAL/GERENTE_AREA por gerencia (futuro), o WorkspaceMember.
--
-- Para "workspaceId NULL" (catálogos globales · ej. GlobalTemplate global),
-- solo ADMIN/SUPER_ADMIN pueden tocarlos. La caller debe pasar workspaceId
-- desde la fila o `current_setting('app.workspace_id', true)` para scope.
CREATE OR REPLACE FUNCTION app.is_workspace_member(
  p_user_id TEXT,
  p_workspace_id TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role_names TEXT[];
BEGIN
  -- Sin contexto de usuario → denegar.
  IF p_user_id IS NULL OR p_user_id = '' THEN
    RETURN FALSE;
  END IF;

  -- Cargar roles del usuario.
  SELECT ARRAY_AGG(r.name)
  INTO v_role_names
  FROM "UserRole" ur
  JOIN "Role" r ON r.id = ur."roleId"
  WHERE ur."userId" = p_user_id;

  -- ADMIN/SUPER_ADMIN ven todo (incluso workspaceId NULL = catálogo global).
  IF v_role_names && ARRAY['SUPER_ADMIN', 'ADMIN'] THEN
    RETURN TRUE;
  END IF;

  -- workspaceId NULL = recurso global solo para ADMIN/SUPER_ADMIN.
  IF p_workspace_id IS NULL OR p_workspace_id = '' THEN
    RETURN FALSE;
  END IF;

  -- GERENCIA_GENERAL · debe ser miembro del workspace.
  IF v_role_names && ARRAY['GERENCIA_GENERAL'] THEN
    IF EXISTS (
      SELECT 1 FROM "WorkspaceMember" wm
      WHERE wm."userId" = p_user_id AND wm."workspaceId" = p_workspace_id
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;

  -- Workspace member (owner o member explícito).
  IF EXISTS (
    SELECT 1 FROM "Workspace" w
    WHERE w.id = p_workspace_id AND w."ownerId" = p_user_id
  ) THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "WorkspaceMember" wm
    WHERE wm."userId" = p_user_id AND wm."workspaceId" = p_workspace_id
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION app.is_workspace_member(TEXT, TEXT) IS
  'R4-A (2026-05-11) · Helper paralelo a is_project_member para tablas workspace-scoped '
  '(Vendor, GlobalTemplate, AutoPilotRun, BrainStrategistInsight, AuditStreamTarget). '
  'ADMIN/SUPER_ADMIN bypass total; workspaceId NULL solo para esos roles; '
  'GERENCIA_GENERAL + member explícito + workspace owner permiten acceso al scope.';
