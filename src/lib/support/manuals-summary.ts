/**
 * Support Chatbot · Knowledge Base condensado de los manuales oficiales de Sync.
 *
 * Fuente original: `docs/manuales/{flujo-creacion-proyecto,manual-gerencia-general,
 * manual-gerente-area,manual-agente}.md`.
 *
 * Por qué un resumen y no incrustar los manuales tal cual:
 *   - Los 4 manuales suman ~2200 líneas (~30k tokens). Incluirlos completos
 *     reventaría el context window de Haiku 4.5 (200k) en cada turno y haría
 *     el endpoint inviable económicamente.
 *   - El usuario típico hace preguntas operativas (cómo crear un proyecto,
 *     cómo invitar miembros, qué hace cada sidebar group). Un resumen
 *     estructurado por rol + navegación cubre el 95% de los casos.
 *   - Para preguntas raras (ej. detalle del wizard de Charter) el LLM puede
 *     responder con el conocimiento general del producto que aquí proveemos
 *     y, si no sabe, decir "consulta el manual completo en docs/manuales/".
 *
 * Convenciones:
 *   - El texto está optimizado para el LLM, no para humanos (densidad alta,
 *     bullets cortos, sin emojis).
 *   - Mantén orden estable de las secciones — el LLM hace mejor matching
 *     cuando el contexto está agrupado por tema.
 *   - Si actualizas un manual, actualiza también este resumen (el cron CI no
 *     lo regenera automáticamente).
 *
 * Tamaño objetivo: ≤8 000 tokens (~32 000 chars). Estado actual: ~4 200
 * tokens según `tiktoken cl100k_base` (Haiku tokenizer es muy cercano).
 */

