-- R4-A · RLS Hardening Completo (cierre rls_policy_always_true).
--
-- Endurece ~24 tablas que sobrevivieron a Wave P18 con open-policy
-- `USING (true)`. Cada tabla recibe una `<Tabla>_member_only` (o
-- `_workspace_member`) que usa `app.is_project_member` /
-- `app.is_workspace_member` (R4-A hardened con `SET search_path`).
--
-- ADMIN/SUPER_ADMIN tienen bypass natural porque ambas funciones
-- devuelven TRUE para esos roles.
--
-- Pre-requisitos:
--   1. La migración `20260511_r4a_app_is_project_member_search_path`
--      debe aplicarse primero (define las funciones hardened y el
--      nuevo `is_workspace_member`).
--   2. Las server actions que tocan estas tablas DEBEN pasar por
--      `withRlsContextFromSession()` (Wave P14d helper). De lo
--      contrario `current_setting('app.user_id', true)` retorna NULL
--      y las queries devuelven 0 filas (fail-safe). El audit-stream
--      cron y demás background jobs siguen usando service_role
--      (BYPASSRLS), no se ven afectados.
--
-- Cada policy lleva un COMMENT ON POLICY justificando la elección.
--
-- Idempotente: `DROP POLICY IF EXISTS` antes de cada CREATE.

-- ── Guard de pre-condiciones ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'is_project_member'
  ) THEN
    RAISE EXCEPTION
      'Helper app.is_project_member no existe. Aplicar primero migración 20260511_r4a_app_is_project_member_search_path.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app' AND p.proname = 'is_workspace_member'
  ) THEN
    RAISE EXCEPTION
      'Helper app.is_workspace_member no existe. Aplicar primero migración 20260511_r4a_app_is_project_member_search_path.';
  END IF;
END$$;


-- ═════════════════════════════════════════════════════════════════════
-- GRUPO A · Tablas project-scoped con `projectId` directo
-- ═════════════════════════════════════════════════════════════════════

-- ── Epic ── (consolidar 4 policies separadas en una única member_only)
DROP POLICY IF EXISTS "Epic_select_member" ON "Epic";
DROP POLICY IF EXISTS "Epic_insert_member" ON "Epic";
DROP POLICY IF EXISTS "Epic_update_member" ON "Epic";
DROP POLICY IF EXISTS "Epic_delete_admin" ON "Epic";
DROP POLICY IF EXISTS "Epic_member_only" ON "Epic";
CREATE POLICY "Epic_member_only" ON "Epic"
  FOR ALL
  USING (app.is_project_member(current_setting('app.user_id', true), "projectId"))
  WITH CHECK (app.is_project_member(current_setting('app.user_id', true), "projectId"));
COMMENT ON POLICY "Epic_member_only" ON "Epic" IS
  'R4-A · Consolida 4 policies (select/insert/update/delete) abiertas en una sola FOR ALL '
  'restringida a miembros del proyecto. ADMIN/SUPER_ADMIN heredan acceso vía is_project_member.';

-- ── ChangeRequest ── (eliminar policy duplicada open lowercase)
DROP POLICY IF EXISTS "change_request_all" ON "ChangeRequest";
COMMENT ON POLICY "ChangeRequest_member_only" ON "ChangeRequest" IS
  'R4-A · Mantiene policy P18 (ya member_only); elimina duplicada change_request_all '
  'open-policy heredada de Wave P11.';

-- ── Stakeholder ── (eliminar policy duplicada open lowercase)
DROP POLICY IF EXISTS "stakeholder_all" ON "Stakeholder";
COMMENT ON POLICY "Stakeholder_member_only" ON "Stakeholder" IS
  'R4-A · Mantiene policy P18 (ya member_only); elimina duplicada stakeholder_all '
  'open-policy heredada de Wave P11.';

-- ── QualityInspection ──
DROP POLICY IF EXISTS "QualityInspection_all" ON "QualityInspection";
DROP POLICY IF EXISTS "QualityInspection_member_only" ON "QualityInspection";
CREATE POLICY "QualityInspection_member_only" ON "QualityInspection"
  FOR ALL
  USING (app.is_project_member(current_setting('app.user_id', true), "projectId"))
  WITH CHECK (app.is_project_member(current_setting('app.user_id', true), "projectId"));
