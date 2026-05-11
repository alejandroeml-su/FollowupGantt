# Manual de Usuario · Gerente de Área

> **Rol:** `GERENTE_AREA`
> **Plataforma:** Sync (FollowupGantt) — R4.0 GA · 2026-05-11
> **Audiencia:** Project Managers, Líderes Técnicos y Gerentes de Área que crean y operan proyectos.

📁 **Capturas de pantalla:** las imágenes referenciadas con `📸 Captura sugerida:` se ubican en [`./screenshots/`](./screenshots/). Si aún no las ves, consulta [`screenshots/README.md`](./screenshots/README.md) para la guía de cómo tomarlas paso a paso.

---

## Índice

1. [¿Qué hace un Gerente de Área en Sync?](#1-qué-hace-un-gerente-de-área-en-sync)
2. [Tu primer login y orientación](#2-tu-primer-login-y-orientación)
3. [Crear un nuevo proyecto](#3-crear-un-nuevo-proyecto)
4. [Generar el WBS con Brain AI](#4-generar-el-wbs-con-brain-ai)
5. [Definir Charter y Stakeholders](#5-definir-charter-y-stakeholders)
6. [Risk Register (Wave R-360)](#6-risk-register-wave-r-360)
7. [Releases, Epics, Sprints y Backlog](#7-releases-epics-sprints-y-backlog)
8. [Sprint Planning con Velocity Monte Carlo](#8-sprint-planning-con-velocity-monte-carlo)
9. [Daily Scrum e Impedimentos](#9-daily-scrum-e-impedimentos)
10. [Quality Inspections y Defectos](#10-quality-inspections-y-defectos)
11. [Sprint Review y Retrospective](#11-sprint-review-y-retrospective)
12. [EVM y reportes de performance](#12-evm-y-reportes-de-performance)
13. [Cierre del proyecto y Lessons Learned](#13-cierre-del-proyecto-y-lessons-learned)
14. [Checklist diario y semanal del PM](#14-checklist-diario-y-semanal-del-pm)

---

## 1. ¿Qué hace un Gerente de Área en Sync?

Como `GERENTE_AREA`, eres el **Project Manager / Project Owner** de los proyectos dentro de tu Área. Es el rol más cargado operativamente: planeas, ejecutas, monitoreas y entregas.

### Tus responsabilidades clave

| Responsabilidad | Frecuencia | Dónde se hace |
|---|---|---|
| Crear proyectos en tu Área | Bajo demanda | Configuración → Proyectos |
| Generar y mantener el WBS | Al inicio + cambios | Detalle del proyecto |
| Definir Charter / Stakeholders / DoR / DoD | Al inicio | PMI → Charter / Stakeholders |
| Identificar y gestionar Risks | Continuo | PMI → Risks |
| Conducir Sprint Planning | Cada 2 semanas | Agile → Sprints |
| Daily Scrum standup | Diario | Agile → Daily Scrum |
| Gestionar impedimentos | Diario | Agile → Impediments |
| Monitorear EVM (CPI/SPI) | Semanal | PMI → EVM |
| Generar Status Reports | Semanal/Quincenal | PMI → Reports |
| Cerrar proyecto + Lessons Learned | Al final | PMI → Lessons Learned |

### Lo que NO te corresponde

- ❌ Crear Workspaces o invitar miembros (eso es ADMIN).
- ❌ Ver proyectos de otras Áreas (visibilidad limitada a tu Área).
- ❌ Aprobar Change Requests de alto impacto (eso es GERENCIA_GENERAL).
- ❌ Promover Lessons Learned a `WORKSPACE` o `ORG` (eso es GERENCIA_GENERAL).

---

## 2. Tu primer login y orientación

1. Login con tu correo corporativo. Tu ADMIN te asignó previamente a tu Gerencia + Área.
2. El **Dashboard** muestra tus proyectos activos (los que ves por jerarquía).
3. En el sidebar, verás los grupos: **Portafolio · Agile · PMI · Estrategia · Operación · Gestión**.

> 📸 **Captura sugerida:** `screenshots/20-dashboard-gerente-area.png`
>
> *Dashboard de Gerente de Área mostrando: tarjeta "Mis proyectos activos", "Próximos deadlines del Área", widget de impedimentos abiertos, brain insights sugeridos.*

---

## 3. Crear un nuevo proyecto

### Paso 1 · Ir a Proyectos

Sidebar → **Configuración** → **Proyectos** (o atajo desde el header con `+`).

> 📸 **Captura sugerida:** `screenshots/21-proyectos-listado.png`
>
> *Lista de proyectos del Área con filtros por status, manager, metodología.*

### Paso 2 · Click "Nuevo Proyecto"

Llena el formulario:

| Campo | Recomendación |
|---|---|
| **Nombre** | Descriptivo y específico. Ej: *"Migración SAP S/4HANA Avante 2026"*. |
| **Descripción** | 2-3 oraciones · contexto de negocio + alcance global. |
| **Metodología** | SCRUM (ágil puro) · PMI (waterfall plan-driven) · HYBRID (combinación, default). |
| **Workspace** | Auto-detectado de tu contexto. |
| **Área** | Auto-seleccionada (tu Área). |
| **Manager** | Tú (default) o delega a otro GERENTE_AREA. |
| **Start / End Date** | Estimadas (se refinan con el WBS). |
| **Presupuesto** | USD/MXN/etc. + currency. |

> 📸 **Captura sugerida:** `screenshots/22-nuevo-proyecto-form.png`
>
> *Formulario completo de creación con campos rellenados con un ejemplo real.*

Click **Crear**.

### Paso 3 · Project Definition Wizard (recomendado)

Inmediatamente después de crear, aparece el **Project Definition Trigger** (Wave P14):

> 📸 **Captura sugerida:** `screenshots/23-project-definition-wizard.png`
>
> *Modal del wizard con los 4 pasos: Vision, Success Criteria, Milestones, Approver.*

Llena los 4 pasos:

1. **Vision & Business Justification** — el "por qué" del proyecto (para Charter).
2. **Success Criteria** — 3-5 criterios verificables.
3. **Milestones principales** — hitos con fechas.
4. **Approver** — típicamente tu Gerente General.

El wizard genera automáticamente:

- Plantillas DoR/DoD según metodología.
- Communications Plan inicial.
- Stakeholders básicos sembrados.

---

## 4. Generar el WBS con Brain AI

El **Work Breakdown Structure** es la columna vertebral del proyecto. Sync tiene un generador AI que crea Fases → Epics → Historias → Tareas en segundos.

### Paso 1 · Acceder al WBS Generator

En el detalle del proyecto, click el botón **"Generar WBS con AI"**.

> 📸 **Captura sugerida:** `screenshots/24-wbs-generator-trigger.png`
>
> *Detalle del proyecto recién creado con el botón "Generar WBS con AI" destacado.*

### Paso 2 · Brain pregunta y propone

Brain te pide:

- **Descripción del proyecto** (auto-llenada del Charter).
- **Metodología y duración estimada**.
- **Equipo size aproximado** (opcional).

Tras ~10-15 segundos, propone:

> 📸 **Captura sugerida:** `screenshots/25-wbs-propuesto.png`
>
> *Tree-view del WBS propuesto con expandibles: Phase → Epic → Story → Task. Cada nivel con badges de storyPoints estimados.*

### Paso 3 · Revisar y aceptar

Revisa cada nivel. Puedes:

- **Editar** títulos individuales.
- **Eliminar** ramas que no apliquen.
- **Agregar** epics/stories manualmente.

Click **"Aceptar y crear"** → todo se persiste en BD con relaciones correctas.

### Bonus · Risk Register inicial

Wave P14b extiende el WBS Generator para producir también un **Risk Register completo** con riesgos heurísticos basados en patrones del dominio. Lo encontrarás listo en `PMI → Risks`.

---

## 5. Definir Charter y Stakeholders

### Charter

Sidebar → **PMI** → **Charter**.

Si completaste el wizard, ya está pre-llenado. Refina:

- **Vision** (1-2 párrafos).
- **Business Justification** (ROI, ahorros estimados).
- **Success Criteria** (5 max, binarios).
- **Milestones** con fechas.
- **Constraints** (recursos, tecnología, normativa).
- **Assumptions** explícitas.

> 📸 **Captura sugerida:** `screenshots/26-charter-completo.png`
>
> *Charter completo con secciones colapsables y botón "Solicitar aprobación al GG" destacado.*

Click **"Solicitar aprobación"** → tu Gerencia General recibe notificación.

### Stakeholders Register

Sidebar → **PMI** → **Stakeholders**.

Agrega cada interesado:

- **Nombre / cargo / organización**.
- **Power** (1-3) — capacidad de influir.
- **Interest** (1-3) — qué tan involucrado está.

Sync clasifica automáticamente en la matriz 3×3:

| Power × Interest | Estrategia |
|---|---|
| Alto × Alto | **Manage Closely** — reuniones regulares, decisiones conjuntas |
| Alto × Bajo | **Keep Satisfied** — informes periódicos, evitar fricción |
| Bajo × Alto | **Keep Informed** — newsletter mensual, transparencia |
| Bajo × Bajo | **Monitor** — actualización solo si cambia su scope |

> 📸 **Captura sugerida:** `screenshots/27-stakeholders-matriz.png`
>
> *Matriz Mendelow 3×3 con stakeholders posicionados como dots, con tooltip mostrando engagement strategy.*

---

## 6. Risk Register (Wave R-360)

Sidebar → **PMI** → **Risks** del proyecto activo.

### Paso 1 · Validar risks heurísticos de Brain

Si usaste el WBS Generator, ya hay risks sembrados por Brain. Aparecen en el **banner "Pendientes de validación"**:

> 📸 **Captura sugerida:** `screenshots/28-risks-pendientes-brain.png`
>
> *Banner amarillo arriba listando 5-10 risks heurísticos con dos botones por risk: "Promover" / "Descartar".*

Para cada uno:

- **Promover al register** si lo confirmas.
- **Descartar** si no aplica a tu contexto.

### Paso 2 · Crear risks manuales

Click **"Nuevo Riesgo"**. Define:

- **Title / description**.
- **Probability** (1-5).
- **Impact** (1-5).
- **Sync calcula automáticamente:**
  - **Score** = P × I.
  - **Severity tier**: LOW (<6) · MEDIUM (6-10) · HIGH (11-15) · CRITICAL (16-25).
- **Mitigation actions** (plan B preventivo).
- **Owner** (responsable de monitorear).
- **Trigger conditions** (qué activaría el riesgo).
- **Task vinculada** (opcional) — si está atada a una entrega específica.

> 📸 **Captura sugerida:** `screenshots/29-nuevo-risk-form.png`
>
> *Formulario "Nuevo Riesgo" con campos llenos + matriz 5×5 mostrando dónde cae visualmente.*

### Paso 3 · Plan de acciones correctivas

Cada risk acepta múltiples **Risk Actions**:

- Tipo: PREVENT / DETECT / RESPOND.
- Owner + deadline.
- Status: PLANNED / IN_PROGRESS / DONE.

> 📸 **Captura sugerida:** `screenshots/30-risk-actions-plan.png`
>
> *Detalle de un risk con tabla de Risk Actions y botón "+ Acción correctiva".*

---

## 7. Releases, Epics, Sprints y Backlog

El orden Scrum top-down: **Releases → Epics → Sprints → Backlog (Stories)**.

### Paso 1 · Crear el Release

Sidebar → **Agile** → **Releases**.

- **Name** (ej. "R1.0 MVP Migración SAP").
- **Target date**.
- **Scope description**.

### Paso 2 · Crear Epics

Sidebar → **Agile** → **Epics**.

Cada Epic representa un bloque grande de trabajo (1-3 meses):

- **Name + description**.
- **Release** al que pertenece.
- **Status** (default: PLANNED).

> 📸 **Captura sugerida:** `screenshots/31-epics-listado.png`
>
> *Lista de Epics agrupadas por Release con progreso de stories cerradas vs total.*

### Paso 3 · Crear Sprints

Sidebar → **Agile** → **Sprints**.

Llena:

- **Sprint Goal** (OBLIGATORIO · Scrum compliance Wave P11).
- **Start / End date** (2 semanas típico).
- **Capacity** (storyPoints o horas).
- **Brain sugiere capacity** basado en velocity histórica P50.

> 📸 **Captura sugerida:** `screenshots/32-nuevo-sprint-velocity.png`
>
> *Modal "Nuevo Sprint" con el botón "Sugerir capacity con Velocity Monte Carlo" y los valores P10/P50/P90 desplegados.*

### Paso 4 · Llenar el Backlog

Sidebar → **Agile** → **Backlog**.

Grid jerárquico Epic → Story. Drag-drop:

- Mueve Stories entre Epics.
- Asigna Stories al Sprint actual o futuros.
- Prioriza con drag-drop vertical.

> 📸 **Captura sugerida:** `screenshots/33-backlog-grid-jerarquico.png`
>
> *Backlog en grid mostrando Epics colapsables con sus Stories anidadas, badges de storyPoints y status, lateral con "Sprint Backlog" del Sprint actual.*

---

## 8. Sprint Planning con Velocity Monte Carlo

### Paso 1 · Abrir Sprint Planning

En el Sprint creado, click **"Iniciar Sprint Planning"**.

Brain analiza la velocity histórica de tu equipo (últimos 3 sprints) y simula 10,000 escenarios Monte Carlo. Te muestra:

- **P10**: si vas a estar abajo, capacity sería esta.
- **P50**: lo más probable (median).
- **P90**: si tienes suerte, podrás hasta esto.

> 📸 **Captura sugerida:** `screenshots/34-monte-carlo-capacity.png`
>
> *Brain sugiriendo capacity con el histograma SVG mostrando distribución y línea vertical en P50 destacada.*

### Paso 2 · Arrastrar Stories al Sprint

Cada Story que arrastres muestra:

- ✅ Verde si cumple **Definition of Ready (DoR)** completo.
- ⚠️ Amarillo si DoR incompleto — puedes arrastrar pero te advierte.

> 📸 **Captura sugerida:** `screenshots/35-sprint-planning-dnd.png`
>
> *Sprint Planning con dos columnas: Backlog (izquierda) y Sprint Backlog (derecha) · Stories arrastradas con badges de DoR status.*

### Paso 3 · Start Sprint

Cuando el Sprint Backlog está lleno y validado:

Click **"Start Sprint"** → automation engine dispara `sprint.started` y los USERs reciben notificación.

---

## 9. Daily Scrum e Impedimentos

### Daily Scrum

Sidebar → **Agile** → **Daily Scrum**.

Widget en vivo con 3 columnas por miembro:

| Did | Will | Blockers |
|---|---|---|

> 📸 **Captura sugerida:** `screenshots/36-daily-scrum-widget.png`
>
* Daily Scrum mostrando 4-5 miembros del equipo con sus respuestas, dos con badges rojos "Blocker" destacados.*

### Promover blocker a Impediment

Si un USER reporta un blocker, click el botón rojo **"Promote to Impediment"**:

- **Severity**: LOW / MEDIUM / HIGH / CRITICAL.
- **Owner** (típicamente tú).
- **Deadline** sugerido por severity.

> 📸 **Captura sugerida:** `screenshots/37-impediment-creado.png`
>
> *Modal "Convertir a Impediment" con severity slider y owner picker.*

### Tracker de Impediments

Sidebar → **Agile** → **Impediments**.

Workflow: OPEN → IN_PROGRESS → RESOLVED | ESCALATED.

Los HIGH/CRITICAL aparecen en el dashboard de tu Gerente General automáticamente.

---

## 10. Quality Inspections y Defectos

Wave P18-A · PMI Quality Management.

### Crear Quality Inspection

Sidebar → **PMI** → **Quality** → tab **Inspections**.

Click **"Nueva inspección"**. Selecciona plantilla según fase del proyecto:

- Code Review.
- UAT (User Acceptance Testing).
- Performance Test.
- Security Audit.
- Custom checklist.

Cada inspection tiene N criterios verificables (binarios: pasa / no pasa).

> 📸 **Captura sugerida:** `screenshots/38-quality-inspection-checklist.png`
>
> *Inspección con checklist de criterios marcables, progreso % cumplimiento, owner + due date.*

### Defect tracking

Tab **Defects** dentro de PMI → Quality.

Cuando un USER (o tú) reporta un defecto:

- **Severity**: BLOCKER / CRITICAL / MAJOR / MINOR / TRIVIAL.
- **Status**: NEW → CONFIRMED → IN_PROGRESS → RESOLVED → VERIFIED.
- **Linked task** (opcional).

Los BLOCKER/CRITICAL bloquean el cierre del Sprint si DoD HARD enforcement está activo.

---

## 11. Sprint Review y Retrospective

### Sprint Review (cierre formal)

Al final del sprint, en Sidebar → **Agile** → **Sprints** → click **"Cerrar Sprint"**.

Llena:

- **Sprint Review notes** — qué se demostró.
- **Demo URL** (Loom, YouTube, etc.).
- **Velocity actual** (auto-calculada).
- **Sprint Goal achievement** (% logrado).

> 📸 **Captura sugerida:** `screenshots/39-sprint-review-form.png`
>
> *Modal "Cerrar Sprint" con campos de review notes, demo URL, velocity calculada vs estimada.*

### Retrospective

Sidebar → **Agile** → **Retrospective** (HU-9.9).

3 columnas + Action items:

| Liked | Lacked | Learned | Action Items |
|---|---|---|---|

Cada miembro agrega items. Voto +1 a items resonantes.

> 📸 **Captura sugerida:** `screenshots/40-retrospective-board.png`
>
> *Tablero de retrospective con sticky notes coloreadas por columna y votos visibles.*

Los Action Items con más votos se promueven automáticamente a **Improvement Items** (kanban cross-sprint en Agile → Improvements).

---

## 12. EVM y reportes de performance

### Capturar EVM Snapshot

Sidebar → **PMI** → **EVM**.

Captura semanal (manual o cron):

- **PV** (Planned Value) — esperado al día de hoy.
- **EV** (Earned Value) — efectivamente entregado.
- **AC** (Actual Cost) — gastado real.

Sync calcula automáticamente:

- **CPI** = EV/AC. Verde si ≥1.
- **SPI** = EV/PV. Verde si ≥1.
- **EAC** (Estimate at Completion).
- **VAC** (Variance at Completion).

> 📸 **Captura sugerida:** `screenshots/41-evm-curva-s.png`
>
> *Curva-S del proyecto con 3 líneas PV/EV/AC + tabla histórica de snapshots + KPIs en cards arriba.*

### Generar Status Report

Sidebar → **PMI** → **Reports**.

Tipos:

- **Status Report semanal** (HTML print-friendly → PDF).
- **Final Report** (XLSX multi-hoja al cierre).

> 📸 **Captura sugerida:** `screenshots/42-status-report-html.png`
>
> *Status Report renderizado con secciones: Resumen, KPIs, Milestones, Risks, Changes, Brief AI.*

---

## 13. Cierre del proyecto y Lessons Learned

### Capturar Lessons Learned

Antes de cerrar el proyecto, captura mínimo 3 lessons.

Sidebar → **PMI** → **Lessons Learned**.

Click **"Nueva lesson"**:

- **Título / descripción**.
- **Categoría** (8 disponibles: Technical / Process / People / Communications / Risk / Quality / Procurement / Stakeholder).
- **Visibilidad inicial**: PROJECT.

> 📸 **Captura sugerida:** `screenshots/43-lessons-learned-form.png`
>
> *Formulario de Lessons Learned con categoría selector y editor markdown.*

Tu Gerencia General decide si promueve a WORKSPACE u ORG.

### Cerrar el proyecto

En el detalle del proyecto, cambia status a **CLOSED**.

Sync ejecuta automáticamente:

- Snapshot final de EVM.
- Genera Final Report XLSX.
- Audit event `project.closed`.
- Notifica a stakeholders.

---

## 14. Checklist diario y semanal del PM

### Diario (15 min · 9am)

```
☐ Agile → Daily Scrum · facilitar la sesión
☐ Agile → Impediments · revisar HIGH/CRITICAL
☐ Notificaciones · responder mentions
☐ Avante Brain AI → Project Manager AI · revisar alertas
```

### Semanal (45 min · viernes)

```
☐ PMI → EVM · capturar snapshot
☐ PMI → Reports · generar Status Report
☐ Agile → Backlog · refinar para próximo sprint
☐ PMI → Risks · revisar matriz, agregar/cerrar
☐ PMI → Lessons Learned · capturar 1-2 del sprint
```

### Cada sprint (al cierre, 2h)

```
☐ Agile → Sprints · Cerrar Sprint + capturar Sprint Review
☐ Agile → Retrospective · facilitar la sesión
☐ Brain AI → Strategist AI · revisar insights cross-project
☐ Agile → Sprints · Sprint Planning del siguiente
```

---

## Recursos adicionales

- **Manual del Gerente General:** [`manual-gerencia-general.md`](./manual-gerencia-general.md) — para entender qué espera tu jefe directo.
- **Manual del Agente:** [`manual-agente.md`](./manual-agente.md) — para entender el día a día de tu equipo.
- **Manual general:** [`flujo-creacion-proyecto.md`](./flujo-creacion-proyecto.md) — referencia completa.

## Soporte

Para bugs, mejoras o dudas técnicas, contacta a tu ADMIN del Workspace.