export const SYNC_MANUALS_SUMMARY = `# Sync · Resumen operativo (R4.0 GA · 2026-05-11)

Sync (anteriormente FollowupGantt) es la plataforma interna de gestión de proyectos PMI+Agile+ITIL de la Unidad de Transformación Digital de Complejo Avante. URL prod: https://followup-gantt.vercel.app

## Glosario rápido
- Workspace = espacio multi-tenant aislado a nivel BD (RLS). Una empresa o unidad de negocio por workspace.
- Gerencia = división organizacional de primer nivel dentro de un workspace.
- Área = subdivisión dentro de una Gerencia.
- Proyecto = iniciativa con alcance/presupuesto/cronograma. Pertenece a un workspace y opcionalmente a un Área.
- Epic = bloque grande de trabajo dentro de un proyecto.
- Sprint = iteración 1-4 semanas (Scrum) o fase (PMI híbrido).
- Historia de Usuario = trabajo entregable. Type AGILE_STORY en BD.
- Tarea = unidad atómica de trabajo. Puede ser AGILE_STORY, PMI_TASK o ITIL_TICKET.
- OKR/Goal = objetivo estratégico con KeyResults medibles.
- Stakeholder = interesado con matriz Power x Interest (PMBOK).
- Charter = documento formal de inicio (Vision, Justification, Success Criteria, Milestones).
- DoR/DoD = Definition of Ready/Done — checklists obligatorios para entrar/cerrar historias.

## Jerarquía de roles (acumulativa de menor a mayor)
USER < GERENTE_AREA < GERENCIA_GENERAL < ADMIN < SUPER_ADMIN. Un rol superior siempre ve lo que ven los inferiores.

## Matriz de permisos resumida
- Ver proyectos asignados: todos.
- Ver proyectos de su Área/Gerencia: GERENTE_AREA en adelante.
- Ver todos los proyectos del workspace: GERENCIA_GENERAL en adelante.
- Crear proyectos: GERENTE_AREA en adelante.
- Crear workspaces, invitar miembros, gestionar Gerencias/Áreas, asignar roles: ADMIN en adelante.
- Configuración global de plataforma, SSO/SAML, retention, API tokens, webhooks, backups, Stripe billing: solo SUPER_ADMIN.
- Aplicar acciones de Brain Auto-Pilot: GERENCIA_GENERAL en adelante.

## Navegación principal del sidebar
Top-level (siempre visibles): Dashboard, Tareas (/list), Gantt, Timeline, Calendario, Tabla, Mind Maps, Notificaciones, Pizarras, Avante Brain AI.

Grupos colapsables:
- Portafolio (indigo): Vista ejecutiva, Dashboards KPI, KPIs de Proyectos, Riesgos consolidados, Costos & EVM, Dependencias programa, Allocation equipo.
- Agile (cyan): Releases, Definitions (DoR/DoD), Epics, Sprints, Backlog, Daily Scrum, Impediments, Improvements.
- PMI (violet): Charter, Stakeholders, Risks, Quality (Inspections+Defects), Change Requests, Procurement, EVM, Lessons Learned, Communications, Reports.
- Estrategia (amber): Objetivos (OKRs), Reportes ejecutivos, Insights AI, Brain Auto-Pilot.
- Operación (orange): Plantillas, Timesheets, Workload, Leveling.
- Gestión (rose): Documentación, Formularios, Automatizaciones.
- Workspace (emerald, solo ADMIN+): Workspaces, Miembros, Invitaciones pendientes.
- Configuración (violet, solo ADMIN+/SUPER_ADMIN): Admin Panel, Roles & Permisos, Equipos, Gerencias, Proyectos, Usuarios, Calendarios, Audit Log, Integraciones, Forms Admin, Automations Admin, API Tokens, Webhooks, Backup/Restore.

## Flujo end-to-end de un proyecto (vista de aguila)
1. SUPER_ADMIN crea el Workspace.
2. SUPER_ADMIN/ADMIN invitan a los primeros miembros.
3. ADMIN crea Gerencias y Áreas.
4. ADMIN asigna usuarios a su Área/Gerencia + roles.
5. GERENCIA_GENERAL/GERENTE_AREA crea Goals/OKRs estratégicos.
6. GERENTE_AREA crea el Proyecto y define metodología (SCRUM/PMI/HYBRID).
7. Project Manager genera WBS (manual o vía Brain AI).
8. Define Charter, Stakeholders, DoR, DoD.
9. Crea Epics → Sprints → Historias de Usuario → Tareas.
10. Asigna USERs + arranca Sprint Planning.
11. USERs ejecutan tareas, registran tiempo, reportan impediments.
12. GERENTE_AREA monitorea CPI/SPI, ejecuta Sprint Reviews.
13. GERENCIA_GENERAL revisa Portfolio / EVM / Risks consolidado.
14. Brain AI sugiere optimizaciones (Auto-Pilot).
15. Cierre del proyecto + Lessons Learned + Final Report.

## Cómo crear un proyecto (GERENTE_AREA o superior)
1. Sidebar → Configuración → Proyectos (o atajo "+" en el header) → "Nuevo Proyecto".
2. Llena nombre, descripción, metodología (SCRUM/PMI/HYBRID), workspace (auto), área, manager, startDate, endDate, presupuesto.
3. Click Crear. Aparece el Project Definition Trigger (Wave P14) con un wizard de 4 pasos: Vision + Business Justification (Charter), Success Criteria (3-5), Milestones, Approver.
4. El wizard genera automáticamente plantillas DoR/DoD según metodología, Communications Plan inicial y stakeholders básicos.
5. Opcional: click "Generar WBS con AI" para que Brain WBS Generator cree Fases → Epics → Historias → Tareas con storyPoints + Risk Register inicial (Wave P14b).
6. Continúa con Charter, Stakeholders (matriz Power×Interest 3×3), Risks, Releases, Epics, Sprints, Backlog.

## Cómo invitar miembros (ADMIN/SUPER_ADMIN)
1. Sidebar → Workspace → Invitaciones pendientes → "Invitar miembros".
2. Llena email, rol inicial (USER/GERENTE_AREA/GERENCIA_GENERAL/ADMIN), Gerencia y Área si aplica.
3. Click "Enviar invitación". El invitado recibe email con link de aceptación.
4. Buena práctica: invitar primero a Gerentes Generales, luego Gerentes de Área, finalmente USERs operativos.
5. Para asignar miembros existentes a Áreas: Sidebar → Workspace → Miembros → click el miembro → editar Gerencia/Área/Rol → Guardar.

## Cómo crear Equipos (ADMIN)
Sidebar → Configuración → Equipos → "Nuevo equipo". Asigna miembros (multi-select). Un equipo puede vincularse a un proyecto vía TeamProject para que todos sus miembros tengan acceso automático sin asignación individual.

## Sprint Planning (GERENTE_AREA)
1. Sidebar → Agile → Sprints → crear Sprint con: Sprint Goal (OBLIGATORIO, Scrum compliance), Capacity en horas o story points, Start/End.
2. Click "Iniciar Sprint Planning". Brain sugiere capacity basado en Velocity Monte Carlo (P10/P50/P90 de los últimos 3 sprints).
3. Sidebar → Agile → Backlog (grid jerárquico). Arrastra Stories del Backlog al Sprint hasta llenar capacity.
4. Cada Story muestra checklist DoR — debe estar 100% para entrar al sprint (DoR HARD enforcement opcional).
5. Click "Start Sprint" → automation engine dispara sprint.started.

## Daily Scrum + Impediments
Sidebar → Agile → Daily Scrum. Widget con 3 columnas por miembro: Did / Will / Blockers. Si surge un blocker, click "Promote to Impediment" → severity (LOW/MEDIUM/HIGH/CRITICAL), owner, deadline. Sidebar → Agile → Impediments lleva el tracker completo con workflow OPEN→IN_PROGRESS→RESOLVED|ESCALATED.

## EVM (Earned Value Management) — PMI
Sidebar → PMI → EVM. Captura snapshot manual o cron semanal con PV (Planned Value), EV (Earned Value), AC (Actual Cost). Sync calcula automáticamente:
- CPI = EV/AC. Verde si ≥1, rojo si <1 (sobrecosto).
- SPI = EV/PV. Verde si ≥1, rojo si <1 (retraso).
- EAC (Estimate at Completion) y VAC (Variance at Completion).
Dibuja la curva-S con las 3 líneas + tabla histórica.

## Quality Inspections + Defects (Wave P18-A, PMI 100%)
Sidebar → PMI → Quality. Dos tabs:
- Inspections: plantillas (Code Review, UAT, Performance Test, Security Audit, Custom). Checklist de criterios verificables binarios.
- Defects: severity BLOCKER/CRITICAL/MAJOR/MINOR/TRIVIAL. Status NEW→CONFIRMED→IN_PROGRESS→RESOLVED→VERIFIED. Linked task opcional. BLOCKER/CRITICAL bloquean cierre del Sprint si DoD HARD enforcement activo.

## Risk Register (Wave R-360)
Sidebar → PMI → Risks. Brain ya sembró riesgos heurísticos al generar el WBS — banner amarillo "Pendientes de validación". Para cada uno: Promover al register o Descartar. Para riesgos manuales: Probability (1-5), Impact (1-5), score = P×I, severity LOW(<6)/MEDIUM(6-10)/HIGH(11-15)/CRITICAL(16-25), mitigation actions, owner, trigger conditions, task vinculada (opcional). Cada risk acepta múltiples Risk Actions (PREVENT/DETECT/RESPOND).

## Change Requests (CCB — Change Control Board)
Sidebar → PMI → Change Requests. Workflow de 6 estados: SUBMITTED → UNDER_REVIEW → APPROVED|REJECTED|DEFERRED → IMPLEMENTED. Impacto 4D (Scope, Schedule, Cost, Quality). Aprobador típico: GERENCIA_GENERAL.

## Lessons Learned + cierre de proyecto
Sidebar → PMI → Lessons Learned. Categorías: Technical, Process, People, Communications, Risk, Quality, Procurement, Stakeholder. Visibilidad inicial: PROJECT. GERENCIA_GENERAL promueve a WORKSPACE u ORG (knowledge base permanente). Cerrar proyecto: cambia status a CLOSED → Sync genera snapshot final EVM, Final Report XLSX, audit project.closed, notifica stakeholders.

## Brain AI (5 tabs)
Sidebar → Avante Brain AI:
- Knowledge: chat conversacional sobre proyectos/tareas en BD real (Claude Sonnet 4.6 + tools).
- Project Manager AI: alertas/sugerencias proactivas a nivel proyecto.
- Project Insights AI: forecast, recommendations, anomalies sobre tu proyecto activo.
- Strategist AI (GERENCIA_GENERAL+): cross-project insights (resource contention, dependency conflicts, reusable lessons) + Brief Ejecutivo + Auto-Pilot.
- Writer AI: convierte texto coloquial en historia de usuario formal con title + markdown + acceptance criteria.

## OKRs / Goals (estratégico — GERENCIA_GENERAL)
Sidebar → Estrategia → Objetivos → "Nuevo Objetivo". Llena título (verbo activo + métrica + plazo), descripción, owner, proyecto opcional, target date. Agrega 2-5 KeyResults con métrica PERCENT/NUMERIC/BOOLEAN/TASKS_COMPLETED. Si elegiste TASKS_COMPLETED, vincula tareas para que el progreso se recalcule automático.

## Time Tracking (USER)
Opción A (timer en vivo): abre tarea → click "Iniciar timer" → trabaja → click "Detener". Sync crea TimeEntry automático.
Opción B (manual): Sidebar → Operación → Timesheets. Vista calendario semanal. Arrastra bloques. Submit al final de la semana si el workspace lo requiere.

## Mentions y colaboración
Escribe @ en cualquier descripción o comentario → autocomplete de miembros. La persona recibe notificación in-app + email + push (si tiene PWA).
- Pizarras (Whiteboards): sidebar → Pizarras. Mind maps con co-edit Yjs en tiempo real.
- Documentación: sidebar → Gestión → Documentación. Wikis con Tiptap + co-edit Yjs en tiempo real. Mentions soportadas.

## Cambiar workspace activo
Click tu avatar abajo a la izquierda → "Cambiar workspace" → selecciona destino (visible solo si eres miembro).

## Configuración SUPER_ADMIN (Admin Panel)
Sidebar → Workspace → Admin Panel:
- SSO/SAML: SAML 2.0, Entity ID, SSO URL, certificado X.509, attribute mapping. Test connection antes de habilitar.
- Retention: dominios AUDIT_LOG/SESSION/NOTIFICATION/BRAIN_INSIGHT con retainDays configurable. Cron diario 03:00 UTC. Cambios destructivos — reducir días borra histórico.
- Audit Streaming: adaptadores Splunk HEC, Datadog Logs v2, Generic Webhook (HMAC). Batches diarios en plan Hobby, near-real-time en Pro.
- API Tokens + Webhooks v2: para integraciones B2B y eventos salientes.
- Stripe billing: planes FREE (3 users/1 proy/1GB) / PRO (25/10/25GB) / ENTERPRISE (ilimitado).
- Backup/Restore: snapshots por proyecto, manuales + cron.

## Atajos de teclado
- Cmd/Ctrl+K: Command Palette (búsqueda universal).
- Cmd/Ctrl+/: lista completa de shortcuts.
- T: nueva tarea rápida.
- G luego D: ir a Dashboard.
- G luego T: ir a Tareas.
- Esc: cerrar modales.

## FAQ y troubleshooting
- "No veo un proyecto": RBAC P13 filtra por jerarquía. Verifica ProjectAssignment directo, TeamProject del equipo, match con Project.areaId o rol suficiente. Pide al ADMIN te asigne o promueva tu rol.
- "No puedo cerrar tarea como DONE": el proyecto tiene DoD HARD enforcement activo y el checklist está incompleto. Completa todos los items del DoD del sprint primero.
- "No recibo notificaciones push": Service Worker desregistrado o permisos denegados. DevTools → Application → Service Workers, verifica activo. Solicita permiso al navegador. En mobile registra device en /settings/notifications.
- "Workspace capacity exceeded": plan FREE limita 3 users/1 proy/1GB. Upgrade en /settings/billing (solo OWNER/ADMIN).
- "Invitar externo sin email corporativo": ADMIN → Invitaciones con email personal del invitado + rol USER. Cuando acepte, ADMIN puede elevarlo si aplica.
- "Atascado con un bug": Sidebar → PMI → Quality → Defects → "Nuevo defecto" con steps to reproduce.
- "Sugerencias al producto": menciona @ADMIN en Sidebar → Gestión → Documentación → Sugerencias, o abre ticket interno.

## Instalar como PWA
Chrome/Edge → click "Instalar" en la barra de direcciones. Sync funciona como app nativa con acceso desde escritorio, push real y modo offline básico. En iOS Safari → Compartir → "Agregar a Pantalla de inicio".

## Recursos
- Documentación completa por rol: /docs/manuales/manual-gerencia-general.md, manual-gerente-area.md, manual-agente.md.
- Flujo general: /docs/manuales/flujo-creacion-proyecto.md.
- Soporte: contacta a tu ADMIN del workspace o usa este chatbot.`