COMMENT ON POLICY "QualityInspection_member_only" ON "QualityInspection" IS
  'R4-A · Solo miembros del proyecto leen/escriben quality inspections (PMI Quality Mgmt).';

-- ── Defect ──
DROP POLICY IF EXISTS "Defect_all" ON "Defect";
DROP POLICY IF EXISTS "Defect_member_only" ON "Defect";
CREATE POLICY "Defect_member_only" ON "Defect"
  FOR ALL
  USING (app.is_project_member(current_setting('app.user_id', true), "projectId"))
  WITH CHECK (app.is_project_member(current_setting('app.user_id', true), "projectId"));
COMMENT ON POLICY "Defect_member_only" ON "Defect" IS
  'R4-A · Solo miembros del proyecto leen/escriben defects (PMI Quality Mgmt).';

-- ── Stakeholder REINFORCE (no-op si existe) — ya hay member_only, evitamos duplicación.
-- (Stakeholder ya quedó endurecido arriba al eliminar stakeholder_all.)

-- ── BrainInsight ── (tiene projectId directo)
DROP POLICY IF EXISTS "BrainInsight_all" ON "BrainInsight";
DROP POLICY IF EXISTS "BrainInsight_member_only" ON "BrainInsight";
CREATE POLICY "BrainInsight_member_only" ON "BrainInsight"
  FOR ALL
  USING (app.is_project_member(current_setting('app.user_id', true), "projectId"))
  WITH CHECK (app.is_project_member(current_setting('app.user_id', true), "projectId"));
COMMENT ON POLICY "BrainInsight_member_only" ON "BrainInsight" IS
  'R4-A · Insights AI son project-scoped. Solo miembros del proyecto ven sus insights.';

-- ── RiskAction ── (tiene riskId → Risk.projectId · usar subquery)
DROP POLICY IF EXISTS "RiskAction_all" ON "RiskAction";
DROP POLICY IF EXISTS "RiskAction_member_only" ON "RiskAction";
CREATE POLICY "RiskAction_member_only" ON "RiskAction"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Risk" r
      WHERE r.id = "RiskAction"."riskId"
        AND app.is_project_member(current_setting('app.user_id', true), r."projectId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Risk" r
      WHERE r.id = "RiskAction"."riskId"
        AND app.is_project_member(current_setting('app.user_id', true), r."projectId")
    )
  );
COMMENT ON POLICY "RiskAction_member_only" ON "RiskAction" IS
  'R4-A · RiskAction no tiene projectId directo; hereda visibilidad de Risk via subquery.';

-- ── Release ──
DROP POLICY IF EXISTS "Release_all_authenticated" ON "Release";
DROP POLICY IF EXISTS "Release_member_only" ON "Release";
CREATE POLICY "Release_member_only" ON "Release"
  FOR ALL
  USING (app.is_project_member(current_setting('app.user_id', true), "projectId"))
  WITH CHECK (app.is_project_member(current_setting('app.user_id', true), "projectId"));
COMMENT ON POLICY "Release_member_only" ON "Release" IS
  'R4-A · Releases pertenecen a un proyecto. Solo miembros visualizan/editan.';

-- ── Retrospective ── (FK a Sprint.projectId · subquery)
DROP POLICY IF EXISTS "Retrospective_all_authenticated" ON "Retrospective";
DROP POLICY IF EXISTS "Retrospective_member_only" ON "Retrospective";
CREATE POLICY "Retrospective_member_only" ON "Retrospective"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Sprint" s
      WHERE s.id = "Retrospective"."sprintId"
        AND app.is_project_member(current_setting('app.user_id', true), s."projectId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Sprint" s
      WHERE s.id = "Retrospective"."sprintId"
        AND app.is_project_member(current_setting('app.user_id', true), s."projectId")
    )
  );
