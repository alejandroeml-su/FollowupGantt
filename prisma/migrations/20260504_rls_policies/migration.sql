-- =====================================================================
-- FollowupGantt · Row Level Security (RLS) policies
-- =====================================================================
-- Equipo C1 · Ola P5+ · Defensa en profundidad para Supabase prod.
--
-- Estrategia (ver docs/operations/rls-policies.md):
--   * El backend (Next.js server actions) se conecta a Postgres con un
--     rol que tiene BYPASSRLS (postgres / service_role). Las server
--     actions YA validan auth en Node antes de tocar la BD; RLS aquí es
--     defensa secundaria contra cualquier query directa con la anon-key
--     o con un rol "authenticated" (Supabase Auth, dashboards, scripts).
--
--   * Patrones de policy:
--       - Tablas multi-tenant (Project, Task, Goal, Whiteboard, Doc, …):
--         lectura/escritura para `authenticated` cuyo user esté ligado
--         al recurso (manager, assignee, ProjectAssignment, owner…).
--       - Tablas globales (User, Role, Gerencia, Area, Team):
--         SELECT para autenticados; INSERT/UPDATE/DELETE para SUPER_ADMIN/ADMIN.
--       - Tablas de auditoría (AuditEvent, TaskHistory):
--         SELECT para ADMIN+; INSERT abierto a backend (service_role bypassa).
--       - Tablas públicas (PublicForm activos, FormSubmission):
--         SELECT/INSERT para `anon` (formularios sin sesión).
--       - Tablas privadas por owner (ApiToken, Webhook, SavedView,
--         Notification, TimeEntry, UserHourlyRate, NotificationPreference,
--         PasswordResetToken, Session, Account):
--         CRUD sólo para el dueño (`userId = auth.uid()`).
--       - WorkspaceMember y derivados: scoping por membresía.
--
--   * `auth.uid()` es la helper estándar de Supabase Auth. La aplicación
--     todavía usa sesión propia (`Session` en Prisma), pero las policies
--     se escriben en este formato para que entren en vigor cuando Edwin
--     migre a Supabase Auth (Google/Microsoft SSO en P3 ya están listos
--     para emitir Sessions equivalentes). Hasta entonces, el rol del
--     backend bypassa RLS.
--
-- Idempotente: cada CREATE POLICY va precedido por DROP POLICY IF EXISTS.
-- Aplicar dos veces no falla.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Helpers reutilizables (functions SECURITY DEFINER)
-- ---------------------------------------------------------------------
-- Devuelve TRUE si el `auth.uid()` actual está asignado al projectId,
-- es manager del proyecto, o tiene rol ADMIN/SUPER_ADMIN.
-- SECURITY DEFINER se evita: la función debe correr con permisos del
-- caller para no escalar privilegios. Marcamos STABLE para permitir
-- caching dentro del mismo statement.

CREATE SCHEMA IF NOT EXISTS app_security;

CREATE OR REPLACE FUNCTION app_security.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "UserRole" ur
    JOIN "Role" r ON r.id = ur."roleId"
    WHERE ur."userId" = auth.uid()::text
      AND r.name IN ('ADMIN', 'SUPER_ADMIN')
  );
$$;

