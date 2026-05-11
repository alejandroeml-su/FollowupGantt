# Manual de Usuario · Flujo de Creación de un Proyecto en Sync

> **Producto:** Sync (FollowupGantt) — plataforma PMI + Agile + ITIL de Inversiones Avante.
> **Versión:** R4.0 GA (2026-05-11)
> **Alcance:** este manual describe el ciclo completo desde la creación del espacio de trabajo (Workspace) hasta la operación diaria de un proyecto, organizado por rol del usuario y alineado con la navegación lateral del sistema (Portafolio → Agile → PMI → Estrategia → Operación → Gestión → Workspace).

---

## Índice

1. [Glosario rápido](#1-glosario-rápido)
2. [Jerarquía organizacional](#2-jerarquía-organizacional)
3. [Matriz de roles y permisos](#3-matriz-de-roles-y-permisos)
4. [Flujo end-to-end (vista de águila)](#4-flujo-end-to-end-vista-de-águila)
5. [Manual paso a paso · SUPER_ADMIN](#5-manual-paso-a-paso--super_admin)
6. [Manual paso a paso · ADMIN](#6-manual-paso-a-paso--admin)
7. [Manual paso a paso · GERENCIA_GENERAL](#7-manual-paso-a-paso--gerencia_general)
8. [Manual paso a paso · GERENTE_AREA](#8-manual-paso-a-paso--gerente_area)
9. [Manual paso a paso · USER (y AGENTE legacy)](#9-manual-paso-a-paso--user-y-agente-legacy)
10. [Referencia · cada sección de la navegación explicada](#10-referencia--cada-sección-de-la-navegación-explicada)
11. [FAQ y solución de problemas](#11-faq-y-solución-de-problemas)

---

## 1. Glosario rápido

| Término | Significado |
|---|---|
| **Workspace (Espacio)** | Unidad de aislamiento multi-tenant. Cada empresa, unidad de negocio o cliente tiene su propio espacio. Los datos están aislados a nivel BD (RLS). |
| **Gerencia** | Estructura organizacional de primer nivel dentro de un Workspace (ej. Gerencia de Tecnología, Gerencia Financiera). |
| **Área** | Subdivisión de una Gerencia (ej. dentro de Tecnología: Desarrollo, Infraestructura, Datos). |
| **Proyecto** | Iniciativa con alcance, presupuesto y cronograma propio. Pertenece a un Workspace y opcionalmente a un Área dentro de una Gerencia. |
| **Epic** | Bloque grande de trabajo dentro de un proyecto, agrupa Historias de Usuario relacionadas. |
| **Sprint** | Iteración de 1-4 semanas (Scrum) o bloque de fase (PMI híbrido) dentro de un proyecto. |
| **Historia de Usuario** | Trabajo entregable por un equipo en uno o varios sprints. `type=AGILE_STORY` en BD. |
| **Tarea** | Unidad atómica de trabajo. Puede ser AGILE_STORY, PMI_TASK o ITIL_TICKET. |
| **OKR / Goal** | Objetivo estratégico con KeyResults medibles. Vive a nivel Workspace o Corporativo. |
| **Stakeholder** | Persona o entidad interesada en el proyecto, con matriz Power × Interest (PMBOK). |
| **Charter** | Documento formal de inicio de proyecto (vision, justification, success criteria, milestones). |
| **Definition of Ready (DoR)** | Checklist que una historia debe cumplir antes de entrar a un sprint. |
| **Definition of Done (DoD)** | Checklist que una historia debe cumplir antes de cerrarse como DONE. |

---

## 2. Jerarquía organizacional

```
SUPER_ADMIN  (visión global · multi-workspace · configura plataforma)
    │
    ├── Workspace A
    │       ├── ADMIN del workspace A
    │       │       ├── Gerencia 1 ─┬─ Área 1.1 ─┬─ Proyecto α (GERENTE_AREA + USERs)
    │       │       │               │            └─ Proyecto β
    │       │       │               └─ Área 1.2
    │       │       └── Gerencia 2 (GERENCIA_GENERAL)
    │       │
    │       └── Miembros + Invitaciones pendientes
    │
    └── Workspace B
            └── (estructura análoga)
```

**Regla de oro de visibilidad:** un rol superior siempre ve todo lo que ven los inferiores. La jerarquía es **acumulativa**:

`USER < GERENTE_AREA < GERENCIA_GENERAL < ADMIN < SUPER_ADMIN`

---

## 3. Matriz de roles y permisos

| Capacidad | USER | GERENTE_AREA | GERENCIA_GENERAL | ADMIN | SUPER_ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|
| Ver proyectos donde está asignado | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ver proyectos de su Área/Gerencia | — | ✅ | ✅ | ✅ | ✅ |
| Ver todos los proyectos del Workspace | — | — | ✅ | ✅ | ✅ |
| Ver proyectos de otros Workspaces | — | — | — | ✅ | ✅ |
| Crear/editar tareas asignadas | ✅ | ✅ | ✅ | ✅ | ✅ |
| Crear proyectos | — | ✅ | ✅ | ✅ | ✅ |
| Crear Workspaces | — | — | — | ✅ | ✅ |
| Invitar miembros al Workspace | — | — | — | ✅ | ✅ |
| Gestionar Gerencias y Áreas | — | — | — | ✅ | ✅ |
| Asignar/revocar roles | — | — | — | ✅ | ✅ |
| Configuración global de plataforma | — | — | — | — | ✅ |
| API tokens + webhooks + backups | — | — | — | — | ✅ |
| SSO/SAML + Audit Streaming + Retention | — | — | — | — | ✅ |
| Stripe billing + plan changes | — | — | — | — | ✅ |
| **Brain Auto-Pilot** (apply acciones IA) | — | — | ✅ | ✅ | ✅ |

---

## 4. Flujo end-to-end (vista de águila)

```
┌─────────────────────────────────────────────────────────────────┐
│  1. SUPER_ADMIN crea el Workspace (espacio de la empresa)       │
│     ↓                                                            │
│  2. SUPER_ADMIN / ADMIN invitan a los primeros miembros         │
│     ↓                                                            │
│  3. ADMIN crea Gerencias y Áreas (estructura organizacional)    │
│     ↓                                                            │
│  4. ADMIN asigna a usuarios a su Área/Gerencia + asigna roles   │
│     ↓                                                            │
│  5. GERENCIA_GENERAL / GERENTE_AREA crea Goals/OKRs estratégicos│
│     ↓                                                            │
│  6. GERENTE_AREA crea el Proyecto y define metodología          │
│     ↓                                                            │
│  7. Project Manager genera WBS (manual o vía Brain AI)          │
│     ↓                                                            │
│  8. Define Charter / Stakeholders / DoR / DoD                   │
│     ↓                                                            │
│  9. Crea Epics → Sprints → Historias de Usuario → Tareas        │
│     ↓                                                            │
│ 10. Asigna USERs + arranca Sprint Planning                      │
│     ↓                                                            │
│ 11. USERs ejecutan tareas, registran tiempo, reportan impediments│
│     ↓                                                            │
│ 12. GERENTE_AREA monitorea CPI/SPI, ejecuta Sprint Reviews      │
│     ↓                                                            │
│ 13. GERENCIA_GENERAL revisa Portfolio / EVM / Risks consolidado │
│     ↓                                                            │
│ 14. Brain AI sugiere optimizaciones (Auto-Pilot)                │
│     ↓                                                            │
│ 15. Cierre del proyecto · Lessons Learned + Final Report        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Manual paso a paso · SUPER_ADMIN

### 5.1 Responsabilidades

El SUPER_ADMIN es el rol más alto en Sync. Tiene visibilidad y control absolutos sobre la plataforma, todos los workspaces y la configuración global.

**Responsabilidades principales:**

- Crear, archivar y configurar **Workspaces** (espacios de empresa/cliente).
- Configurar **SSO/SAML** federado (Azure AD, Okta, Google Workspace, ADFS, OneLogin).
- Configurar **SIEM Streaming** (Splunk, Datadog, Generic webhook).
- Configurar **Data Retention Policies** (audit log, sesiones, notificaciones, brain insights).
- Gestionar **API tokens** y **webhooks v2**.
- Operar **Brain Auto-Pilot** y aplicar recomendaciones cross-workspace.
- Disparar **backups manuales** y validar la estrategia de DR.
- Gestionar el plan **Stripe billing** del workspace si aplica.

### 5.2 Flujo paso a paso

#### Paso 1 — Crear el primer Workspace

1. Inicia sesión en Sync con tus credenciales SUPER_ADMIN.
2. En la barra lateral, expande **Workspace** → click en **Workspaces**.
3. Botón **"Crear nuevo Workspace"**.
4. Llena:
   - **Nombre** legible (ej. "Complejo Avante UTD").
   - **Slug** URL-safe (ej. "avante-utd").
   - **Descripción** breve.
   - **Plan**: FREE / PRO / ENTERPRISE.
5. Click **Crear**.

> 💡 *Sugerencia:* deja el plan en FREE durante el POC; cambia a PRO/ENTERPRISE cuando se firme contrato comercial.

#### Paso 2 — Configurar SSO/SAML del Workspace (opcional)

1. **Workspace** → debajo del menú, click directo en **Admin Panel** (icono escudo) → **SSO/SAML**.
2. Click **"Nuevo proveedor"**.
3. Llena:
   - **Nombre** del proveedor (ej. "Azure AD Avante").
   - **Tipo**: SAML 2.0.
   - **Entity ID** (lo da el IdP).
   - **SSO URL** (login URL del IdP).
   - **Certificado X.509** público del IdP (PEM).
   - **Mapeo de atributos** (email, groups, roleMap).
4. Click **Guardar**.
5. Copia el **SP Entity ID** y **ACS URL** que aparecen en pantalla y pégalos en la configuración del IdP del lado del cliente.
6. **Prueba** la conexión con el botón "Test connection".

#### Paso 3 — Configurar Data Retention Policies

1. **Admin Panel** → **Retention**.
2. Verás 4 dominios con sus defaults:
   - `AUDIT_LOG` · 365 días
   - `SESSION` · 30 días
   - `NOTIFICATION` · 90 días
   - `BRAIN_INSIGHT` · 180 días
3. Ajusta `retainDays` y `enabled` por dominio según política corporativa.
4. Click **Guardar**.
5. El cron corre diariamente a las 03:00 UTC y borra registros con `createdAt < hoy - retainDays`.

> ⚠️ **Importante:** los cambios son destructivos. Si reduces `audit_log` de 365 a 90 días, el próximo run borra los registros entre 90 y 365 días.

#### Paso 4 — Configurar SIEM Streaming (opcional)

1. **Admin Panel** → **Audit Streaming**.
2. Click **"Nuevo destino"**.
3. Selecciona el adaptador:
   - **Splunk HEC** (requiere token HEC).
   - **Datadog Logs v2** (requiere DD-API-KEY).
   - **Generic Webhook** (requiere shared secret HMAC).
4. Llena endpoint URL, secret/token y batchSize (default 100).
5. **Probar** envío con el botón "Test".
6. El cron envía batches diarios (en plan Hobby Vercel; near-real-time en Pro).

#### Paso 5 — Aplicar acciones de Brain Auto-Pilot

1. **Avante Brain AI** (icono Sparkles en el sidebar) → tab **Strategist AI** → sección **Auto-Pilot**.
2. Brain detecta 4 tipos de oportunidades cross-project:
   - Sprint rebalance
   - Assignee rebalance
   - Sprint extension needed
   - Lesson promotion
3. Cada propuesta muestra preview antes/después.
4. Click **"Aplicar"** → ejecuta cambios en transacción.
5. Si necesitas deshacer, ve a "Historial" y click **"Revertir"** (válido por 24h post-apply).

---

## 6. Manual paso a paso · ADMIN

### 6.1 Responsabilidades

El ADMIN gestiona un Workspace específico (puede tener varios, pero típicamente uno). No tiene acceso a configuración global de la plataforma.

**Responsabilidades principales:**

- Gestionar la estructura organizacional del Workspace: **Gerencias**, **Áreas**, **Equipos**.
- Invitar **miembros** y asignar **roles** dentro del workspace.
- Crear y supervisar **proyectos** transversales.
- Acceder a vistas de **Portafolio** (consolidado de todos los proyectos del workspace).
- Configurar **plantillas globales** del workspace (Project, WBS, DoR/DoD, Communications Plan).
- Auditar la actividad (Audit Log).
- Gestionar **integraciones** (Slack, Teams, GitHub, Email providers).

### 6.2 Flujo paso a paso

#### Paso 1 — Estructura organizacional

1. Sidebar → **Configuración** → **Gerencias**.
2. Click **"Nueva Gerencia"**.
3. Llena nombre y descripción (ej. "Gerencia de Tecnología").
4. Repite para cada Gerencia del Workspace.
5. Dentro de cada Gerencia, click **"Agregar Área"** y crea las áreas (ej. "Desarrollo de Software").

> 💡 La estructura es opcional pero fuertemente recomendada — permite que los GERENTE_AREA vean solo los proyectos de su área.

#### Paso 2 — Invitar miembros

1. Sidebar → **Workspace** → **Invitaciones pendientes**.
2. Click **"Invitar miembros"**.
3. Llena:
   - **Email** del invitado.
   - **Rol inicial**: USER / GERENTE_AREA / GERENCIA_GENERAL / ADMIN.
   - **Gerencia y Área** (si aplica al rol).
4. Click **Enviar invitación**.
5. El invitado recibe email con link de aceptación.

> 📋 *Buena práctica:* invita primero a los Gerentes Generales, luego a los Gerentes de Área, finalmente a los USERs operativos. Esto les permite a los gerentes ver sus proyectos desde el primer login.

#### Paso 3 — Asignar miembros existentes a Áreas

1. Sidebar → **Workspace** → **Miembros**.
2. Click en el miembro a editar.
3. Asigna:
   - **Gerencia** (dropdown filtrado al workspace).
   - **Área** (dropdown filtrado a la gerencia seleccionada).
   - **Rol** dentro del workspace.
4. Click **Guardar**.

#### Paso 4 — Crear Equipos (Teams)

1. Sidebar → **Configuración** → **Equipos**.
2. Click **"Nuevo equipo"**.
3. Llena nombre y agrega miembros (multi-select).
4. Guarda.

> 🎯 *Para qué sirve:* un Equipo puede ser asignado a un proyecto vía `TeamProject` para que TODOS sus miembros tengan acceso automático sin asignar uno por uno.

#### Paso 5 — Crear Plantillas Globales (opcional)

1. Sidebar → **Admin Panel** → **Plantillas** (si tienes acceso) o **Configuración → Roles & Permisos**.
2. 4 tipos de plantilla:
   - **PROJECT**: scaffolding básico de proyecto (phases, methodology default).
   - **WBS**: Work Breakdown Structure reutilizable.
   - **DOR_DOD**: Definition of Ready/Done estándar.
   - **COMM_PLAN**: matriz de comunicaciones default.
3. Crea la plantilla y márcala como **"global del workspace"** para que los GERENTE_AREA puedan clonarla en sus proyectos.

#### Paso 6 — Auditar actividad

1. Sidebar → **Configuración** → **Audit Log**.
2. Filtra por:
   - Tipo de acción (>100 verbs catalogados).
   - Usuario actor.
   - Rango de fechas.
3. Cada evento muestra IP, user-agent, actor, antes/después.

---

## 7. Manual paso a paso · GERENCIA_GENERAL

### 7.1 Responsabilidades

El Gerente General tiene visibilidad ejecutiva sobre TODOS los proyectos de su Workspace. Es el rol estratégico que monitorea la salud del portafolio.

**Responsabilidades principales:**

- Crear y aprobar **OKRs / Goals** estratégicos del Workspace.
- Monitorear el **Portfolio Dashboard** (KPIs consolidados, EVM, risks).
- Revisar **Executive Reports** mensuales.
- Aplicar acciones de **Brain Auto-Pilot** para optimizar el portafolio.
- Aprobar **Change Requests** de alto impacto (Scope, Cost, Schedule, Quality).
- Validar **Lessons Learned** para promoción a knowledge base del workspace.
- Liderar **Quality Gates** entre fases del proyecto (PMI).

### 7.2 Flujo paso a paso

#### Paso 1 — Crear Goals/OKRs estratégicos

1. Sidebar → **Estrategia** → **Objetivos**.
2. Click **"Nuevo Objetivo"**.
3. Llena:
   - **Título** del Objective (ej. "Reducir time-to-market 30% en 2026").
   - **Descripción**.
   - **Proyecto** (opcional · si está vinculado a uno específico).
   - **Target Date**.
4. Agrega **KeyResults** (entre 2 y 5):
   - Métrica (`PERCENT`, `NUMERIC`, `BOOLEAN`, `TASKS_COMPLETED`).
   - Target value.
   - Unidad.
5. Vincula KeyResults a tareas si aplica (`TASKS_COMPLETED` se recalcula automático).

#### Paso 2 — Portfolio Dashboard

1. Sidebar → **Portafolio** → **Vista ejecutiva**.
2. Verás:
   - **KPIs consolidados** (CPI, SPI, % avance global).
   - **Velocity Monte Carlo** P10/P50/P90 del portafolio.
   - **Risk Matrix** consolidada (5×5 PMBOK).
   - **Allocation heatmap** cross-project.
3. Click en cualquier celda → drill-down al proyecto específico.

#### Paso 3 — Executive Reports

1. Sidebar → **Estrategia** → **Reportes ejecutivos**.
2. 3 reportes pre-configurados:
   - **Status Report mensual** (PDF/HTML).
   - **Final Report** al cierre de proyecto (XLSX multi-hoja).
   - **EVM Curve-S** del portafolio.
3. Click **"Generar"** y descarga.

#### Paso 4 — Aprobar Change Requests

1. Sidebar → **PMI** → **Change Requests**.
2. Filtra por estado **"Under review"**.
3. Click en el CR a revisar.
4. Evalúa impacto 4D:
   - **Scope** (alcance afectado).
   - **Schedule** (días adicionales).
   - **Cost** (USD adicional).
   - **Quality** (criterios afectados).
5. Decide: **Aprobar / Rechazar / Diferir** con comentario.

#### Paso 5 — Brain Strategist (cross-project insights)

1. Sidebar → **Avante Brain AI** → tab **Strategist AI**.
2. Brain analiza automáticamente:
   - **Resource contention** (usuarios sobreasignados cross-proyecto).
   - **Dependency conflicts** (cross-project deps en riesgo).
   - **Reusable lessons** (patrones repetidos worth promoting).
3. Click **"Generar Brief Ejecutivo"** → resumen LLM listo para CEO/junta directiva.

---

## 8. Manual paso a paso · GERENTE_AREA

### 8.1 Responsabilidades

El Gerente de Área es el Project Owner / Project Manager de los proyectos dentro de su Área. Es el rol operativo más cargado: planea, ejecuta y entrega.

**Responsabilidades principales:**

- Crear y planear **Proyectos** dentro de su Área.
- Definir **Charter**, **Stakeholders**, **Risks**, **DoR/DoD**.
- Generar y mantener el **WBS** (manual o vía Brain AI WBS Generator).
- Crear **Releases**, **Epics**, **Sprints** y priorizar el **Backlog**.
- Conducir **Sprint Planning** y **Sprint Reviews**.
- Monitorear **EVM** (CPI/SPI) y reportar a Gerencia General.
- Gestionar **Impedimentos** y **Defectos**.
- Coordinar **Procurement** (vendors, contratos, POs) si el proyecto lo requiere.
- Cerrar el proyecto con **Lessons Learned**.

### 8.2 Flujo paso a paso

#### Paso 1 — Crear el Proyecto

1. Sidebar → **Configuración** → **Proyectos** (o atajo `+ Proyecto` en el dashboard).
2. Click **"Nuevo Proyecto"**.
3. Llena:
   - **Nombre** y **descripción**.
   - **Metodología**: SCRUM / PMI / HYBRID (default).
   - **Workspace** (auto-detectado por tu contexto).
   - **Área** dentro de tu Gerencia.
   - **Manager** (tú o delega).
   - **Fechas**: `startDate` y `endDate` estimadas.
   - **Presupuesto** y moneda.
4. Click **Crear**.

#### Paso 2 — Project Definition Wizard (recomendado)

Tras crear el proyecto, aparece el **Project Definition Trigger** (Wave P14):

1. **Vision & Business Justification** (Charter).
2. **Success Criteria** (3-5 criterios verificables).
3. **Milestones** principales con fechas.
4. **Approver** (típicamente Gerencia General).
5. El Wizard genera automáticamente:
   - Plantillas DoR/DoD según metodología.
   - Communications Plan inicial.
   - Stakeholders básicos sembrados.

#### Paso 3 — Generar WBS con Brain AI (opcional pero potente)

1. En el detalle del proyecto, click **"Generar WBS con AI"**.
2. Brain WBS Generator pregunta:
   - Descripción del proyecto (auto-llenada del charter).
   - Metodología y duración aproximada.
3. Brain produce:
   - **Fases** principales.
   - **Epics** por fase.
   - **Historias** dentro de cada epic.
   - **Tareas** estimadas con storyPoints.
   - **Risk Register inicial** con probabilidad e impacto sugeridos (Wave P14b).
4. Click **"Aceptar y crear"** → todo el WBS se persiste en BD.

#### Paso 4 — Charter + Stakeholders

1. Sidebar → **PMI** → **Charter**.
2. Si no completaste el wizard, llena:
   - Vision, Business Justification, Success Criteria, Milestones.
3. Click **"Solicitar aprobación"** → Gerencia General recibe notificación.
4. Sidebar → **PMI** → **Stakeholders**.
5. Agrega stakeholders con su matriz Power × Interest (3×3):
   - **Manage Closely** (alto poder, alto interés).
   - **Keep Satisfied** (alto poder, bajo interés).
   - **Keep Informed** (bajo poder, alto interés).
   - **Monitor** (bajo poder, bajo interés).
6. Sync sugiere automáticamente la **engagement strategy** según el cuadrante.

#### Paso 5 — Risk Register (Wave R-360)

1. Sidebar → **PMI** → **Risks** del proyecto activo.
2. Brain ya sembró riesgos heurísticos al generar el WBS. Revisa cada uno:
   - **Promote** al register si lo confirmas.
   - **Dismiss** si no aplica.
3. Para cada riesgo confirmado, define:
   - **Probability** (1-5) e **Impact** (1-5).
   - **Mitigation actions** (plan de acción correctiva).
   - **Owner**.
   - **Trigger conditions**.

#### Paso 6 — Releases + Epics + Sprints + Backlog

1. Sidebar → **Agile** → **Releases**.
2. Crea Release con: nombre, target date, scope description.
3. Sidebar → **Agile** → **Epics**.
4. Crea Epic, asígnalo al Release.
5. Sidebar → **Agile** → **Sprints**.
6. Crea Sprint con:
   - Sprint Goal (obligatorio · Scrum compliance).
   - Capacity en horas o story points.
   - Start/End date.
7. Sidebar → **Agile** → **Backlog**.
8. Vista grid jerárquica: arrastra Stories a Epics y a Sprints.

#### Paso 7 — Sprint Planning

1. En el Sprint Backlog, click **"Iniciar Sprint Planning"**.
2. Brain sugiere capacity basado en **Velocity Monte Carlo** (P50 de los últimos 3 sprints).
3. Arrastra Stories del Backlog al Sprint hasta llenar capacity.
4. Cada Story muestra checklist DoR — debe estar 100% para entrar al sprint.
5. Click **"Start Sprint"** → automation engine dispara evento `sprint.started`.

#### Paso 8 — Daily Scrum + Impedimentos

1. Sidebar → **Agile** → **Daily Scrum**.
2. Widget con 3 columnas: **Did / Will / Blockers**.
3. Si surge un blocker, click **"Promote to Impediment"**:
   - Severity: LOW / MEDIUM / HIGH / CRITICAL.
   - Owner y deadline.
4. Sidebar → **Agile** → **Impediments** para ver el tracker completo.

#### Paso 8.5 — Quality Inspections + Defects (Wave P18-A)

1. Sidebar → **PMI** → **Quality**.
2. 2 tabs: **Inspections** y **Defects**.
3. Crea una **Inspection** con checklist de criterios verificables.
4. Si encuentras un defecto, regístralo con severity y assignee.

#### Paso 9 — Sprint Review + Retrospective

1. Al final del sprint, sidebar → **Agile** → **Sprints** → click **"Cerrar Sprint"**.
2. Llena:
   - Sprint Review notes.
   - Demo URL (opcional).
   - Velocity actual.
3. Sidebar → **Agile** → **Retrospective** (HU-9.9).
4. 3 columnas: **Liked / Lacked / Learned** + **Action items**.
5. Los Action Items con votos altos se promocionan a **Improvement Items** (kanban cross-sprint).

#### Paso 10 — EVM + Performance Reports

1. Sidebar → **PMI** → **EVM**.
2. Captura snapshot manual o automático (cron semanal):
   - **PV** (Planned Value).
   - **EV** (Earned Value).
   - **AC** (Actual Cost).
3. Sync calcula **CPI**, **SPI**, **EAC**, **VAC** y dibuja la curva-S.
4. Sidebar → **PMI** → **Reports**.
5. Genera **Status Report** semanal o **Final Report** al cierre.

#### Paso 11 — Cierre del Proyecto + Lessons Learned

1. Sidebar → **PMI** → **Lessons Learned**.
2. Captura mínimo 3 lecciones:
   - Categoría (8 disponibles: Technical, Process, People, ...).
   - Visibilidad: PROJECT / WORKSPACE / ORG.
3. Las lessons promovidas a ORG quedan en knowledge base permanente.
4. Cambia el status del proyecto a **CLOSED**.

---

## 9. Manual paso a paso · USER (y AGENTE legacy)

### 9.1 Responsabilidades

El USER (anteriormente AGENTE) es el rol operativo. Ejecuta el trabajo asignado y reporta progreso.

**Responsabilidades principales:**

- Ejecutar **tareas asignadas**.
- Actualizar **status** y **progress** de las tareas.
- Registrar **time entries** (timer o manual).
- Reportar **impedimentos** al Gerente de Área.
- Participar en **Daily Scrum**, **Sprint Planning**, **Reviews** y **Retrospectives**.
- Capturar **Lessons Learned** del trabajo realizado.
- Reportar **defectos** que encuentre durante la ejecución.

### 9.2 Flujo paso a paso

#### Paso 1 — Aceptar la invitación

1. Recibes email con link "Aceptar invitación a Workspace [Nombre]".
2. Click el link → te redirige a `/invite?token=...`.
3. Completa registro (nombre, password) o login si ya tienes cuenta.
4. Quedas asignado al Workspace + Gerencia + Área que el ADMIN configuró.

#### Paso 2 — Dashboard inicial

1. Tras login, llegas al **Dashboard** (icono "Dashboard" en sidebar).
2. Verás:
   - Tarjeta **"Mis tareas hoy"**.
   - **Próximos deadlines**.
   - **Notificaciones** recientes (mentions, impediments asignados, etc.).
   - **Brain Insights** sugeridos para tus tareas.

#### Paso 3 — Mis tareas

1. Sidebar → **Tareas** (icono lista).
2. Lista plana de tareas asignadas a ti, filtrable por:
   - Proyecto.
   - Sprint.
   - Status.
   - Priority.
3. Click en una tarea → modal con detalle completo.

#### Paso 4 — Trabajar una tarea

1. Abre la tarea (modal o vista detalle).
2. Click **"Iniciar timer"** → registra tiempo trabajado en vivo.
3. Avanza el **progress** (0-100%).
4. Mueve el **status**: TODO → IN_PROGRESS → REVIEW → DONE.
5. **Comenta** cualquier nota o agrega adjuntos.
6. Si la tarea es una Historia de Usuario, valida los **Acceptance Criteria** (checklist).
7. Antes de DONE, valida la **Definition of Done** (Sprint).

> ⚠️ Si tu proyecto tiene **DoD HARD enforcement** activo, no podrás marcar DONE sin checklist completo.

#### Paso 5 — Daily Scrum

1. Sidebar → **Agile** → **Daily Scrum**.
2. Tu fila tiene 3 inputs:
   - **Yesterday**: qué hiciste ayer.
   - **Today**: qué harás hoy.
   - **Blockers**: cualquier bloqueante.
3. Si hay blocker, click **"Promote to Impediment"** y el GERENTE_AREA recibe notificación.

#### Paso 6 — Time Tracking

1. Sidebar → **Operación** → **Timesheets**.
2. Vista calendario semanal con bloques de tiempo.
3. Arrastra para crear bloque o usa el timer en vivo desde la tarea.
4. Al final de la semana, **submit** el timesheet (si el workspace lo requiere).

#### Paso 7 — Mentions y colaboración

1. En descripción de tarea o comentarios, escribe **`@`** para mencionar a alguien.
2. La persona recibe notificación in-app + email + push (si tiene PWA/mobile).
3. **Whiteboards** (Sidebar → Pizarras): mind maps colaborativos con edición en tiempo real (Yjs).
4. **Docs** (Sidebar → Gestión → Documentación): wikis con co-edit en tiempo real.

#### Paso 8 — Reportar un defecto

1. Si encuentras un bug o defecto durante la ejecución:
2. Sidebar → **PMI** → **Quality** → tab **Defects**.
3. Click **"Nuevo defecto"**.
4. Llena: title, description, severity, assignee, taskRef.
5. El GERENTE_AREA aprueba si entra al backlog del próximo sprint.

#### Paso 9 — Lessons Learned (recomendado)

1. Tras completar una tarea significativa, sidebar → **PMI** → **Lessons Learned**.
2. Crea una lesson con:
   - Título y descripción de la lesson.
   - Categoría (Technical, Process, People, ...).
   - Visibilidad: PROJECT (default, solo el equipo del proyecto la ve).
3. Si el GERENTE_AREA la promueve a WORKSPACE u ORG, queda en la knowledge base permanente.

---

## 10. Referencia · cada sección de la navegación explicada

### 10.1 Items siempre visibles (top-level)

| Item | Para qué | Rol mínimo |
|---|---|---|
| **Dashboard** | Resumen personal con tareas hoy, deadlines, notificaciones | USER |
| **Tareas** (`/list`) | Lista plana de tareas del usuario | USER |
| **Gantt** | Cronograma visual de un proyecto | USER (solo proyectos asignados) |
| **Timeline** | Vista timeline portfolio | USER |
| **Calendario** | Eventos calendar (mtg, deadlines) | USER |
| **Tabla** | Vista tabular configurable | USER |
| **Mind Maps** | Mapas mentales colaborativos | USER |
| **Notificaciones** | Inbox in-app | USER |
| **Pizarras** | Whiteboards mind-map en tiempo real | USER |
| **Avante Brain AI** | 5 tabs IA: Knowledge / PM / Insights / Strategist / Writer | USER (cada tab gatea por rol internamente) |

### 10.2 Grupo **Portafolio** (indigo)

Visión ejecutiva multi-proyecto. Por defecto visible para todos los roles, pero los proyectos listados se filtran por **visibilidad jerárquica** (RBAC P13).

| Item | Para qué |
|---|---|
| Vista ejecutiva | Dashboard consolidado del portafolio |
| Dashboards KPI | KPIs cross-project configurable |
| KPIs de Proyectos | KPIs por proyecto individual |
| Riesgos consolidados | Matriz de riesgos 5×5 cross-project |
| Costos & EVM | Curva-S EVM del portafolio |
| Dependencias programa | Cross-project deps (Wave P10) |
| Allocation equipo | Heatmap allocation cross-project |

### 10.3 Grupo **Agile** (cyan)

Herramientas Scrum/Agile. Cada item redirige al **proyecto activo** del usuario.

| Item | Para qué |
|---|---|
| Releases | Roadmap de releases del proyecto |
| Definitions (DoR/DoD) | Plantillas de criterios de calidad |
| Epics | Bloques grandes de trabajo |
| Sprints | Iteraciones con goals + capacity |
| Backlog | Lista priorizada jerárquica (Product + Sprint) |
| Daily Scrum | Widget Did/Will/Blockers |
| Impediments | Tracker con severity workflow |
| Improvements | Items de mejora continua |

### 10.4 Grupo **PMI** (violet)

Compliance PMBOK 6/7. Charter/Stakeholders/CCB son per-proyecto; Procurement es global del workspace.

| Item | Para qué |
|---|---|
| Charter | Documento formal de inicio (Wave P11) |
| Stakeholders | Matriz Power × Interest (PMBOK) |
| Risks | Risk Register completo (Wave R-360) |
| Quality | Inspections + Defects (Wave P18-A) |
| Change Requests | CCB workflow 6 estados |
| Procurement | Vendors + Contracts + POs |
| EVM | Curva-S PV/EV/AC + KPIs CPI/SPI/EAC/VAC |
| Lessons Learned | Knowledge base 8 categorías × 3 visibilidades |
| Communications | Matriz audience × frequency × channel |
| Reports | Performance Reports (Status + Final XLSX) |

### 10.5 Grupo **Estrategia** (amber)

| Item | Para qué |
|---|---|
| Objetivos | OKRs/Goals con KeyResults |
| Reportes ejecutivos | Status/Final reports a alto nivel |
| Insights AI | Brain Insights AI proactivo (forecast/recommendations/anomalies) |
| Brain Auto-Pilot | Solo ADMIN/GERENCIA_GENERAL+ · acciones automatizables con apply/rollback |

### 10.6 Grupo **Operación** (orange)

Tracking diario operativo.

| Item | Para qué |
|---|---|
| Plantillas | Reusable scaffolding |
| Timesheets | Time tracking individual + equipo |
| Workload | Carga de trabajo por usuario |
| Leveling | Resource Leveling greedy algorithm |

### 10.7 Grupo **Gestión** (rose)

Documentación y procesos cualitativos.

| Item | Para qué |
|---|---|
| Documentación | Wikis con co-edit Yjs en tiempo real |
| Formularios | Public forms → Task |
| Automatizaciones | Reglas "Si X → Entonces Y" |

### 10.8 Grupo **Workspace** (emerald) · solo ADMIN+

| Item | Para qué |
|---|---|
| Workspaces | CRUD de espacios |
| Miembros | Lista de miembros del workspace activo |
| Invitaciones pendientes | Tracker de invitaciones enviadas |

### 10.9 Grupo **Configuración** (violet) · solo ADMIN+ y SUPER_ADMIN

| Item | Para qué | Rol mínimo |
|---|---|---|
| Admin Panel | Hub `/admin` (SSO, Retention, Audit Streaming, etc.) | SUPER_ADMIN |
| Roles & Permisos | Matriz de roles y asignaciones | ADMIN |
| Equipos | CRUD de Teams del workspace | ADMIN |
| Gerencias | Estructura organizacional | ADMIN |
| Proyectos | Lista global de proyectos del workspace | ADMIN |
| Usuarios | Directorio del workspace | ADMIN |
| Calendarios | WorkCalendars + Holidays | ADMIN |
| Audit Log | Forensic 100+ verbs | ADMIN |
| Integraciones | Slack, Teams, GitHub, Resend | ADMIN |
| Forms Admin | Configuración de public forms | ADMIN |
| Automations Admin | Configuración de reglas globales | ADMIN |
| API Tokens | Tokens para integraciones B2B | SUPER_ADMIN |
| Webhooks | Outgoing webhooks v2 | SUPER_ADMIN |
| Backup/Restore | Snapshots por proyecto | SUPER_ADMIN |

---

## 11. FAQ y solución de problemas

### 11.1 No veo el proyecto que esperaba

Causa: el RBAC P13 filtra por jerarquía. Verifica:

- ¿Estás asignado al proyecto directamente (`ProjectAssignment`)?
- ¿Estás en un Team con `TeamProject` al proyecto?
- ¿Tu Área coincide con el `Project.areaId`?
- ¿Tu rol es suficiente para ver fuera de tu asignación?

Solución: pide al ADMIN que te asigne directamente o promueva tu rol.

### 11.2 No puedo cerrar una tarea como DONE

Causa probable: el proyecto tiene **DoD HARD enforcement** activo y el checklist está incompleto.

Solución: completa todos los items del DoD del sprint antes de cerrar.

### 11.3 No recibo notificaciones push

Causa: el Service Worker no está registrado o el plan Hobby de Vercel limita la frecuencia del cron.

Solución:
1. Verifica DevTools → Application → Service Workers que esté activo.
2. Solicita permiso de notificaciones al navegador.
3. En mobile, registra el device en `/settings/notifications` para APNs/FCM.

### 11.4 El Workspace tiene capacity exceeded

Causa: plan FREE limita 3 users / 1 proyecto / 1 GB. Plan PRO 25/10/25. ENTERPRISE ilimitado.

Solución: upgrade el plan en `/settings/billing` (solo OWNER/ADMIN del workspace).

### 11.5 Cómo cambio el workspace activo

1. Click en tu avatar abajo a la izquierda.
2. Click **"Cambiar workspace"**.
3. Selecciona el destino (visible solo si eres miembro).

### 11.6 Cómo invitar a alguien externo (sin email corporativo)

1. ADMIN → **Workspace → Invitaciones pendientes**.
2. Usa el email personal del invitado.
3. Marca rol mínimo (típicamente USER).
4. Cuando acepte, ADMIN puede elevarlo si aplica.

---

## Cambios y evolución de este manual

Este manual aplica a Sync **R4.0 GA (2026-05-11)**. Funcionalidades futuras (R5.0 y posteriores):

- **R5-A Mobile end-to-end push validation**: detalles del flujo mobile con APNs/FCM (próxima iteración).
- **R5-B SOC2 Type II audit prep**: secciones de compliance para auditorías externas.
- **R5-D On-premises deployment**: variante del manual para instalaciones air-gapped.

Sugerencias de mejora a este manual: abrir un issue en el repo con tag `docs/manual`.