COMMENT ON POLICY "Retrospective_member_only" ON "Retrospective" IS
  'R4-A · Retrospective no tiene projectId directo; hereda de Sprint via subquery.';

-- ── ReleaseEpic ── (M2M · ambos lados con FK transitiva)
DROP POLICY IF EXISTS "ReleaseEpic_all_authenticated" ON "ReleaseEpic";
DROP POLICY IF EXISTS "ReleaseEpic_member_only" ON "ReleaseEpic";
CREATE POLICY "ReleaseEpic_member_only" ON "ReleaseEpic"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Release" r
      WHERE r.id = "ReleaseEpic"."releaseId"
        AND app.is_project_member(current_setting('app.user_id', true), r."projectId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Release" r
      WHERE r.id = "ReleaseEpic"."releaseId"
        AND app.is_project_member(current_setting('app.user_id', true), r."projectId")
    )
  );
COMMENT ON POLICY "ReleaseEpic_member_only" ON "ReleaseEpic" IS
  'R4-A · M2M Release↔Epic. Hereda de Release.projectId via subquery. '
  'No validamos Epic.projectId porque Release y Epic deben pertenecer al mismo proyecto (validado en server action).';

-- ── ReleaseSprint ── (M2M)
DROP POLICY IF EXISTS "ReleaseSprint_all_authenticated" ON "ReleaseSprint";
DROP POLICY IF EXISTS "ReleaseSprint_member_only" ON "ReleaseSprint";
CREATE POLICY "ReleaseSprint_member_only" ON "ReleaseSprint"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Release" r
      WHERE r.id = "ReleaseSprint"."releaseId"
        AND app.is_project_member(current_setting('app.user_id', true), r."projectId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Release" r
      WHERE r.id = "ReleaseSprint"."releaseId"
        AND app.is_project_member(current_setting('app.user_id', true), r."projectId")
    )
  );
COMMENT ON POLICY "ReleaseSprint_member_only" ON "ReleaseSprint" IS
  'R4-A · M2M Release↔Sprint. Hereda de Release.projectId via subquery.';

-- ── TeamProject ── (M2M Team↔Project; usar projectId directo de la fila)
DROP POLICY IF EXISTS "TeamProject_all" ON "TeamProject";
DROP POLICY IF EXISTS "TeamProject_member_only" ON "TeamProject";
CREATE POLICY "TeamProject_member_only" ON "TeamProject"
  FOR ALL
  USING (app.is_project_member(current_setting('app.user_id', true), "projectId"))
  WITH CHECK (app.is_project_member(current_setting('app.user_id', true), "projectId"));
COMMENT ON POLICY "TeamProject_member_only" ON "TeamProject" IS
  'R4-A · M2M Team↔Project. Solo miembros del proyecto pueden listar/asignar equipos.';

-- ── CrossProjectDependency ── (ambos lados son tasks; visibility = acceso a CUALQUIERA de los proyectos)
DROP POLICY IF EXISTS "cross_project_dep_all" ON "CrossProjectDependency";
DROP POLICY IF EXISTS "CrossProjectDependency_member_only" ON "CrossProjectDependency";
CREATE POLICY "CrossProjectDependency_member_only" ON "CrossProjectDependency"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Task" t
      WHERE t.id = "CrossProjectDependency"."sourceTaskId"
        AND app.is_project_member(current_setting('app.user_id', true), t."projectId")
    )
    OR EXISTS (
      SELECT 1 FROM "Task" t
      WHERE t.id = "CrossProjectDependency"."targetTaskId"
        AND app.is_project_member(current_setting('app.user_id', true), t."projectId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Task" t
      WHERE t.id = "CrossProjectDependency"."sourceTaskId"
        AND app.is_project_member(current_setting('app.user_id', true), t."projectId")
    )
    AND EXISTS (
      SELECT 1 FROM "Task" t
      WHERE t.id = "CrossProjectDependency"."targetTaskId"
        AND app.is_project_member(current_setting('app.user_id', true), t."projectId")
    )
  );