CREATE OR REPLACE FUNCTION app_security.has_project_access(project_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    project_id IS NULL
    OR app_security.is_admin()
    OR EXISTS (
      SELECT 1 FROM "Project" p
      WHERE p.id = project_id AND p."managerId" = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM "ProjectAssignment" pa
      WHERE pa."projectId" = project_id AND pa."userId" = auth.uid()::text
    );
$$;

CREATE OR REPLACE FUNCTION app_security.has_workspace_access(workspace_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    workspace_id IS NULL
    OR app_security.is_admin()
    OR EXISTS (
      SELECT 1 FROM "Workspace" w
      WHERE w.id = workspace_id AND w."ownerId" = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM "WorkspaceMember" wm
      WHERE wm."workspaceId" = workspace_id AND wm."userId" = auth.uid()::text
    );
$$;

CREATE OR REPLACE FUNCTION app_security.has_task_access(task_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "Task" t
    WHERE t.id = task_id
      AND app_security.has_project_access(t."projectId")
  );
$$;

GRANT USAGE ON SCHEMA app_security TO authenticated, anon;

-- ---------------------------------------------------------------------
-- 1. ENABLE ROW LEVEL SECURITY (todas las 56 tablas reales del schema)
-- ---------------------------------------------------------------------
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY es idempotente: ejecutarlo
-- dos veces no da error. FORCE ROW LEVEL SECURITY se omite a propósito
-- porque el postgres/service role debe seguir bypaseando.

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PasswordResetToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Gerencia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Area" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Phase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sprint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BoardColumn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskCollaborator" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Comment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskHistory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskDependency" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Baseline" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkCalendar" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MindMap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MindMapNode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MindMapEdge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserHourlyRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomFieldDef" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomFieldValue" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SavedView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurrenceRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeyResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PublicForm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Whiteboard" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WhiteboardElement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskInsight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Workspace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WorkspaceInvitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Webhook" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Doc" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Integration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskGitHubLink" ENABLE ROW LEVEL SECURITY;

-- Tabla implícita de Prisma para M:N KeyResult ↔ Task
ALTER TABLE "_KeyResultTasks" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 2. POLICIES — Usuarios y autenticación
-- ---------------------------------------------------------------------

-- User: cualquier autenticado lee su propio perfil + perfiles que
-- referencia (assignee, manager…). Para simplicidad permitimos SELECT
-- a todos los autenticados (datos no sensibles: name, email). Mutaciones
-- sólo para el propio user o ADMIN.
DROP POLICY IF EXISTS user_select ON "User";
CREATE POLICY user_select ON "User"
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS user_update_self ON "User";
CREATE POLICY user_update_self ON "User"
  FOR UPDATE TO authenticated
  USING (id = auth.uid()::text OR app_security.is_admin())
  WITH CHECK (id = auth.uid()::text OR app_security.is_admin());

DROP POLICY IF EXISTS user_admin_all ON "User";
CREATE POLICY user_admin_all ON "User"
  FOR ALL TO authenticated
  USING (app_security.is_admin())
  WITH CHECK (app_security.is_admin());

-- Account / Session / PasswordResetToken: sólo el dueño.
DROP POLICY IF EXISTS account_owner ON "Account";
CREATE POLICY account_owner ON "Account"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS session_owner ON "Session";
CREATE POLICY session_owner ON "Session"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS password_reset_owner ON "PasswordResetToken";
CREATE POLICY password_reset_owner ON "PasswordResetToken"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

-- Role / UserRole: SELECT para autenticados; mutaciones sólo ADMIN.
DROP POLICY IF EXISTS role_select ON "Role";
CREATE POLICY role_select ON "Role"
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS role_admin_write ON "Role";
CREATE POLICY role_admin_write ON "Role"
  FOR ALL TO authenticated
  USING (app_security.is_admin())
  WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS user_role_select ON "UserRole";
CREATE POLICY user_role_select ON "UserRole"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid()::text OR app_security.is_admin());

DROP POLICY IF EXISTS user_role_admin_write ON "UserRole";
CREATE POLICY user_role_admin_write ON "UserRole"
  FOR ALL TO authenticated
  USING (app_security.is_admin())
  WITH CHECK (app_security.is_admin());

-- ---------------------------------------------------------------------
-- 3. POLICIES — Catálogos organizacionales (Gerencia / Area / Team)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS gerencia_select ON "Gerencia";
CREATE POLICY gerencia_select ON "Gerencia"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gerencia_admin_write ON "Gerencia";
CREATE POLICY gerencia_admin_write ON "Gerencia"
  FOR ALL TO authenticated
  USING (app_security.is_admin()) WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS area_select ON "Area";
CREATE POLICY area_select ON "Area"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS area_admin_write ON "Area";
CREATE POLICY area_admin_write ON "Area"
  FOR ALL TO authenticated
  USING (app_security.is_admin()) WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS team_select ON "Team";
CREATE POLICY team_select ON "Team"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS team_admin_write ON "Team";
CREATE POLICY team_admin_write ON "Team"
  FOR ALL TO authenticated
  USING (app_security.is_admin()) WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS team_member_select ON "TeamMember";
CREATE POLICY team_member_select ON "TeamMember"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS team_member_admin_write ON "TeamMember";
CREATE POLICY team_member_admin_write ON "TeamMember"
  FOR ALL TO authenticated
  USING (app_security.is_admin()) WITH CHECK (app_security.is_admin());

-- ---------------------------------------------------------------------
-- 4. POLICIES — Workspaces (multi-tenancy)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS workspace_member_access ON "Workspace";
CREATE POLICY workspace_member_access ON "Workspace"
  FOR SELECT TO authenticated
  USING (app_security.has_workspace_access(id));

DROP POLICY IF EXISTS workspace_owner_write ON "Workspace";
CREATE POLICY workspace_owner_write ON "Workspace"
  FOR ALL TO authenticated
  USING ("ownerId" = auth.uid()::text OR app_security.is_admin())
  WITH CHECK ("ownerId" = auth.uid()::text OR app_security.is_admin());

DROP POLICY IF EXISTS workspace_member_select ON "WorkspaceMember";
CREATE POLICY workspace_member_select ON "WorkspaceMember"
  FOR SELECT TO authenticated
  USING (
    "userId" = auth.uid()::text
    OR app_security.has_workspace_access("workspaceId")
  );

DROP POLICY IF EXISTS workspace_member_admin_write ON "WorkspaceMember";
CREATE POLICY workspace_member_admin_write ON "WorkspaceMember"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Workspace" w
      WHERE w.id = "WorkspaceMember"."workspaceId"
        AND (w."ownerId" = auth.uid()::text OR app_security.is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Workspace" w
      WHERE w.id = "WorkspaceMember"."workspaceId"
        AND (w."ownerId" = auth.uid()::text OR app_security.is_admin())
    )
  );