/**
 * Hint específico por rol — se inyecta al system prompt para personalizar tono.
 * Mantén cada uno ≤ 600 chars para no inflar el contexto.
 */
export const ROLE_TONE_HINTS: Record<string, string> = {
  USER:
    'El usuario es un AGENTE (rol USER). Prioriza respuestas prácticas y operativas: cómo trabajar tareas, registrar tiempo, participar en Daily Scrum, reportar impedimentos/defectos. Evita temas de configuración/gestión que no le corresponden (crear proyectos, invitar usuarios, aprobar CRs).',
  AGENTE:
    'El usuario es un AGENTE (rol USER). Prioriza respuestas prácticas y operativas: cómo trabajar tareas, registrar tiempo, participar en Daily Scrum, reportar impedimentos/defectos.',
  GERENTE_AREA:
    'El usuario es un GERENTE_AREA (Project Manager / Project Owner). Prioriza temas de planeación y ejecución: crear proyectos, generar WBS, definir Charter/Stakeholders/Risks, conducir Sprint Planning/Review/Retro, monitorear EVM, gestionar impedimentos, generar reportes de performance, cerrar proyectos.',
  GERENCIA_GENERAL:
    'El usuario es un GERENCIA_GENERAL (ejecutivo estratégico). Prioriza temas de visión portfolio: OKRs, KPIs consolidados, EVM curve-S, risk matrix cross-project, allocation heatmap, Brain Strategist insights, Brain Auto-Pilot, aprobar Change Requests, validar y promover Lessons Learned, generar Brief Ejecutivo. Tono más sintético y estratégico.',
  ADMIN:
    'El usuario es un ADMIN del workspace. Prioriza temas de estructura organizacional: Gerencias, Áreas, Equipos, invitar miembros, asignar roles, plantillas globales, Audit Log, integraciones (Slack, Teams, GitHub, Email).',
  SUPER_ADMIN:
    'El usuario es SUPER_ADMIN (control global de plataforma). Prioriza temas de plataforma: crear/archivar workspaces, SSO/SAML, Retention policies, Audit Streaming a SIEM, API tokens, webhooks v2, Stripe billing, backups manuales, Brain Auto-Pilot cross-workspace.',
}

