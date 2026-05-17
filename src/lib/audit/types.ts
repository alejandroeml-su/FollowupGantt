/**
 * Ola P3 · Equipo P3-2 · Audit Log centralizado.
 *
 * Tipos y catálogos compartidos por:
 *   - `events.ts` (helper `recordAuditEvent`)
 *   - `with-audit.ts` (HOF wrapper para server actions)
 *   - `actions/audit.ts` (queryEvents, purgeOld)
 *   - `app/audit-log/page.tsx` y componentes cliente
 *
 * Catálogo de `action` ↑ es centralizado aquí (no en Prisma como enum) para
 * poder extenderlo sin migración de schema. La validación zod usa
 * `KNOWN_AUDIT_ACTIONS` como `z.enum(...)` en el helper.
 */

// ───────────────────────── Catálogo de acciones ─────────────────────────

/**
 * Verbs auditados en P3-2. Convención: `<entityType>.<verb>` en snake_case.
 * Si necesitas auditar algo nuevo, primero añadelo aquí (y a la tabla
 * `ACTION_LABELS` para la UI). El helper rechaza acciones fuera del catálogo
 * con `[INVALID_INPUT]` para forzar revisión humana.
 */
export const KNOWN_AUDIT_ACTIONS = [
  // Tareas
  'task.created',
  'task.updated',
  'task.deleted',
  'task.archived',
  'task.unarchived',
  'task.status_changed',
  // Wave P9 · Agile Maturity — asignación de Task a Epic
  'task.epic_assigned',
  'task.epic_unassigned',
  // Wave P9 · Agile Maturity (HU-9.6) — asignación bulk a Sprint
  'task.sprint_assigned',
  'task.sprint_unassigned',
  // Wave P9 · Agile Maturity (HU-9.3) — User Story formal + CAs
  'task.user_story_updated',
  'task.acceptance_criterion_added',
  'task.acceptance_criterion_removed',
  'task.acceptance_criterion_done',
  'task.acceptance_criterion_undone',
  // Dependencias
  'dependency.created',
  'dependency.updated',
  // Baselines / Líneas base
  'baseline.captured',
  // Proyectos
  'project.created',
  'project.deleted',
  // Wave P9 · Agile Maturity — Epic CRUD
  'epic.created',
  'epic.updated',
  'epic.archived',
  'epic.restored',
  // Wave P9 · Agile Maturity (HU-9.4) — Release CRUD
  'release.created',
  'release.updated',
  'release.released',
  'release.archived',
  'release.scope_updated',
  // Wave P9 R2 (HU-9.8) — DoR/DoD por proyecto
  'project.dor_updated',
  'project.dod_updated',
  // Wave P11-Scrum (HU-11.1) — Product Goal
  'project.product_goal_updated',
  // Wave P11-Scrum (HU-11.2) — Sprint Review
  'sprint.reviewed',
  // Wave P11-PMI (HU-12.1) — Project Charter
  'project.charter_updated',
  'project.charter_approved',
  // Wave P11-PMI (HU-12.2) — Stakeholder Register
  'stakeholder.created',
  'stakeholder.updated',
  'stakeholder.deleted',
  // Wave P11-PMI (HU-12.3) — Change Control Board
  'change_request.submitted',
  'change_request.under_review',
  'change_request.approved',
  'change_request.rejected',
  'change_request.deferred',
  'change_request.implemented',
  // Wave P11-PMI (HU-12.4) — Procurement
  'vendor.created',
  'vendor.deactivated',
  'contract.created',
  'contract.activated',
  'contract.completed',
  'contract.terminated',
  'purchase_order.created',
  'purchase_order.status_changed',
  // Wave P9 R2 (HU-9.9) — Sprint Retrospective
  'retrospective.created',
  'retrospective.item_added',
  'retrospective.item_removed',
  'retrospective.vote_added',
  'retrospective.vote_removed',
  'retrospective.action_item_created',
  'retrospective.completed',
  // Wave P10 (HU-10.2) — User availability
  'user.availability_added',
  'user.availability_updated',
  'user.availability_removed',
  // Wave P10 (HU-10.2) — Holiday bulk import sobre WorkCalendar P1.5
  'calendar.holidays_imported',
  // Wave P10 (HU-10.4) — Cross-project dependencies
  'cross_dependency.created',
  'cross_dependency.updated',
  'cross_dependency.removed',
  // Wave P10 (HU-10.7) — Resource allocation snapshot refresh
  'allocation.snapshot_refreshed',
  // Wave P12 (Scrum 100%) — Impediments
  'impediment.created',
  'impediment.updated',
  'impediment.resolved',
  'impediment.escalated',
  // Wave P12 (Scrum 100%) — Daily Scrum
  'daily_scrum.created',
  'daily_scrum.updated',
  // Wave P12 (Scrum 100%) — Improvement items
  'improvement.created',
  'improvement.updated',
  'improvement.completed',
  // Wave P12 (Scrum 100%) — DoD HARD enforcement
  'project.dod_hard_toggled',
  // Wave P12 (PMI 100%) — Lessons Learned
  'lesson.created',
  'lesson.updated',
  'lesson.deleted',
  // Wave P12 (PMI 100%) — EVM Snapshot
  'evm.snapshot_captured',
  // Wave P12 (PMI 100%) — Communications Plan
  'project.comms_plan_updated',
  // Wave P16-B · Onboarding Kit (auto-seeding al crear proyecto SCRUM/HYBRID)
  'project.onboarding_kit_seeded',
  // Wave P13 (RBAC visibilidad) — Intentos no autorizados
  'access.denied',
  'role.assigned',
  'role.revoked',
  'user.gerencia_assigned',
  // Wave P17-C · Self-Service Admin — CRUD del panel /admin
  'workspace.created',
  'workspace.updated',
  'workspace.archived',
  'gerencia.created',
  'gerencia.updated',
  'gerencia.deleted',
  'area.created',
  'area.updated',
  'area.deleted',
  'user.role_changed',
  'global_template.created',
  'global_template.updated',
  'global_template.deleted',
  'global_template.applied',
  // Usuario / sesión
  'user.login',
  'user.logout',
  'user.password_changed',
  // Import / Export
  'import.completed',
  'export.downloaded',
  // Permisos
  'permission.granted',
  'permission.revoked',
  // Wave R-360 — Risk Register & corrective actions.
  'risk.promoted_from_insight',
  'risk_action.created',
  'risk_action.updated',
  'risk_action.deleted',
  // Wave P18-A — Quality Inspections + Defect Tracking (PMI 100%).
  'inspection.created',
  'inspection.updated',
  'inspection.deleted',
  'defect.created',
  'defect.updated',
  'defect.deleted',
  // R3.0 · Fase 2 — SSO/SAML (R3-D)
  'sso.provider.created',
  'sso.provider.updated',
  'sso.provider.deleted',
  'sso.login.success',
  'sso.login.failed',
  // R3.0-F — Data Retention Policies (Wave R3 Fase 2 · Compliance)
  'retention.policy.updated',
  'retention.purge.run.started',
  'retention.purge.run.completed',
  // R3-E — Audit Streaming a SIEM externos (Splunk / Datadog / generic webhook).
  'audit_stream.target_created',
  'audit_stream.target_updated',
  'audit_stream.target_deleted',
  'audit_stream.target_tested',
  'audit_stream.delivery_retried',
  // Wave P20-C — Brain Auto-Pilot (apply + rollback de proposals)
  'auto_pilot.proposal_applied',
  'auto_pilot.proposal_rolled_back',
  // Wave R3.0 Fase 4 · Equipo P21-B — Tableau Web Data Connector.
  'tableau.dataset_fetched',
  // Wave P21-C — Power BI Native Connector (OData v4 dataset fetch).
  'powerbi.dataset_fetched',
  // R4-D · DocSpace + Real-time co-edit · sesiones de edición colaborativa.
  'doc.realtime_edit_session',
  'whiteboard.realtime_edit_session',
  // Wave R4-E — Monetización SaaS (Stripe checkout/subscription/invoice).
  'billing.checkout_started',
  'billing.subscription_created',
  'billing.subscription_updated',
  'billing.subscription_canceled',
  'billing.invoice_paid',
  'billing.invoice_failed',
  // Support Chatbot flotante (cualquier rol autenticado · in-memory rate limit).
  'support.chat_started',
  'support.chat_message_sent',
  // R4 · US-7.2 Chat View — Canales realtime por proyecto.
  'chat.channel_created',
  'chat.channel_deleted',
  'chat.message_sent',
  'chat.message_edited',
  'chat.message_deleted',
  'chat.reaction_added',
  'chat.reaction_removed',
  // US-7.5 · Proofing — anotaciones sobre attachments multimedia (QA/Diseño).
  'proofing.annotation_created',
  'proofing.annotation_replied',
  'proofing.annotation_resolved',
  'proofing.annotation_reopened',
  'proofing.annotation_changes_requested',
  'proofing.annotation_deleted',
  'proofing.version_created',
  // Wave R5 · US-9.3 — CMDB simplificado (Configuration Items + relaciones).
  'ci.created',
  'ci.updated',
  'ci.retired',
  'ci.deleted',
  'ci.relation_added',
  'ci.relation_removed',
  'ci.task_linked',
  'ci.task_unlinked',
  // US-9.2 · Wave R5 — Gap Analysis (AS-IS vs TO-BE)
  'gap.created',
  'gap.updated',
  'gap.deleted',
  'gap.dimension_recalculated',
  'gap.exported',
] as const