DROP POLICY IF EXISTS workspace_invitation_access ON "WorkspaceInvitation";
CREATE POLICY workspace_invitation_access ON "WorkspaceInvitation"
  FOR SELECT TO authenticated
  USING (app_security.has_workspace_access("workspaceId"));
DROP POLICY IF EXISTS workspace_invitation_admin_write ON "WorkspaceInvitation";
CREATE POLICY workspace_invitation_admin_write ON "WorkspaceInvitation"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Workspace" w
      WHERE w.id = "WorkspaceInvitation"."workspaceId"
        AND (w."ownerId" = auth.uid()::text OR app_security.is_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Workspace" w
      WHERE w.id = "WorkspaceInvitation"."workspaceId"
        AND (w."ownerId" = auth.uid()::text OR app_security.is_admin())
    )
  );

-- ---------------------------------------------------------------------
-- 5. POLICIES — Project + Project assignments
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS project_access_select ON "Project";
CREATE POLICY project_access_select ON "Project"
  FOR SELECT TO authenticated
  USING (app_security.has_project_access(id));

DROP POLICY IF EXISTS project_manager_write ON "Project";
CREATE POLICY project_manager_write ON "Project"
  FOR ALL TO authenticated
  USING (
    "managerId" = auth.uid()::text OR app_security.is_admin()
  )
  WITH CHECK (
    "managerId" = auth.uid()::text OR app_security.is_admin()
  );

DROP POLICY IF EXISTS project_assignment_select ON "ProjectAssignment";
CREATE POLICY project_assignment_select ON "ProjectAssignment"
  FOR SELECT TO authenticated
  USING (
    "userId" = auth.uid()::text
    OR app_security.has_project_access("projectId")
  );