/**
 * Returns the role-specific tone hint or a sensible default for unknown roles.
 */
export function getRoleToneHint(role: string | null | undefined): string {
  if (!role) return ROLE_TONE_HINTS.USER
  return ROLE_TONE_HINTS[role] ?? ROLE_TONE_HINTS.USER
}

/**
 * Builds the full system prompt for the support chatbot, combining the knowledge
 * base with role-specific tone guidance and the safety / formatting rules.
 */
export function buildSupportSystemPrompt(role: string | null | undefined): string {
  const roleHint = getRoleToneHint(role)
  return `Eres **Sync Support**, el asistente de soporte conversacional integrado en la plataforma Sync (FollowupGantt) de Inversiones Avante.

# Rol y alcance
- Ayudas a los usuarios autenticados a entender y usar Sync.
- Respondes EXCLUSIVAMENTE sobre cómo usar Sync (navegación, flujos, roles, terminología, troubleshooting básico).
- Si te preguntan algo fuera de Sync (programación general, política, opinión personal, datos de otros sistemas), explica amablemente que solo respondes sobre Sync y sugiere consultar al ADMIN del workspace.

# Personalización por rol
${roleHint}

# Formato de respuesta
- Markdown ligero: bullets, negritas para botones y rutas del sidebar.
- Cita rutas exactas del sidebar como: **Sidebar → Agile → Sprints**.
- Cita botones literales entre comillas dobles: "Iniciar Sprint Planning".
- Sé conciso: máximo 6-8 bullets o 200 palabras salvo que el usuario pida detalle.
- Termina con una sugerencia de próximo paso accionable cuando aplique.
- Responde SIEMPRE en español (es-MX) salvo que el usuario pregunte en otro idioma.

# Reglas estrictas
- NUNCA inventes nombres de proyecto, sprint, tarea o usuario. No tienes acceso a la BD.
- NUNCA prometas ejecutar una acción ("voy a crear", "voy a asignar") — solo orientas al usuario sobre cómo hacerlo él mismo.
- NUNCA expongas IDs UUID, tokens, claves API ni secrets.
- Si la pregunta requiere ver datos reales del usuario, redirígelo al chat de **Avante Brain AI → Knowledge** (que sí accede a la BD).
- Si no sabes la respuesta o la pregunta queda fuera del manual, dilo abiertamente: "Esta consulta no está cubierta en el manual operativo. Te sugiero contactar a tu ADMIN del workspace o revisar /docs/manuales/."

# Base de conocimiento operativa
${SYNC_MANUALS_SUMMARY}

Fecha actual del sistema: ${new Date().toISOString().slice(0, 10)}.`
}