export type AuditAction = (typeof KNOWN_AUDIT_ACTIONS)[number]

/**
 * Etiquetas humanas (es-MX) para la UI. El componente `AuditLogClient`
 * cae a la `action` cruda si no encuentra el label para tolerar acciones
 * legacy o nuevas aún sin etiqueta.
 */
export const ACTION_LABELS: Record<AuditAction, string> = {
  'task.created': 'Tarea creada',
  'task.updated': 'Tarea actualizada',
  'task.deleted': 'Tarea eliminada',
  'task.archived': 'Tarea archivada',
  'task.unarchived': 'Tarea restaurada',
  'task.status_changed': 'Estado de tarea cambiado',
  'task.epic_assigned': 'Tarea asignada a Epic',
  'task.epic_unassigned': 'Tarea desasignada de Epic',
  'task.sprint_assigned': 'Tarea asignada a Sprint',
  'task.sprint_unassigned': 'Tarea movida al backlog',
  'task.user_story_updated': 'Historia de usuario actualizada',
  'task.acceptance_criterion_added': 'Criterio de aceptación agregado',
  'task.acceptance_criterion_removed': 'Criterio de aceptación eliminado',
  'task.acceptance_criterion_done': 'Criterio de aceptación marcado',
  'task.acceptance_criterion_undone': 'Criterio de aceptación desmarcado',
  'dependency.created': 'Dependencia creada',
  'dependency.updated': 'Dependencia actualizada',
  'baseline.captured': 'Línea base capturada',
  'project.created': 'Proyecto creado',
  'project.deleted': 'Proyecto eliminado',
  'epic.created': 'Epic creada',
  'epic.updated': 'Epic actualizada',
  'epic.archived': 'Epic archivada',
  'epic.restored': 'Epic restaurada',
  'release.created': 'Release creada',
  'release.updated': 'Release actualizada',
  'release.released': 'Release liberada',
  'release.archived': 'Release archivada',
  'release.scope_updated': 'Scope de Release actualizado',
  'project.dor_updated': 'Definition of Ready actualizada',
  'project.dod_updated': 'Definition of Done actualizada',
  'project.product_goal_updated': 'Product Goal actualizado',
  'sprint.reviewed': 'Sprint Review cerrado',
  'project.charter_updated': 'Project Charter actualizado',
  'project.charter_approved': 'Project Charter aprobado',
  'stakeholder.created': 'Stakeholder agregado al register',
  'stakeholder.updated': 'Stakeholder actualizado',
  'stakeholder.deleted': 'Stakeholder eliminado',
  'change_request.submitted': 'Change Request enviado',
  'change_request.under_review': 'Change Request en revisión',
  'change_request.approved': 'Change Request aprobado',
  'change_request.rejected': 'Change Request rechazado',
  'change_request.deferred': 'Change Request diferido',
  'change_request.implemented': 'Change Request implementado',
  'vendor.created': 'Vendor agregado al catálogo',
  'vendor.deactivated': 'Vendor desactivado',
  'contract.created': 'Contrato creado',
  'contract.activated': 'Contrato activado',
  'contract.completed': 'Contrato completado',
  'contract.terminated': 'Contrato terminado',
  'purchase_order.created': 'Purchase Order creado',
  'purchase_order.status_changed': 'Purchase Order status cambiado',
  'retrospective.created': 'Retrospectiva creada',
  'retrospective.item_added': 'Item agregado a retro',
  'retrospective.item_removed': 'Item eliminado de retro',
  'retrospective.vote_added': 'Voto agregado en retro',
  'retrospective.vote_removed': 'Voto removido en retro',
  'retrospective.action_item_created': 'Action item creado desde retro',
  'retrospective.completed': 'Retrospectiva cerrada',
  'user.availability_added': 'Disponibilidad de usuario agregada',
  'user.availability_updated': 'Disponibilidad de usuario actualizada',
  'user.availability_removed': 'Disponibilidad de usuario eliminada',
  'calendar.holidays_imported': 'Holidays importados al calendario',
  'cross_dependency.created': 'Dependencia cross-project creada',
  'cross_dependency.updated': 'Dependencia cross-project actualizada',
  'cross_dependency.removed': 'Dependencia cross-project eliminada',
  'allocation.snapshot_refreshed': 'Snapshot de allocation refrescado',
  'impediment.created': 'Impediment registrado',
  'impediment.updated': 'Impediment actualizado',
  'impediment.resolved': 'Impediment resuelto',
  'impediment.escalated': 'Impediment escalado',
  'daily_scrum.created': 'Daily Scrum registrado',
  'daily_scrum.updated': 'Daily Scrum actualizado',
  'improvement.created': 'Improvement creado',
  'improvement.updated': 'Improvement actualizado',
  'improvement.completed': 'Improvement cerrado',
  'project.dod_hard_toggled': 'DoD HARD enforcement cambiado',
  'lesson.created': 'Lesson Learned capturada',
  'lesson.updated': 'Lesson Learned actualizada',
  'lesson.deleted': 'Lesson Learned eliminada',
  'evm.snapshot_captured': 'EVM snapshot capturado',
  'project.comms_plan_updated': 'Communications Plan actualizado',
  'project.onboarding_kit_seeded': 'Onboarding Kit sembrado al crear proyecto',
  'access.denied': 'Intento de acceso denegado',
  'role.assigned': 'Rol asignado a usuario',
  'role.revoked': 'Rol revocado de usuario',
  'user.gerencia_assigned': 'Gerencia asignada al usuario',
  'workspace.created': 'Workspace creado (Admin)',
  'workspace.updated': 'Workspace actualizado (Admin)',
  'workspace.archived': 'Workspace archivado (Admin)',
  'gerencia.created': 'Gerencia creada (Admin)',
  'gerencia.updated': 'Gerencia actualizada (Admin)',
  'gerencia.deleted': 'Gerencia eliminada (Admin)',
  'area.created': 'Área creada (Admin)',
  'area.updated': 'Área actualizada (Admin)',
  'area.deleted': 'Área eliminada (Admin)',
  'user.role_changed': 'Rol de usuario cambiado (Admin)',
  'global_template.created': 'Plantilla global creada',
  'global_template.updated': 'Plantilla global actualizada',
  'global_template.deleted': 'Plantilla global eliminada',
  'global_template.applied': 'Plantilla global aplicada a workspace',
  'user.login': 'Inicio de sesión',
  'user.logout': 'Cierre de sesión',
  'user.password_changed': 'Contraseña cambiada',
  'import.completed': 'Importación completada',
  'export.downloaded': 'Exportación descargada',
  'permission.granted': 'Permiso otorgado',
  'permission.revoked': 'Permiso revocado',
  // Wave R-360
  'risk.promoted_from_insight': 'Riesgo promovido desde insight heurístico',
  'risk_action.created': 'Acción correctiva creada',
  'risk_action.updated': 'Acción correctiva actualizada',
  'risk_action.deleted': 'Acción correctiva eliminada',
  // Wave P18-A
  'inspection.created': 'Inspección de calidad creada',
  'inspection.updated': 'Inspección de calidad actualizada',
  'inspection.deleted': 'Inspección de calidad eliminada',
  'defect.created': 'Defecto reportado',
  'defect.updated': 'Defecto actualizado',
  'defect.deleted': 'Defecto eliminado',
  // R3.0 · Fase 2 — SSO/SAML
  'sso.provider.created': 'Proveedor SSO creado',
  'sso.provider.updated': 'Proveedor SSO actualizado',
  'sso.provider.deleted': 'Proveedor SSO eliminado',
  'sso.login.success': 'Login SSO exitoso',
  'sso.login.failed': 'Login SSO fallido',
  // R3.0-F
  'retention.policy.updated': 'Política de retención actualizada',
  'retention.purge.run.started': 'Ciclo de purge iniciado',
  'retention.purge.run.completed': 'Ciclo de purge completado',
  // R3-E
  'audit_stream.target_created': 'Audit streaming · destino creado',
  'audit_stream.target_updated': 'Audit streaming · destino actualizado',
  'audit_stream.target_deleted': 'Audit streaming · destino eliminado',
  'audit_stream.target_tested': 'Audit streaming · prueba ejecutada',
  'audit_stream.delivery_retried': 'Audit streaming · delivery reintentado',
  // Wave P20-C
  'auto_pilot.proposal_applied': 'Auto-Pilot · propuesta aplicada',
  'auto_pilot.proposal_rolled_back': 'Auto-Pilot · propuesta revertida',
  // Wave R3.0 Fase 4 · Equipo P21-B
  'tableau.dataset_fetched': 'Tableau · dataset descargado',
  // Wave P21-C
  'powerbi.dataset_fetched': 'Power BI · dataset consultado vía OData',
  // R4-D · DocSpace + Real-time co-edit
  'doc.realtime_edit_session': 'Documento · sesión de co-edit persistida',
  'whiteboard.realtime_edit_session': 'Pizarra · sesión de co-edit persistida',
  // Wave R4-E · Monetización SaaS
  'billing.checkout_started': 'Billing · checkout iniciado',
  'billing.subscription_created': 'Billing · suscripción creada',
  'billing.subscription_updated': 'Billing · suscripción actualizada',
  'billing.subscription_canceled': 'Billing · suscripción cancelada',
  'billing.invoice_paid': 'Billing · factura pagada',
  'billing.invoice_failed': 'Billing · pago fallido',
  // Support Chatbot
  'support.chat_started': 'Soporte · chat iniciado',
  'support.chat_message_sent': 'Soporte · mensaje enviado',
  // R4 · US-7.2 Chat View
  'chat.channel_created': 'Chat · canal creado',
  'chat.channel_deleted': 'Chat · canal eliminado',
  'chat.message_sent': 'Chat · mensaje enviado',
  'chat.message_edited': 'Chat · mensaje editado',
  'chat.message_deleted': 'Chat · mensaje eliminado',
  'chat.reaction_added': 'Chat · reacción agregada',
  'chat.reaction_removed': 'Chat · reacción removida',
  // US-7.5 · Proofing
  'proofing.annotation_created': 'Proofing · anotación creada',
  'proofing.annotation_replied': 'Proofing · reply agregado',
  'proofing.annotation_resolved': 'Proofing · anotación resuelta',
  'proofing.annotation_reopened': 'Proofing · anotación reabierta',
  'proofing.annotation_changes_requested': 'Proofing · cambios solicitados',
  'proofing.annotation_deleted': 'Proofing · anotación eliminada',
  'proofing.version_created': 'Proofing · versión de attachment creada',
  // Wave R5 · US-9.3 — CMDB
  'ci.created': 'CMDB · Configuration Item creado',
  'ci.updated': 'CMDB · Configuration Item actualizado',
  'ci.retired': 'CMDB · Configuration Item retirado',
  'ci.deleted': 'CMDB · Configuration Item eliminado',
  'ci.relation_added': 'CMDB · relación entre CIs agregada',
  'ci.relation_removed': 'CMDB · relación entre CIs eliminada',
  'ci.task_linked': 'CMDB · ticket linkeado a CI',
  'ci.task_unlinked': 'CMDB · ticket desvinculado de CI',
  // US-9.2 · Wave R5 — Gap Analysis
  'gap.created': 'Gap Analysis · análisis creado',
  'gap.updated': 'Gap Analysis · análisis actualizado',
  'gap.deleted': 'Gap Analysis · análisis eliminado',
  'gap.dimension_recalculated': 'Gap Analysis · métricas auto recalculadas',
  'gap.exported': 'Gap Analysis · exportado a Excel',
}