DROP POLICY IF EXISTS project_assignment_admin_write ON "ProjectAssignment";
CREATE POLICY project_assignment_admin_write ON "ProjectAssignment"
  FOR ALL TO authenticated
  USING (
    app_security.is_admin()
    OR EXISTS (
      SELECT 1 FROM "Project" p
      WHERE p.id = "ProjectAssignment"."projectId"
        AND p."managerId" = auth.uid()::text
    )
  )
  WITH CHECK (
    app_security.is_admin()
    OR EXISTS (
      SELECT 1 FROM "Project" p
      WHERE p.id = "ProjectAssignment"."projectId"
        AND p."managerId" = auth.uid()::text
    )
  );

-- ---------------------------------------------------------------------
-- 6. POLICIES — Tablas dependientes de Project
-- ---------------------------------------------------------------------

-- Helper macro mental: "FOR ALL ... USING(has_project_access(projectId))"
-- aplica a todas las tablas que cuelgan de Project.

DROP POLICY IF EXISTS phase_project_access ON "Phase";
CREATE POLICY phase_project_access ON "Phase"
  FOR ALL TO authenticated
  USING (app_security.has_project_access("projectId"))
  WITH CHECK (app_security.has_project_access("projectId"));

DROP POLICY IF EXISTS sprint_project_access ON "Sprint";
CREATE POLICY sprint_project_access ON "Sprint"
  FOR ALL TO authenticated
  USING (app_security.has_project_access("projectId"))
  WITH CHECK (app_security.has_project_access("projectId"));

DROP POLICY IF EXISTS board_column_project_access ON "BoardColumn";
CREATE POLICY board_column_project_access ON "BoardColumn"
  FOR ALL TO authenticated
  USING (app_security.has_project_access("projectId"))
  WITH CHECK (app_security.has_project_access("projectId"));

DROP POLICY IF EXISTS task_project_access ON "Task";
CREATE POLICY task_project_access ON "Task"
  FOR ALL TO authenticated
  USING (app_security.has_project_access("projectId"))
  WITH CHECK (app_security.has_project_access("projectId"));

DROP POLICY IF EXISTS baseline_project_access ON "Baseline";
CREATE POLICY baseline_project_access ON "Baseline"
  FOR ALL TO authenticated
  USING (app_security.has_project_access("projectId"))
  WITH CHECK (app_security.has_project_access("projectId"));

DROP POLICY IF EXISTS custom_field_def_project_access ON "CustomFieldDef";
CREATE POLICY custom_field_def_project_access ON "CustomFieldDef"
  FOR ALL TO authenticated
  USING (app_security.has_project_access("projectId"))
  WITH CHECK (app_security.has_project_access("projectId"));

-- ---------------------------------------------------------------------
-- 7. POLICIES — Tablas dependientes de Task
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS task_collaborator_access ON "TaskCollaborator";
CREATE POLICY task_collaborator_access ON "TaskCollaborator"
  FOR ALL TO authenticated
  USING (
    "userId" = auth.uid()::text
    OR app_security.has_task_access("taskId")
  )
  WITH CHECK (app_security.has_task_access("taskId"));

DROP POLICY IF EXISTS comment_task_access ON "Comment";
CREATE POLICY comment_task_access ON "Comment"
  FOR ALL TO authenticated
  USING (app_security.has_task_access("taskId"))
  WITH CHECK (app_security.has_task_access("taskId"));

-- TaskHistory: sólo SELECT para usuarios con acceso al proyecto.
-- INSERT lo hace siempre el backend con service_role (bypass).
DROP POLICY IF EXISTS task_history_select ON "TaskHistory";
CREATE POLICY task_history_select ON "TaskHistory"
  FOR SELECT TO authenticated
  USING (app_security.has_task_access("taskId"));

DROP POLICY IF EXISTS attachment_task_access ON "Attachment";
CREATE POLICY attachment_task_access ON "Attachment"
  FOR ALL TO authenticated
  USING (app_security.has_task_access("taskId"))
  WITH CHECK (app_security.has_task_access("taskId"));