COMMENT ON POLICY "CrossProjectDependency_member_only" ON "CrossProjectDependency" IS
  'R4-A · Lectura: acceso a source O target permite ver la dependencia (visibilidad cross-project). '
  'Escritura: requiere acceso a AMBOS proyectos (evita crear deps unilaterales).';

-- ── Contract ── (projectId nullable · si NULL solo workspace owner; si NOT NULL → is_project_member)
DROP POLICY IF EXISTS "contract_all" ON "Contract";
DROP POLICY IF EXISTS "Contract_member_only" ON "Contract";
CREATE POLICY "Contract_member_only" ON "Contract"
  FOR ALL
  USING (
    (
      "projectId" IS NOT NULL
      AND app.is_project_member(current_setting('app.user_id', true), "projectId")
    )
    OR (
      "projectId" IS NULL
      AND EXISTS (
        SELECT 1 FROM "Vendor" v
        WHERE v.id = "Contract"."vendorId"
          AND app.is_workspace_member(current_setting('app.user_id', true), v."workspaceId")
      )
    )
  )
  WITH CHECK (
    (
      "projectId" IS NOT NULL
      AND app.is_project_member(current_setting('app.user_id', true), "projectId")
    )
    OR (
      "projectId" IS NULL
      AND EXISTS (
        SELECT 1 FROM "Vendor" v
        WHERE v.id = "Contract"."vendorId"
          AND app.is_workspace_member(current_setting('app.user_id', true), v."workspaceId")
      )
    )
  );
COMMENT ON POLICY "Contract_member_only" ON "Contract" IS
  'R4-A · Contract.projectId opcional. Si NOT NULL → miembros del proyecto. '
  'Si NULL → contrato workspace-level via Vendor.workspaceId (procurement compartido).';

-- ── PurchaseOrder ── (mismo patrón que Contract)
DROP POLICY IF EXISTS "po_all" ON "PurchaseOrder";
DROP POLICY IF EXISTS "PurchaseOrder_member_only" ON "PurchaseOrder";
CREATE POLICY "PurchaseOrder_member_only" ON "PurchaseOrder"
  FOR ALL
  USING (
    (
      "projectId" IS NOT NULL
      AND app.is_project_member(current_setting('app.user_id', true), "projectId")
    )
    OR (
      "projectId" IS NULL
      AND EXISTS (
        SELECT 1 FROM "Vendor" v
        WHERE v.id = "PurchaseOrder"."vendorId"
          AND app.is_workspace_member(current_setting('app.user_id', true), v."workspaceId")
      )
    )
  )
  WITH CHECK (
    (
      "projectId" IS NOT NULL
      AND app.is_project_member(current_setting('app.user_id', true), "projectId")
    )
    OR (
      "projectId" IS NULL
      AND EXISTS (
        SELECT 1 FROM "Vendor" v
        WHERE v.id = "PurchaseOrder"."vendorId"
          AND app.is_workspace_member(current_setting('app.user_id', true), v."workspaceId")
      )
    )
  );
COMMENT ON POLICY "PurchaseOrder_member_only" ON "PurchaseOrder" IS
  'R4-A · Mismo patrón que Contract: projectId opcional, vendor workspace como fallback.';


-- ═════════════════════════════════════════════════════════════════════
-- GRUPO B · Tablas workspace-scoped (sin projectId)
-- ═════════════════════════════════════════════════════════════════════

