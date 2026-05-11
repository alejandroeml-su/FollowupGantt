# RLS Hardening Completo · Equipo R4-A

**Wave:** R4 · Fase 1 · 2026-05-11
**Owner:** Equipo R4-A
**Estado:** Migraciones escritas · pendiente aplicar via MCP `apply_migration` tras merge

---

## 1. Objetivo

Cerrar los advisors `rls_policy_always_true` (~24 WARN), `rls_enabled_no_policy` (5 INFO) y `function_search_path_mutable` (1 WARN) detectados por Supabase advisors tras R3.0 GA.

Tras Wave P18 (R2.0 GA · activación incremental de RLS restrictivas en 7 tablas), quedaron otras 24 tablas con la open-policy heredada `USING (true) WITH CHECK (true)` que solo cumple "RLS habilitado" sintácticamente pero no aporta defensa real. R4-A las endurece todas a `app.is_project_member(...)` o `app.is_workspace_member(...)`.

---

## 2. Pre-condiciones operativas

### 2.1 Helper `withRlsContextFromSession`

Las server actions de TODAS las tablas endurecidas DEBEN envolverse con `withRlsContextFromSession()` (de `src/lib/db/with-rls-context.ts`) para que `current_setting('app.user_id', true)` esté seteado durante la transacción. Sin eso las queries devuelven 0 filas (fail-safe).

**Archivos ya validados R2.0 GA (Wave P18 hardening):**
- `src/lib/actions/change-requests.ts`
- `src/lib/actions/stakeholders.ts`
- `src/lib/actions/impediments.ts`
- `src/lib/actions/daily-scrum.ts`
- `src/lib/actions/evm-snapshots.ts`
- `src/lib/actions/lessons.ts`
- `src/lib/actions/improvements.ts`

**Archivos a auditar como deuda menor (R4-A no los toca, solo endurece RLS):**
- `src/lib/actions/risks.ts` y `risk-actions.ts` (Risk + RiskAction)
- `src/lib/actions/quality-inspections.ts` (QualityInspection + Defect)
- `src/lib/actions/releases.ts` (Release + ReleaseEpic + ReleaseSprint)
- `src/lib/actions/retrospectives.ts` (Retrospective)
- `src/lib/actions/cross-project-deps.ts` (CrossProjectDependency)
- `src/lib/actions/contracts.ts`, `purchase-orders.ts`, `vendors.ts` (procurement)
- `src/lib/actions/global-templates.ts` (GlobalTemplate)
- `src/lib/actions/auto-pilot.ts` (AutoPilotRun)
- `src/lib/actions/brain/strategist.ts` (BrainStrategistInsight)
- `src/lib/actions/brain/insights.ts` (BrainInsight)
- `src/lib/actions/audit-streaming.ts` (AuditStreamTarget + AuditStreamDelivery)
- `src/lib/actions/availability.ts` (UserAvailability)
- `src/lib/actions/portfolio-allocation.ts` (ResourceAllocationSnapshot)
- `src/lib/actions/goals.ts`, `key-results.ts` (OKRs)
- `src/lib/actions/team-projects.ts` (TeamProject)
- `src/lib/actions/calendar-sync.ts` (CalendarConnection + CalendarEvent)
- `src/lib/actions/expenses.ts` (Expense)
- `src/lib/actions/epics.ts` (Epic — consolidación de 4 policies)

Esta auditoría se delega a equipos R4-B…R4-E como deuda observable post-merge (no bloqueante porque el backend usa **service_role con BYPASSRLS**: las queries siguen funcionando incluso si la action no envuelve con `withRlsContext`, simplemente no se beneficia del fail-safe).

### 2.2 Cron jobs y background workers

El cron `/api/cron/audit-stream` y demás workers usan el cliente Prisma global (service_role / postgres role con BYPASSRLS). **No se ven afectados** por estas policies porque el bypass es a nivel de rol, no de policy. Documentado explícitamente en los COMMENT ON POLICY de `AuditStreamDelivery_workspace_member`.

### 2.3 Pre-checks antes de aplicar la migración via MCP

```sql
-- Verificar que el helper P14d existe (debería · es de hace semanas):
SELECT proname, prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app' AND proname IN ('is_project_member', 'is_workspace_member');

-- Verificar que no hay sesiones con transacciones largas que puedan
-- bloquear los DROP POLICY (raro pero posible si cron está corriendo):
SELECT pid, query_start, state, query
FROM pg_stat_activity
WHERE state <> 'idle' AND query_start < now() - interval '5 minutes';
```

---

## 3. Migraciones (3 archivos · orden importante)

| Orden | Archivo | Función |
|---|---|---|
| 1 | `20260511_r4a_app_is_project_member_search_path` | Recrea `app.is_project_member` con `SET search_path = pg_catalog, public` (cierra `function_search_path_mutable`). Añade nuevo helper `app.is_workspace_member`. |
| 2 | `20260511_r4a_rls_hardening_complete` | Reemplaza open-policy `USING(true)` por `<Tabla>_member_only` o `_workspace_member` en ~20 tablas (cierra `rls_policy_always_true`). |
| 3 | `20260511_r4a_legacy_no_policy_tables` | Crea policies explícitas en 5 tablas legacy con RLS enabled + 0 policies (cierra `rls_enabled_no_policy`). |