DROP POLICY IF EXISTS task_dependency_access ON "TaskDependency";
CREATE POLICY task_dependency_access ON "TaskDependency"
  FOR ALL TO authenticated
  USING (
    app_security.has_task_access("predecessorId")
    OR app_security.has_task_access("successorId")
  )
  WITH CHECK (
    app_security.has_task_access("predecessorId")
    AND app_security.has_task_access("successorId")
  );

DROP POLICY IF EXISTS custom_field_value_task_access ON "CustomFieldValue";
CREATE POLICY custom_field_value_task_access ON "CustomFieldValue"
  FOR ALL TO authenticated
  USING (app_security.has_task_access("taskId"))
  WITH CHECK (app_security.has_task_access("taskId"));

DROP POLICY IF EXISTS task_insight_access ON "TaskInsight";
CREATE POLICY task_insight_access ON "TaskInsight"
  FOR ALL TO authenticated
  USING (app_security.has_task_access("taskId"))
  WITH CHECK (app_security.has_task_access("taskId"));

DROP POLICY IF EXISTS task_github_link_access ON "TaskGitHubLink";
CREATE POLICY task_github_link_access ON "TaskGitHubLink"
  FOR ALL TO authenticated
  USING (app_security.has_task_access("taskId"))
  WITH CHECK (app_security.has_task_access("taskId"));

-- ---------------------------------------------------------------------
-- 8. POLICIES — Calendarios laborales (globales por workspace en futuro)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS work_calendar_select ON "WorkCalendar";
CREATE POLICY work_calendar_select ON "WorkCalendar"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS work_calendar_admin_write ON "WorkCalendar";
CREATE POLICY work_calendar_admin_write ON "WorkCalendar"
  FOR ALL TO authenticated
  USING (app_security.is_admin()) WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS holiday_select ON "Holiday";
CREATE POLICY holiday_select ON "Holiday"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS holiday_admin_write ON "Holiday";
CREATE POLICY holiday_admin_write ON "Holiday"
  FOR ALL TO authenticated
  USING (app_security.is_admin()) WITH CHECK (app_security.is_admin());

-- ---------------------------------------------------------------------
-- 9. POLICIES — MindMap (project o owner-personal)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS mindmap_access ON "MindMap";
CREATE POLICY mindmap_access ON "MindMap"
  FOR ALL TO authenticated
  USING (
    "ownerId" = auth.uid()::text
    OR app_security.has_project_access("projectId")
  )
  WITH CHECK (
    "ownerId" = auth.uid()::text
    OR app_security.has_project_access("projectId")
  );

DROP POLICY IF EXISTS mindmap_node_access ON "MindMapNode";
CREATE POLICY mindmap_node_access ON "MindMapNode"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "MindMap" m
      WHERE m.id = "MindMapNode"."mindMapId"
        AND (
          m."ownerId" = auth.uid()::text
          OR app_security.has_project_access(m."projectId")
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "MindMap" m
      WHERE m.id = "MindMapNode"."mindMapId"
        AND (
          m."ownerId" = auth.uid()::text
          OR app_security.has_project_access(m."projectId")
        )
    )
  );

DROP POLICY IF EXISTS mindmap_edge_access ON "MindMapEdge";
CREATE POLICY mindmap_edge_access ON "MindMapEdge"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "MindMap" m
      WHERE m.id = "MindMapEdge"."mindMapId"
        AND (
          m."ownerId" = auth.uid()::text
          OR app_security.has_project_access(m."projectId")
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "MindMap" m
      WHERE m.id = "MindMapEdge"."mindMapId"
        AND (
          m."ownerId" = auth.uid()::text
          OR app_security.has_project_access(m."projectId")
        )
    )
  );

-- ---------------------------------------------------------------------
-- 10. POLICIES — Time Tracking + Tarifas (privadas por user)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS time_entry_owner ON "TimeEntry";
CREATE POLICY time_entry_owner ON "TimeEntry"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text OR app_security.is_admin())
  WITH CHECK ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS user_hourly_rate_owner ON "UserHourlyRate";