// ───────────────────────── Tipos de entidad ─────────────────────────

/**
 * Catálogo soft de entityType. Lista no exhaustiva — el campo en BD es
 * `String` libre. Mantenemos esta unión como hint para callers; el helper
 * no la valida estrictamente para no romper extensiones.
 */
export type AuditEntityType =
  | 'task'
  | 'project'
  | 'user'
  | 'dependency'
  | 'baseline'
  | 'permission'
  | 'import'
  | 'export'
  | 'session'
  | (string & {}) // permite valores ad-hoc sin perder autocompletado

// ───────────────────────── Errores tipados ─────────────────────────

export type AuditErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'PERSIST_FAILED'

// ───────────────────────── Inputs / Outputs ─────────────────────────

/**
 * Payload aceptado por `recordAuditEvent`. Casi todos los campos son
 * opcionales — solo `action` y `entityType` son obligatorios.
 *
 * Nota sobre snapshots: `before`/`after` deben ser objetos planos
 * serializables. NO incluyas campos sensibles (`password`, `token`,
 * `secret`, `apiKey`, `creditCard`). El helper aplica un sanitize
 * defensivo pero no es bala de plata.
 */
export type RecordAuditEventInput = {
  actorId?: string | null
  action: AuditAction
  entityType: AuditEntityType
  entityId?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Forma serializada (ISO strings) que devuelven las queries cacheadas.
 * Todos los campos JSON los exponemos como `unknown` en cliente para
 * forzar al consumidor a hacer narrowing antes de renderizar.
 */
export type SerializedAuditEvent = {
  id: string
  actorId: string | null
  actorName: string | null
  actorEmail: string | null
  action: string
  entityType: string
  entityId: string | null
  before: unknown | null
  after: unknown | null
  ipAddress: string | null
  userAgent: string | null
  metadata: unknown | null
  createdAt: string
}

// ───────────────────────── Constantes ─────────────────────────

/**
 * Retention default (días). `purgeOldAuditEvents` borra eventos con
 * `createdAt < now() - DEFAULT_RETENTION_DAYS días`. Se puede sobreescribir
 * por argumento en la action.
 */
export const DEFAULT_RETENTION_DAYS = 90

/**
 * Lista de claves consideradas sensibles. El helper `recordAuditEvent`
 * las omite automáticamente de `before`/`after` antes de persistir,
 * sustituyéndolas por el sentinel `'[REDACTED]'`.
 */
export const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'creditCard',
  'ssn',
] as const

/**
 * Sanitiza recursivamente un objeto reemplazando los valores de claves
 * sensibles por `'[REDACTED]'`. Idempotente, defensivo: si recibe null
 * devuelve null; si recibe un primitivo lo retorna tal cual.
 */
export function redactSensitive<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((v) => redactSensitive(v)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if ((SENSITIVE_KEYS as readonly string[]).includes(k)) {
      out[k] = '[REDACTED]'
    } else {
      out[k] = redactSensitive(v)
    }
  }
  return out as unknown as T
}
