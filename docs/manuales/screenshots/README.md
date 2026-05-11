# Capturas de Pantalla · Manuales Sync

Esta carpeta contiene las capturas referenciadas por los manuales en `docs/manuales/`.

## Convención de nombres

`NN-descripcion-corta.png`

donde `NN` es un número secuencial:

| Rango | Manual |
|---|---|
| `01-19` | Manual Gerencia General |
| `20-49` | Manual Gerente de Área |
| `50-69` | Manual Agente |

## Cómo tomar las capturas

1. **Login con el rol correspondiente** (usa el Debug Role Switcher si estás como SUPER_ADMIN).
2. **Resolución recomendada:** 1440×900 o superior. Usa zoom 100%.
3. **Browser:** Chrome/Edge en modo claro (para que el contraste sea óptimo). Para capturas de modo oscuro, alterna y agrega sufijo `-dark`.
4. **Captura solo el área relevante** — no la pantalla completa con barra del SO.
5. **Datos sensibles:** usa workspace de POC con datos demo. NO captures datos reales de Avante ni credenciales.

## Lista completa de capturas requeridas

### Manual · Gerencia General (19 capturas)

| Archivo | Qué debe mostrar |
|---|---|
| `01-login-screen.png` | Pantalla de login con email/password + botón SSO. |
| `02-workspace-switcher.png` | Header con switcher de workspace desplegado. |
| `03-sidebar-portafolio-expandido.png` | Sidebar con grupo Portafolio expandido. |
| `04-portfolio-dashboard.png` | Vista Ejecutiva del Portafolio con los 4 paneles. |
| `05-risk-matrix-drilldown.png` | Risk Matrix con una celda seleccionada y side panel. |
| `06-objetivos-listado.png` | Lista de Goals con filtros. |
| `07-nuevo-objetivo-form.png` | Formulario "Nuevo Objetivo" rellenado. |
| `08-keyresults-progress.png` | Goal con 3 KeyResults y barras de progreso. |
| `09-kpis-proyectos-listado.png` | Tabla KPIs por proyecto con CPI/SPI. |
| `10-evm-curve-s.png` | Curva-S EVM consolidada del portafolio. |
| `11-allocation-heatmap.png` | Heatmap allocation cross-project. |
| `12-change-requests-listado.png` | Lista de CRs con status "Under review". |
| `13-cr-detalle-impacto.png` | Detalle CR con impacto 4D + historial. |
| `14-lessons-learned-listado.png` | Lista de Lessons con filtros por categoría. |
| `15-strategist-ai-home.png` | Strategist AI con 3 secciones de insights. |
| `16-brief-ejecutivo.png` | Brief ejecutivo LLM generado + CTA. |
| `17-autopilot-propuesta.png` | Auto-Pilot propuesta con preview before/after. |
| `18-status-report-pdf.png` | Status Report print-friendly primera página. |

### Manual · Gerente de Área (24 capturas)

| Archivo | Qué debe mostrar |
|---|---|
| `20-dashboard-gerente-area.png` | Dashboard con tarjetas de proyectos activos, deadlines, impediments. |
| `21-proyectos-listado.png` | Lista de proyectos del Área con filtros. |
| `22-nuevo-proyecto-form.png` | Formulario "Nuevo Proyecto" rellenado. |
| `23-project-definition-wizard.png` | Wizard con 4 pasos Vision/Criteria/Milestones/Approver. |
| `24-wbs-generator-trigger.png` | Detalle del proyecto con botón "Generar WBS con AI" destacado. |
| `25-wbs-propuesto.png` | Tree-view del WBS propuesto con expandibles. |
| `26-charter-completo.png` | Charter con secciones + botón "Solicitar aprobación". |
| `27-stakeholders-matriz.png` | Matriz Mendelow 3×3 con stakeholders. |
| `28-risks-pendientes-brain.png` | Banner con risks heurísticos pendientes de validar. |
| `29-nuevo-risk-form.png` | Formulario "Nuevo Riesgo" con matriz 5×5. |
| `30-risk-actions-plan.png` | Detalle de risk con tabla de Risk Actions. |
| `31-epics-listado.png` | Lista de Epics agrupadas por Release. |
| `32-nuevo-sprint-velocity.png` | Modal nuevo sprint con Velocity Monte Carlo. |
| `33-backlog-grid-jerarquico.png` | Backlog con Epic→Story drag-drop. |
| `34-monte-carlo-capacity.png` | Brain sugiriendo capacity con histograma SVG. |
| `35-sprint-planning-dnd.png` | Sprint Planning con DnD Backlog → Sprint Backlog. |
| `36-daily-scrum-widget.png` | Daily Scrum con miembros del equipo y blockers. |
| `37-impediment-creado.png` | Modal "Convertir a Impediment". |
| `38-quality-inspection-checklist.png` | Inspección con checklist + progreso. |
| `39-sprint-review-form.png` | Modal "Cerrar Sprint" con review notes. |
| `40-retrospective-board.png` | Retrospective con 3 columnas + Action Items. |
| `41-evm-curva-s.png` | Curva-S del proyecto con PV/EV/AC. |
| `42-status-report-html.png` | Status Report renderizado. |
| `43-lessons-learned-form.png` | Formulario "Nueva Lesson Learned". |