CREATE POLICY user_hourly_rate_owner ON "UserHourlyRate"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text OR app_security.is_admin())
  WITH CHECK ("userId" = auth.uid()::text OR app_security.is_admin());

-- ---------------------------------------------------------------------
-- 11. POLICIES — Notificaciones / preferencias / saved views (private)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS notification_owner ON "Notification";
CREATE POLICY notification_owner ON "Notification"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS notification_pref_owner ON "NotificationPreference";
CREATE POLICY notification_pref_owner ON "NotificationPreference"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS saved_view_owner_or_shared ON "SavedView";
CREATE POLICY saved_view_owner_or_shared ON "SavedView"
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid()::text OR "isShared" = true);
DROP POLICY IF EXISTS saved_view_owner_write ON "SavedView";
CREATE POLICY saved_view_owner_write ON "SavedView"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 12. POLICIES — Templates + Recurrence (autor o project access)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS task_template_access ON "TaskTemplate";
CREATE POLICY task_template_access ON "TaskTemplate"
  FOR SELECT TO authenticated
  USING (
    "createdById" = auth.uid()::text
    OR "isShared" = true
    OR app_security.has_project_access("projectId")
  );
DROP POLICY IF EXISTS task_template_owner_write ON "TaskTemplate";
CREATE POLICY task_template_owner_write ON "TaskTemplate"
  FOR ALL TO authenticated
  USING ("createdById" = auth.uid()::text OR app_security.is_admin())
  WITH CHECK ("createdById" = auth.uid()::text OR app_security.is_admin());

DROP POLICY IF EXISTS recurrence_rule_access ON "RecurrenceRule";
CREATE POLICY recurrence_rule_access ON "RecurrenceRule"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "TaskTemplate" t
      WHERE t.id = "RecurrenceRule"."templateId"
        AND (
          t."createdById" = auth.uid()::text
          OR t."isShared" = true
          OR app_security.has_project_access(t."projectId")
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "TaskTemplate" t
      WHERE t.id = "RecurrenceRule"."templateId"
        AND (
          t."createdById" = auth.uid()::text
          OR app_security.is_admin()
        )
    )
  );

-- ---------------------------------------------------------------------
-- 13. POLICIES — Goals / OKRs
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS goal_access ON "Goal";
CREATE POLICY goal_access ON "Goal"
  FOR SELECT TO authenticated
  USING (
    "ownerId" = auth.uid()::text
    OR app_security.has_project_access("projectId")
    OR app_security.is_admin()
  );
DROP POLICY IF EXISTS goal_owner_write ON "Goal";
CREATE POLICY goal_owner_write ON "Goal"
  FOR ALL TO authenticated
  USING ("ownerId" = auth.uid()::text OR app_security.is_admin())
  WITH CHECK ("ownerId" = auth.uid()::text OR app_security.is_admin());

DROP POLICY IF EXISTS key_result_access ON "KeyResult";
CREATE POLICY key_result_access ON "KeyResult"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Goal" g
      WHERE g.id = "KeyResult"."goalId"
        AND (
          g."ownerId" = auth.uid()::text
          OR app_security.has_project_access(g."projectId")
          OR app_security.is_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Goal" g
      WHERE g.id = "KeyResult"."goalId"
        AND (g."ownerId" = auth.uid()::text OR app_security.is_admin())
    )
  );

-- M:N implícita _KeyResultTasks: requiere acceso al KR y a la Task.
DROP POLICY IF EXISTS key_result_tasks_access ON "_KeyResultTasks";
CREATE POLICY key_result_tasks_access ON "_KeyResultTasks"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "KeyResult" kr
      JOIN "Goal" g ON g.id = kr."goalId"
      WHERE kr.id = "_KeyResultTasks"."A"
        AND (g."ownerId" = auth.uid()::text OR app_security.is_admin())
    )
    AND app_security.has_task_access("_KeyResultTasks"."B")
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "KeyResult" kr
      JOIN "Goal" g ON g.id = kr."goalId"
      WHERE kr.id = "_KeyResultTasks"."A"
        AND (g."ownerId" = auth.uid()::text OR app_security.is_admin())
    )
    AND app_security.has_task_access("_KeyResultTasks"."B")
  );