**Aplicar siempre en orden:** la #2 y #3 dependen de los helpers definidos en #1.

---

## 4. Tablas endurecidas

### 4.1 Grupo A · project-scoped (`projectId` directo o transitivo)

| Tabla | Política aplicada | Justificación |
|---|---|---|
| `Epic` | `Epic_member_only` FOR ALL | Consolida 4 policies SELECT/INSERT/UPDATE/DELETE abiertas en una sola. ADMIN bypass natural. |
| `ChangeRequest` | `ChangeRequest_member_only` (existente P18) | Elimina duplicada `change_request_all` open. |
| `Stakeholder` | `Stakeholder_member_only` (existente P18) | Elimina duplicada `stakeholder_all` open. |
| `QualityInspection` | `_member_only` via `projectId` | PMI Quality Mgmt — sensible. |
| `Defect` | `_member_only` via `projectId` | PMI Quality Mgmt. |
| `BrainInsight` | `_member_only` via `projectId` | Insights AI son project-scoped. |
| `RiskAction` | `_member_only` via subquery a `Risk.projectId` | RiskAction no tiene projectId directo. |
| `Release` | `_member_only` via `projectId` | Versionado del proyecto. |
| `Retrospective` | `_member_only` via subquery a `Sprint.projectId` | Sin projectId directo. |
| `ReleaseEpic` | `_member_only` via subquery a `Release.projectId` | M2M. |
| `ReleaseSprint` | `_member_only` via subquery a `Release.projectId` | M2M. |
| `TeamProject` | `_member_only` via `projectId` | M2M Team↔Project. |
| `CrossProjectDependency` | `_member_only` via subquery a ambas Tasks | READ: acceso a source OR target; WRITE: AMBOS proyectos. |
| `Contract` | `_member_only` con fallback workspace via Vendor | `projectId` opcional. |
| `PurchaseOrder` | `_member_only` con fallback workspace via Vendor | `projectId` opcional. |

### 4.2 Grupo B · workspace-scoped (sin `projectId`)

| Tabla | Política | Justificación |
|---|---|---|
| `Vendor` | `Vendor_workspace_member` | Catálogo procurement. `workspaceId` NULL = global → solo ADMIN. |
| `GlobalTemplate` | `_workspace_member` | Catálogo plantillas; NULL workspaceId = catálogo SUPER_ADMIN. |
| `AutoPilotRun` | `_workspace_member` via `workspaceId` | Snapshot decisiones IA. |
| `BrainStrategistInsight` | `_workspace_member` | Cross-project insights. `workspaceId` NULL = global → solo ADMIN. |
| `AuditStreamTarget` | `_workspace_member` | Endpoints SIEM. |
| `AuditStreamDelivery` | `_workspace_member` via subquery a `AuditStreamTarget` | Ledger SIEM. Cron usa service_role. |

### 4.3 Grupo C · user-scoped (PII / owner)

| Tabla | Política | Justificación |
|---|---|---|
| `UserAvailability` | `_owner_only` (userId + ADMIN/SUPER_ADMIN/GERENCIA_GENERAL) | Vacaciones/sick days son PII. |
| `ResourceAllocationSnapshot` | `_visible` (userId + roles managers) | Heatmap allocation managers ven todo el equipo. |

### 4.4 Grupo D · OKRs

| Tabla | Política | Justificación |
|---|---|---|
| `Goal` | `_owner_or_member` | Si `projectId` IS NOT NULL → is_project_member. Si NULL (corporativo) → owner + roles directivos. |
| `KeyResult` | `_inherit_goal` | Hereda visibilidad de Goal via subquery. |
| `_KeyResultTasks` | `_inherit` | M2M Prisma. Requiere acceso a AMBOS lados (KR via Goal + Task via projectId). |

### 4.5 Grupo E · legacy sin policies (migración 3)

| Tabla | Scope | Política aplicada |
|---|---|---|
| `WorkCalendar` | Global metadata | SELECT autenticado · ALL solo ADMIN. |
| `Holiday` | Global metadata | SELECT autenticado · ALL solo ADMIN. |
| `CalendarConnection` | STRICT user-owned (OAuth tokens · privacy) | Solo el dueño. **Ni siquiera ADMIN puede ver tokens externos de otros.** |
| `CalendarEvent` | Hereda de CalendarConnection | Ledger sync user-owned. |
| `Expense` | Project-scoped + submitter | Submitter siempre ve su gasto + miembros proyecto leen/aprueban. |

---

## 5. Tablas dejadas con open-policy intencional

**Ninguna** en esta wave. Todas las tablas listadas en advisors fueron endurecidas o documentadas como STRICT (CalendarConnection). Si en el futuro aparecen advisors para tablas no documentadas aquí, evaluar siguiendo el patrón:

1. ¿Tiene `projectId` directo? → `app.is_project_member`.
2. ¿FK transitiva a un Task/Sprint/Release? → subquery con `app.is_project_member`.
3. ¿Es workspace-level? → `app.is_workspace_member`.
4. ¿Es user-owned? → `userId = current_setting('app.user_id', true)`.
5. ¿Catálogo global (Role, Gerencia, …)? → SELECT autenticado + ALL ADMIN.

---

## 6. Función `app.is_project_member` (hardening)

### 6.1 Cambio aplicado

```sql
CREATE OR REPLACE FUNCTION app.is_project_member(...)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public   -- ← NUEVO
AS $$ ... $$;
```

### 6.2 Por qué importa

Funciones `SECURITY DEFINER` corren con los privilegios del **owner** de la función (en este caso `postgres`, súper-usuario), no del caller. Sin `SET search_path` fijo, un atacante con permisos para crear schemas y objects puede:

1. Crear un schema malicioso (`CREATE SCHEMA evil`).
2. Definir tablas/funciones con nombres iguales a las usadas en `is_project_member` (ej. una falsa `evil."UserRole"`).
3. Ejecutar `SET search_path = evil, public` antes de invocar la función.
4. La función SECURITY DEFINER ahora resuelve `"UserRole"` contra el schema malicioso → SQL injection / privilege escalation.

`SET search_path = pg_catalog, public` al nivel de la función **fija** el path durante la ejecución, ignorando el `search_path` del caller. Es la mitigación estándar PostgreSQL para CVE-style attacks en funciones SECURITY DEFINER.

Mismo tratamiento se aplica al nuevo helper `app.is_workspace_member`.

---

## 7. Helper nuevo · `app.is_workspace_member`

Añadido en R4-A porque ~7 tablas son workspace-scoped (no project-scoped) y no existía función paralela. Misma jerarquía RBAC P13:

- `ADMIN`/`SUPER_ADMIN` → TRUE (bypass total).
- `workspaceId IS NULL` → solo ADMIN/SUPER_ADMIN.
- `GERENCIA_GENERAL` + `WorkspaceMember` → TRUE.
- `Workspace.ownerId = user_id` → TRUE.
- `WorkspaceMember.userId = user_id AND .workspaceId = p_workspace_id` → TRUE.

Marcada `SECURITY DEFINER · STABLE · SET search_path = pg_catalog, public`.

---

## 8. Setup pendiente

Tras merge del PR R4-A, aplicar las 3 migraciones via MCP `apply_migration` **en orden**:

1. `20260511_r4a_app_is_project_member_search_path`
2. `20260511_r4a_rls_hardening_complete`
3. `20260511_r4a_legacy_no_policy_tables`

Luego validar con MCP `get_advisors(type: 'security')`:

- `function_search_path_mutable` debería bajar a 0.
- `rls_policy_always_true` debería bajar de ~24 a 0.
- `rls_enabled_no_policy` debería bajar de 5 a 0.

Si aparecen nuevos advisors INFO (`rls_init_plan` por subqueries con `current_setting`), es esperado: la optimización per-row vs per-query es trade-off conocido en Postgres RLS. Documentar como deuda performance R4 sin bloqueo.

---

## 9. Test plan (manual post-merge)

1. **Login como USER simple** (sin rol ADMIN), verificar:
   - GET `/api/v2/odata/Epic` solo devuelve Epics de proyectos donde el user es miembro.
   - GET `/api/v2/odata/Vendor` solo devuelve vendors del workspace activo.
   - GET de UserAvailability propia funciona; UserAvailability de otro user devuelve 0.

2. **Login como ADMIN**, verificar bypass:
   - GET de cualquier Epic, Vendor, GlobalTemplate global, Expense → todos visibles.

3. **Probar GlobalTemplate `workspaceId IS NULL`** (catálogo global):
   - USER → 0 filas.
   - SUPER_ADMIN → visible.

4. **Validar cron audit-stream** sigue funcionando (es service_role, debe ignorar RLS).

5. **Validar `CalendarConnection`**: incluso ADMIN no debe poder leer tokens de otro user.

---

## 10. Histórico

| Wave | Fecha | Migración | Tablas endurecidas |
|---|---|---|---|
| P5 | 2026-05-04 | `20260504_rls_policies` | 56 tablas iniciales (open-policy + auth.uid()) |
| P14d | 2026-05-09 | `20260509_p14d_rls_is_project_member` | Helper `app.is_project_member` (sin SET search_path) |
| P18 | 2026-05-10 | `20260510_p18_rls_activate_*` (7 archivos) | ChangeRequest, Stakeholder, Impediment, DailyScrum, EVMSnapshot, ImprovementItem, LessonLearned |
| Legacy OKRs | 2026-05-11 | `20260511_rls_legacy_goals_keyresult` | Goal, KeyResult, _KeyResultTasks (open-policy de cierre) |
| **R4-A** | **2026-05-11** | **`20260511_r4a_*` (3 archivos)** | **~28 tablas + 1 helper hardened + 1 helper nuevo** |