### Manual · Agente (20 capturas)

| Archivo | Qué debe mostrar |
|---|---|
| `50-invitation-email.png` | Email de invitación con botón aceptar. |
| `51-aceptar-invitacion.png` | Pantalla de aceptación con campos. |
| `52-dashboard-agente.png` | Dashboard con cards: tareas hoy, deadlines, notificaciones, Brain insights. |
| `53-tareas-lista.png` | Vista de Tareas con filtros laterales. |
| `54-task-detail-modal.png` | Modal lateral con detalle completo de tarea. |
| `55-timer-en-vivo.png` | Tarea con timer corriendo. |
| `56-timesheets-semanal.png` | Calendario semanal con bloques de tiempo. |
| `57-daily-scrum-mi-fila.png` | Daily Scrum con la fila del usuario editable. |
| `58-promover-blocker.png` | Modal "Promover blocker a Impediment". |
| `59-impedimento-nuevo.png` | Formulario nuevo Impediment. |
| `60-nuevo-defecto.png` | Formulario nuevo Defect. |
| `61-mention-autocomplete.png` | Editor con `@` activado autocomplete. |
| `62-whiteboard-coedit.png` | Whiteboard con co-edit en tiempo real. |
| `63-doc-collaborative-edit.png` | Editor de Docs con 2 usuarios editando. |
| `64-lesson-learned-form.png` | Formulario Lesson Learned. |
| `65-vistas-switcher.png` | Top bar con switcher de vistas. |
| `66-notifications-inbox.png` | Inbox de notificaciones con filtros. |
| `67-brain-insights-personal.png` | Brain Insights con forecasts/recommendations/anomalies. |
| `68-writer-ai-suggest.png` | Writer AI con texto coloquial y sugerencia formal. |
| `69-command-palette.png` | Command Palette abierto con resultados. |

## Workflow recomendado

1. Asegúrate de tener un workspace de **POC con datos demo realistas** (proyectos en distintas fases, tareas en diferentes estados, lessons learned, risks, etc.).
2. Toma capturas en una sola sesión por rol — más rápido que cambiar de rol.
3. Edita las capturas para:
   - Borrar/blurrear nombres reales si no son ficticios.
   - Resaltar áreas de interés con flechas o cajas rojas (opcional · usar herramientas como Snagit, Greenshot, ShareX).
4. Optimiza el tamaño de archivo (`pngquant`, `tinypng.com`) — los manuales se cargan rápido en el repo.
5. Comprueba que el archivo apunte exactamente al nombre referenciado en el `.md` (es case-sensitive en Linux).

## Datos demo recomendados

Para tener buenas capturas, el workspace de POC debe tener:

- **3-5 proyectos** en distintos estados (PLANNING, IN_PROGRESS, ON_HOLD, CLOSED).
- **2-3 metodologías** representadas (SCRUM, PMI, HYBRID).
- **2-3 sprints** completados con velocity histórica para que Monte Carlo funcione bien.
- **10-15 risks** con distintas severidades para llenar la matriz 5×5.
- **5-10 stakeholders** distribuidos en la matriz Power × Interest.
- **3-5 change requests** en distintos estados.
- **10+ lessons learned** en diferentes categorías y visibilidades.
- **5+ usuarios** en distintos roles para mostrar collaboration.

## Soporte

Si una captura no quedó bien o necesita reemplazo, abre un PR sobre `docs/manual-usuario-flujo-roles` o un follow-up con tag `docs/screenshots`.