-- ---------------------------------------------------------------------
-- 14. POLICIES — Public Forms + Submissions (acceso anon)
-- ---------------------------------------------------------------------

-- PublicForm: SELECT abierto a anon SOLO si está activo. Mutaciones
-- restringidas a usuarios con acceso al proyecto (o admin si projectId
-- es null).
DROP POLICY IF EXISTS public_form_anon_select ON "PublicForm";
CREATE POLICY public_form_anon_select ON "PublicForm"
  FOR SELECT TO anon
  USING ("isActive" = true);

DROP POLICY IF EXISTS public_form_authenticated_select ON "PublicForm";
CREATE POLICY public_form_authenticated_select ON "PublicForm"
  FOR SELECT TO authenticated
  USING (
    "isActive" = true
    OR app_security.has_project_access("projectId")
    OR app_security.is_admin()
  );

DROP POLICY IF EXISTS public_form_admin_write ON "PublicForm";
CREATE POLICY public_form_admin_write ON "PublicForm"
  FOR ALL TO authenticated
  USING (
    app_security.is_admin()
    OR app_security.has_project_access("projectId")
  )
  WITH CHECK (
    app_security.is_admin()
    OR app_security.has_project_access("projectId")
  );

-- FormSubmission: anon puede INSERT (formulario público) PERO sólo si
-- el form al que apunta está activo. SELECT/UPDATE/DELETE solo para
-- usuarios con acceso al proyecto del form.
DROP POLICY IF EXISTS form_submission_anon_insert ON "FormSubmission";
CREATE POLICY form_submission_anon_insert ON "FormSubmission"
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "PublicForm" f
      WHERE f.id = "FormSubmission"."formId" AND f."isActive" = true
    )
  );

DROP POLICY IF EXISTS form_submission_authenticated_select ON "FormSubmission";
CREATE POLICY form_submission_authenticated_select ON "FormSubmission"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "PublicForm" f
      WHERE f.id = "FormSubmission"."formId"
        AND (
          app_security.has_project_access(f."projectId")
          OR app_security.is_admin()
        )
    )
  );

DROP POLICY IF EXISTS form_submission_admin_write ON "FormSubmission";
CREATE POLICY form_submission_admin_write ON "FormSubmission"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "PublicForm" f
      WHERE f.id = "FormSubmission"."formId"
        AND (
          app_security.has_project_access(f."projectId")
          OR app_security.is_admin()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "PublicForm" f
      WHERE f.id = "FormSubmission"."formId"
        AND (
          app_security.has_project_access(f."projectId")
          OR app_security.is_admin()
        )
    )
  );

-- ---------------------------------------------------------------------
-- 15. POLICIES — Automations
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS automation_rule_project ON "AutomationRule";
CREATE POLICY automation_rule_project ON "AutomationRule"
  FOR ALL TO authenticated
  USING (
    app_security.has_project_access("projectId")
    OR app_security.is_admin()
  )
  WITH CHECK (
    app_security.has_project_access("projectId")
    OR app_security.is_admin()
  );

DROP POLICY IF EXISTS automation_execution_project ON "AutomationExecution";
CREATE POLICY automation_execution_project ON "AutomationExecution"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "AutomationRule" r
      WHERE r.id = "AutomationExecution"."ruleId"
        AND (
          app_security.has_project_access(r."projectId")
          OR app_security.is_admin()
        )
    )
  );

-- ---------------------------------------------------------------------
-- 16. POLICIES — Whiteboards
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS whiteboard_access ON "Whiteboard";
CREATE POLICY whiteboard_access ON "Whiteboard"
  FOR ALL TO authenticated
  USING (
    "createdById" = auth.uid()::text
    OR app_security.has_project_access("projectId")
  )
  WITH CHECK (
    "createdById" = auth.uid()::text
    OR app_security.has_project_access("projectId")
  );

