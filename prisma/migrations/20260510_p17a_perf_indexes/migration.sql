-- Wave P17-A (Performance & Scale) — índices Postgres faltantes.
--
-- Identificados a partir del análisis de queries calientes en server actions:
--   * /list,/kanban,/gantt: Task filtrada por (assigneeId, status), (sprintId, status)
--   * /releases: Task agrupada por (epicId, status) — usado por groupBy en releases.ts
--   * /portfolio/allocation: Task filtrada por rangos (startDate, endDate) con
--     dailyEffortHours not null (loadAllocationForRange)
--   * /audit-log: filtros frecuentes (actorId + action) y (action) sueltos
--   * /risks: filtro por owner (`Risk.ownerId`) — endpoint "mis riesgos"
--   * Notification badge: `WHERE userId = ? AND readAt IS NULL` se beneficia
--     enormemente de un índice parcial (mucho más pequeño que el full índice).
--   * /insights: dismissal lookup por (taskId, dismissedAt) en runProjectInsights.
--   * UserAvailability: query por `(userId, endDate >= now)` en allocation.
--
-- Todos los índices son aditivos y usan IF NOT EXISTS, así que la aplicación
-- es idempotente. Si Edwin re-ejecuta la migración no se duplican.
-- En Postgres, los CREATE INDEX bloquean writes brevemente; en producción
-- preferiríamos CREATE INDEX CONCURRENTLY, pero Prisma migrate deploy
-- ejecuta dentro de transacción y CONCURRENTLY no es transaccional. Edwin
-- puede aplicar manualmente con CONCURRENTLY si el lock impacta negocio.

-- Task: assignee dashboards ("mis tareas") + filtros por status global.
CREATE INDEX IF NOT EXISTS "Task_assigneeId_status_idx"
  ON "Task" ("assigneeId", "status")
  WHERE "archivedAt" IS NULL;

-- Task: SprintBoard / SprintMetrics — filtra por sprintId + status.
CREATE INDEX IF NOT EXISTS "Task_sprintId_status_idx"
  ON "Task" ("sprintId", "status")
  WHERE "archivedAt" IS NULL;

-- Task: Releases dashboard usa groupBy(['epicId', 'status']) sobre tasks.
CREATE INDEX IF NOT EXISTS "Task_epicId_status_idx"
  ON "Task" ("epicId", "status")
  WHERE "archivedAt" IS NULL AND "epicId" IS NOT NULL;

-- Task: Allocation cross-project — rango fechas con dailyEffortHours.
-- Filtro típico:
--   archivedAt IS NULL AND status != DONE AND assigneeId IS NOT NULL
--   AND startDate <= :end AND endDate >= :start AND dailyEffortHours IS NOT NULL
-- Un índice multicolumna (startDate, endDate) acelera el rango.
CREATE INDEX IF NOT EXISTS "Task_dateRange_alloc_idx"
  ON "Task" ("startDate", "endDate")
  WHERE "archivedAt" IS NULL
    AND "assigneeId" IS NOT NULL
    AND "dailyEffortHours" IS NOT NULL;

-- Risk: dashboard "mis riesgos" filtra por (ownerId, status).
CREATE INDEX IF NOT EXISTS "Risk_ownerId_status_idx"
  ON "Risk" ("ownerId", "status")
  WHERE "ownerId" IS NOT NULL;

-- Notification: badge de no-leídas — partial index reduce tamaño ~10x si
-- la mayoría son leídas. La query es:
--   SELECT * FROM Notification WHERE userId=? AND readAt IS NULL
--   ORDER BY createdAt DESC
-- El índice existente (userId, readAt) sirve, pero un parcial sobre la
-- minoría de filas no-leídas es más eficiente para el badge.
CREATE INDEX IF NOT EXISTS "Notification_unread_partial_idx"
  ON "Notification" ("userId", "createdAt" DESC)
  WHERE "readAt" IS NULL;

-- AuditEvent: filtro por (actorId, action) + ordenado por fecha.
-- Existe (actorId, createdAt DESC) pero no compuesto con `action`. Cuando
-- el usuario filtra "mis acciones de tipo X" en /audit-log se gana mucho.
CREATE INDEX IF NOT EXISTS "AuditEvent_actorId_action_createdAt_idx"
  ON "AuditEvent" ("actorId", "action", "createdAt" DESC)
  WHERE "actorId" IS NOT NULL;

-- TaskInsight: dismissed lookup en runProjectInsights — el índice existente
-- (taskId, kind, createdAt DESC) cubre `taskId + kind` pero la query
-- runProjectInsights filtra por `task.projectId AND dismissedAt IS NOT NULL`.
-- Aquí ayuda más un índice parcial sobre (taskId) WHERE dismissedAt IS NOT NULL.
CREATE INDEX IF NOT EXISTS "TaskInsight_dismissed_partial_idx"
  ON "TaskInsight" ("taskId", "kind")
  WHERE "dismissedAt" IS NOT NULL;

-- UserAvailability: en allocation se filtra `userId IN (...) AND endDate >= now`.
-- El índice existente (userId, startDate, endDate) cubre prefix por userId
-- pero un endDate sólo ayuda al rango si es leading column. Agregamos uno
-- complementario (endDate, userId) para acelerar el filtro temporal.
CREATE INDEX IF NOT EXISTS "UserAvailability_endDate_userId_idx"
  ON "UserAvailability" ("endDate", "userId");

-- Comentario de cierre — beneficios estimados (sin EXPLAIN real porque
-- la migración no se aplica desde aquí; Edwin lo hace via Supabase MCP):
--   * /list "mis tareas": de Index Scan en Task_projectId_status a un Index
--     Only Scan en Task_assigneeId_status — 5-20x speedup en proyectos
--     grandes (>1k tasks).
--   * Sprint board: idem, ahora Postgres puede saltar al sprintId directo
--     en vez de scan + filtro.
--   * Notification badge: el partial index reduce I/O en ~10x cuando el
--     usuario tiene muchas notificaciones leídas acumuladas.
--   * Audit /audit-log "mis acciones de tipo X": de un seq scan filtrado
--     a Index Scan directo.