-- ── Vendor ── (workspaceId opcional · NULL = catálogo global solo ADMIN)
DROP POLICY IF EXISTS "vendor_all" ON "Vendor";
DROP POLICY IF EXISTS "Vendor_workspace_member" ON "Vendor";
CREATE POLICY "Vendor_workspace_member" ON "Vendor"
  FOR ALL
  USING (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"))
  WITH CHECK (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"));
COMMENT ON POLICY "Vendor_workspace_member" ON "Vendor" IS
  'R4-A · Catálogo procurement workspace-scoped. workspaceId NULL = global solo para ADMIN/SUPER_ADMIN.';

-- ── GlobalTemplate ──
DROP POLICY IF EXISTS "GlobalTemplate_all" ON "GlobalTemplate";
DROP POLICY IF EXISTS "GlobalTemplate_workspace_member" ON "GlobalTemplate";
CREATE POLICY "GlobalTemplate_workspace_member" ON "GlobalTemplate"
  FOR ALL
  USING (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"))
  WITH CHECK (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"));
COMMENT ON POLICY "GlobalTemplate_workspace_member" ON "GlobalTemplate" IS
  'R4-A · Catálogo plantillas (PROJECT/WBS/DOR_DOD/COMM_PLAN). '
  'workspaceId NULL = catálogo SUPER_ADMIN global; cloned-to-workspace usa workspaceId set.';

-- ── AutoPilotRun ── (workspaceId NOT NULL en schema)
DROP POLICY IF EXISTS "AutoPilotRun_all" ON "AutoPilotRun";
DROP POLICY IF EXISTS "AutoPilotRun_workspace_member" ON "AutoPilotRun";
CREATE POLICY "AutoPilotRun_workspace_member" ON "AutoPilotRun"
  FOR ALL
  USING (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"))
  WITH CHECK (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"));
COMMENT ON POLICY "AutoPilotRun_workspace_member" ON "AutoPilotRun" IS
  'R4-A · AutoPilot runs son workspace-scoped (snapshot decisiones IA del workspace).';

-- ── BrainStrategistInsight ──  (workspaceId nullable)
DROP POLICY IF EXISTS "BrainStrategistInsight_all" ON "BrainStrategistInsight";
DROP POLICY IF EXISTS "BrainStrategistInsight_workspace_member" ON "BrainStrategistInsight";
CREATE POLICY "BrainStrategistInsight_workspace_member" ON "BrainStrategistInsight"
  FOR ALL
  USING (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"))
  WITH CHECK (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"));
COMMENT ON POLICY "BrainStrategistInsight_workspace_member" ON "BrainStrategistInsight" IS
  'R4-A · Insights cross-project workspace-scoped. workspaceId NULL = global solo ADMIN.';

-- ── AuditStreamTarget ──
DROP POLICY IF EXISTS "AuditStreamTarget_all" ON "AuditStreamTarget";
DROP POLICY IF EXISTS "AuditStreamTarget_workspace_member" ON "AuditStreamTarget";
CREATE POLICY "AuditStreamTarget_workspace_member" ON "AuditStreamTarget"
  FOR ALL
  USING (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"))
  WITH CHECK (app.is_workspace_member(current_setting('app.user_id', true), "workspaceId"));
COMMENT ON POLICY "AuditStreamTarget_workspace_member" ON "AuditStreamTarget" IS
  'R4-A · Endpoints SIEM workspace-scoped. Solo workspace owner/admin pueden listar/editar.';

-- ── AuditStreamDelivery ── (FK a AuditStreamTarget · subquery)
DROP POLICY IF EXISTS "AuditStreamDelivery_all" ON "AuditStreamDelivery";
DROP POLICY IF EXISTS "AuditStreamDelivery_workspace_member" ON "AuditStreamDelivery";
CREATE POLICY "AuditStreamDelivery_workspace_member" ON "AuditStreamDelivery"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "AuditStreamTarget" t
      WHERE t.id = "AuditStreamDelivery"."targetId"
        AND app.is_workspace_member(current_setting('app.user_id', true), t."workspaceId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "AuditStreamTarget" t
      WHERE t.id = "AuditStreamDelivery"."targetId"
        AND app.is_workspace_member(current_setting('app.user_id', true), t."workspaceId")
    )
  );
COMMENT ON POLICY "AuditStreamDelivery_workspace_member" ON "AuditStreamDelivery" IS
  'R4-A · Ledger de entregas SIEM. Hereda visibilidad de AuditStreamTarget via subquery. '
  'NOTA: el cron audit-stream usa service_role (BYPASSRLS) y no se ve afectado.';


-- ═════════════════════════════════════════════════════════════════════
-- GRUPO C · Tablas user-scoped (owner del recurso)
-- ═════════════════════════════════════════════════════════════════════

-- ── UserAvailability ── (vinculada a un usuario; el propio user + ADMIN ven)
DROP POLICY IF EXISTS "user_availability_all" ON "UserAvailability";
DROP POLICY IF EXISTS "UserAvailability_owner_only" ON "UserAvailability";
CREATE POLICY "UserAvailability_owner_only" ON "UserAvailability"
  FOR ALL
  USING (
    "userId" = current_setting('app.user_id', true)
    OR EXISTS (
      SELECT 1 FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = current_setting('app.user_id', true)
        AND r.name IN ('ADMIN', 'SUPER_ADMIN', 'GERENCIA_GENERAL')
    )
  )
  WITH CHECK (
    "userId" = current_setting('app.user_id', true)
    OR EXISTS (
      SELECT 1 FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = current_setting('app.user_id', true)
        AND r.name IN ('ADMIN', 'SUPER_ADMIN', 'GERENCIA_GENERAL')
    )
  );
COMMENT ON POLICY "UserAvailability_owner_only" ON "UserAvailability" IS
  'R4-A · UserAvailability es PII (vacaciones, sick days). Solo el propio user + ADMIN/SUPER_ADMIN/GERENCIA_GENERAL leen/escriben.';

-- ── ResourceAllocationSnapshot ── (snapshot por usuario; mismo patrón que UserAvailability)
DROP POLICY IF EXISTS "resource_allocation_all" ON "ResourceAllocationSnapshot";
DROP POLICY IF EXISTS "ResourceAllocationSnapshot_visible" ON "ResourceAllocationSnapshot";
CREATE POLICY "ResourceAllocationSnapshot_visible" ON "ResourceAllocationSnapshot"
  FOR ALL
  USING (
    "userId" = current_setting('app.user_id', true)
    OR EXISTS (
      SELECT 1 FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = current_setting('app.user_id', true)
        AND r.name IN ('ADMIN', 'SUPER_ADMIN', 'GERENCIA_GENERAL', 'GERENTE_AREA')
    )
  )
  WITH CHECK (
    "userId" = current_setting('app.user_id', true)
    OR EXISTS (
      SELECT 1 FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = current_setting('app.user_id', true)
        AND r.name IN ('ADMIN', 'SUPER_ADMIN', 'GERENCIA_GENERAL', 'GERENTE_AREA')
    )
  );
COMMENT ON POLICY "ResourceAllocationSnapshot_visible" ON "ResourceAllocationSnapshot" IS
  'R4-A · Heatmap allocation. Propio usuario + roles managers (ADMIN/SUPER_ADMIN/GERENCIA_GENERAL/GERENTE_AREA) leen.';


-- ═════════════════════════════════════════════════════════════════════
-- GRUPO D · OKRs (Goal/KeyResult/_KeyResultTasks · projectId opcional)
-- ═════════════════════════════════════════════════════════════════════

-- ── Goal ── (projectId nullable · Goal corporativo = owner only; Goal con projectId = is_project_member)
DROP POLICY IF EXISTS "Goal_all" ON "Goal";
DROP POLICY IF EXISTS "Goal_owner_or_member" ON "Goal";
CREATE POLICY "Goal_owner_or_member" ON "Goal"
  FOR ALL
  USING (
    "ownerId" = current_setting('app.user_id', true)
    OR (
      "projectId" IS NOT NULL
      AND app.is_project_member(current_setting('app.user_id', true), "projectId")
    )
    OR (
      "projectId" IS NULL
      AND EXISTS (
        SELECT 1 FROM "UserRole" ur
        JOIN "Role" r ON r.id = ur."roleId"
        WHERE ur."userId" = current_setting('app.user_id', true)
          AND r.name IN ('ADMIN', 'SUPER_ADMIN', 'GERENCIA_GENERAL')
      )
    )
  )
  WITH CHECK (
    "ownerId" = current_setting('app.user_id', true)
    OR (
      "projectId" IS NOT NULL
      AND app.is_project_member(current_setting('app.user_id', true), "projectId")
    )
    OR EXISTS (
      SELECT 1 FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId"
      WHERE ur."userId" = current_setting('app.user_id', true)
        AND r.name IN ('ADMIN', 'SUPER_ADMIN')
    )
  );
COMMENT ON POLICY "Goal_owner_or_member" ON "Goal" IS
  'R4-A · Goal con projectId → miembros del proyecto. Goal corporativo (projectId NULL) → owner + ADMIN/SUPER_ADMIN/GERENCIA_GENERAL.';

-- ── KeyResult ── (FK Goal · misma policy heredada)
DROP POLICY IF EXISTS "KeyResult_all" ON "KeyResult";
DROP POLICY IF EXISTS "KeyResult_inherit_goal" ON "KeyResult";
CREATE POLICY "KeyResult_inherit_goal" ON "KeyResult"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM "Goal" g
      WHERE g.id = "KeyResult"."goalId"
        AND (
          g."ownerId" = current_setting('app.user_id', true)
          OR (
            g."projectId" IS NOT NULL
            AND app.is_project_member(current_setting('app.user_id', true), g."projectId")
          )
          OR (
            g."projectId" IS NULL
            AND EXISTS (
              SELECT 1 FROM "UserRole" ur
              JOIN "Role" r ON r.id = ur."roleId"
              WHERE ur."userId" = current_setting('app.user_id', true)
                AND r.name IN ('ADMIN', 'SUPER_ADMIN', 'GERENCIA_GENERAL')
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Goal" g
      WHERE g.id = "KeyResult"."goalId"
        AND (
          g."ownerId" = current_setting('app.user_id', true)
          OR (
            g."projectId" IS NOT NULL
            AND app.is_project_member(current_setting('app.user_id', true), g."projectId")
          )
        )
    )
  );
COMMENT ON POLICY "KeyResult_inherit_goal" ON "KeyResult" IS
  'R4-A · Hereda visibilidad de Goal via subquery (Goal corporativo o project-scoped).';

-- ── _KeyResultTasks ── (M2M Prisma · A=KeyResultId, B=TaskId)
DROP POLICY IF EXISTS "_KeyResultTasks_all" ON "_KeyResultTasks";
DROP POLICY IF EXISTS "_KeyResultTasks_inherit" ON "_KeyResultTasks";
CREATE POLICY "_KeyResultTasks_inherit" ON "_KeyResultTasks"
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM "KeyResult" kr
      JOIN "Goal" g ON g.id = kr."goalId"
      WHERE kr.id = "_KeyResultTasks"."A"
        AND (
          g."ownerId" = current_setting('app.user_id', true)
          OR (
            g."projectId" IS NOT NULL
            AND app.is_project_member(current_setting('app.user_id', true), g."projectId")
          )
        )
    )
    AND EXISTS (
      SELECT 1 FROM "Task" t
      WHERE t.id = "_KeyResultTasks"."B"
        AND app.is_project_member(current_setting('app.user_id', true), t."projectId")
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM "KeyResult" kr
      JOIN "Goal" g ON g.id = kr."goalId"
      WHERE kr.id = "_KeyResultTasks"."A"
        AND (
          g."ownerId" = current_setting('app.user_id', true)
          OR (
            g."projectId" IS NOT NULL
            AND app.is_project_member(current_setting('app.user_id', true), g."projectId")
          )
        )
    )
    AND EXISTS (
      SELECT 1 FROM "Task" t
      WHERE t.id = "_KeyResultTasks"."B"
        AND app.is_project_member(current_setting('app.user_id', true), t."projectId")
    )
  );
COMMENT ON POLICY "_KeyResultTasks_inherit" ON "_KeyResultTasks" IS
  'R4-A · M2M Prisma KeyResult↔Task. Requiere acceso a AMBOS extremos (KR via Goal y Task via projectId).';


-- ═════════════════════════════════════════════════════════════════════
-- FIN · ~20 tablas endurecidas.
-- Verificación post-merge via MCP:
--   SELECT tablename, policyname, qual FROM pg_policies
--   WHERE schemaname='public' AND qual ~ 'is_project_member|is_workspace_member';
-- ═════════════════════════════════════════════════════════════════════