DROP POLICY IF EXISTS whiteboard_element_access ON "WhiteboardElement";
CREATE POLICY whiteboard_element_access ON "WhiteboardElement"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Whiteboard" w
      WHERE w.id = "WhiteboardElement"."whiteboardId"
        AND (
          w."createdById" = auth.uid()::text
          OR app_security.has_project_access(w."projectId")
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Whiteboard" w
      WHERE w.id = "WhiteboardElement"."whiteboardId"
        AND (
          w."createdById" = auth.uid()::text
          OR app_security.has_project_access(w."projectId")
        )
    )
  );

-- ---------------------------------------------------------------------
-- 17. POLICIES — Docs / Wikis
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS doc_access ON "Doc";
CREATE POLICY doc_access ON "Doc"
  FOR SELECT TO authenticated
  USING (
    "isPublic" = true
    OR "authorId" = auth.uid()::text
    OR "lastEditorId" = auth.uid()::text
    OR app_security.has_project_access("projectId")
    OR app_security.has_task_access("taskId")
    OR app_security.is_admin()
  );

DROP POLICY IF EXISTS doc_author_or_project_write ON "Doc";
CREATE POLICY doc_author_or_project_write ON "Doc"
  FOR ALL TO authenticated
  USING (
    "authorId" = auth.uid()::text
    OR app_security.has_project_access("projectId")
    OR app_security.has_task_access("taskId")
    OR app_security.is_admin()
  )
  WITH CHECK (
    "authorId" = auth.uid()::text
    OR app_security.has_project_access("projectId")
    OR app_security.has_task_access("taskId")
    OR app_security.is_admin()
  );

DROP POLICY IF EXISTS doc_version_access ON "DocVersion";
CREATE POLICY doc_version_access ON "DocVersion"
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "Doc" d
      WHERE d.id = "DocVersion"."docId"
        AND (
          d."isPublic" = true
          OR d."authorId" = auth.uid()::text
          OR app_security.has_project_access(d."projectId")
          OR app_security.has_task_access(d."taskId")
          OR app_security.is_admin()
        )
    )
  );

-- ---------------------------------------------------------------------
-- 18. POLICIES — AuditEvent (sólo ADMIN puede leer)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS audit_event_admin_select ON "AuditEvent";
CREATE POLICY audit_event_admin_select ON "AuditEvent"
  FOR SELECT TO authenticated
  USING (app_security.is_admin());

-- INSERT/UPDATE/DELETE NO se permiten desde authenticated/anon: el
-- backend escribe con service_role. No definimos policy WRITE → default
-- deny aplica.

-- ---------------------------------------------------------------------
-- 19. POLICIES — ApiToken / Webhook (privadas por user)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS api_token_owner ON "ApiToken";
CREATE POLICY api_token_owner ON "ApiToken"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text OR app_security.is_admin())
  WITH CHECK ("userId" = auth.uid()::text);

DROP POLICY IF EXISTS webhook_owner ON "Webhook";
CREATE POLICY webhook_owner ON "Webhook"
  FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text OR app_security.is_admin())
  WITH CHECK ("userId" = auth.uid()::text);

-- ---------------------------------------------------------------------
-- 20. POLICIES — Integration (project-scoped)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS integration_access ON "Integration";
CREATE POLICY integration_access ON "Integration"
  FOR ALL TO authenticated
  USING (
    ("projectId" IS NULL AND app_security.is_admin())
    OR ("projectId" IS NOT NULL AND app_security.has_project_access("projectId"))
  )
  WITH CHECK (
    ("projectId" IS NULL AND app_security.is_admin())
    OR ("projectId" IS NOT NULL AND app_security.has_project_access("projectId"))
  );

-- =====================================================================
-- FIN — RLS aplicado a 56 tablas (51 listadas + Goal/KeyResult/
-- WorkCalendar/Holiday/_KeyResultTasks). Service role / postgres bypassa
-- todas las policies y debe seguir siendo el rol del backend.
-- =====================================================================
