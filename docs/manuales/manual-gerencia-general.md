# Manual de Usuario · Gerencia General

> **Rol:** `GERENCIA_GENERAL`
> **Plataforma:** Sync (FollowupGantt) — R4.0 GA · 2026-05-11
> **Audiencia:** Gerentes Generales y Directores de Gerencia con visibilidad sobre todos los proyectos de un Workspace.

📁 **Capturas de pantalla:** las imágenes referenciadas con `📸 Captura sugerida:` se ubican en [`./screenshots/`](./screenshots/). Si aún no las ves, consulta [`screenshots/README.md`](./screenshots/README.md) para la guía de cómo tomarlas paso a paso.

---

## Índice

1. [¿Qué hace un Gerente General en Sync?](#1-qué-hace-un-gerente-general-en-sync)
2. [Tu primer login](#2-tu-primer-login)
3. [Panorama: tu dashboard ejecutivo](#3-panorama-tu-dashboard-ejecutivo)
4. [Definir la estrategia · OKRs y Goals](#4-definir-la-estrategia--okrs-y-goals)
5. [Monitorear el portafolio](#5-monitorear-el-portafolio)
6. [Aprobar Change Requests (CCB)](#6-aprobar-change-requests-ccb)
7. [Validar Lessons Learned](#7-validar-lessons-learned)
8. [Usar Brain AI Strategist](#8-usar-brain-ai-strategist)
9. [Reportes para junta directiva](#9-reportes-para-junta-directiva)
10. [Checklist semanal del Gerente General](#10-checklist-semanal-del-gerente-general)

---

## 1. ¿Qué hace un Gerente General en Sync?

Como `GERENCIA_GENERAL`, tu visibilidad alcanza **todos los proyectos del Workspace activo** (no solo los de tu Área directa). Eres el rol que conecta la **estrategia corporativa** con la **ejecución operativa**.

### Tus responsabilidades clave

| Responsabilidad | Frecuencia | Dónde se hace |
|---|---|---|
| Crear/actualizar OKRs estratégicos | Trimestral | Estrategia → Objetivos |
| Monitorear KPIs cross-project | Semanal | Portafolio → Vista ejecutiva |
| Aprobar Change Requests de alto impacto | Bajo demanda | PMI → Change Requests |
| Validar Lessons Learned para promover | Mensual | PMI → Lessons Learned |
| Revisar Risk Matrix consolidada | Quincenal | Portafolio → Riesgos consolidados |
| Aplicar Brain Auto-Pilot recomendaciones | Semanal | Brain AI → Strategist |
| Generar Executive Briefing para junta | Mensual | Estrategia → Reportes ejecutivos |

### Lo que NO te corresponde

- ❌ Crear Workspaces (eso es ADMIN/SUPER_ADMIN).
- ❌ Invitar usuarios o cambiar sus roles (eso es ADMIN).
- ❌ Configurar SSO, Stripe billing, retention policies (eso es SUPER_ADMIN).
- ❌ Editar tareas operativas día a día (eso lo hacen los USERs / GERENTE_AREA).

---

## 2. Tu primer login

1. Abre `https://followup-gantt.vercel.app` (o la URL prod que te compartió tu ADMIN).
2. Ingresa tu correo corporativo y contraseña.
3. Si tu organización tiene SSO/SAML configurado, click **"Continuar con Microsoft / Google / Okta"** (según corresponda).

> 📸 **Captura sugerida:** `screenshots/01-login-screen.png`
>
> *Captura la pantalla de login mostrando los inputs de email/password y el botón SSO si aplica.*

Tras el login, llegas al Dashboard personal. En la esquina superior izquierda verás tu nombre y el Workspace activo:

> 📸 **Captura sugerida:** `screenshots/02-workspace-switcher.png`
>
> *Captura mostrando el switcher de workspace en el header con el menú desplegado.*

---

## 3. Panorama: tu dashboard ejecutivo

### Paso 1 · Accede al Portafolio

En el sidebar izquierdo, click en el grupo **Portafolio** → **Vista ejecutiva**.

> 📸 **Captura sugerida:** `screenshots/03-sidebar-portafolio-expandido.png`
>
> *Sidebar con el grupo Portafolio expandido mostrando: Vista ejecutiva, Dashboards KPI, KPIs de Proyectos, Riesgos consolidados, Costos & EVM, Dependencias programa, Allocation equipo.*

### Paso 2 · Lee los 4 paneles principales

La Vista Ejecutiva muestra cuatro cuadrantes:

| Panel | Qué interpreta |
|---|---|
| **KPIs Consolidados** | CPI/SPI del portafolio entero. CPI <1 = sobrecosto, SPI <1 = retraso. |
| **Velocity Monte Carlo** | P10/P50/P90 de capacidad estimada de los próximos 3 sprints. Útil para forecast de delivery. |
| **Risk Matrix 5×5** | Mapa probabilidad × impacto con todos los riesgos cross-project. Las celdas rojas son tu prioridad. |
| **Allocation Heatmap** | Carga de tu gente por semana. Celdas rojas indican overloaded (>100%). |

> 📸 **Captura sugerida:** `screenshots/04-portfolio-dashboard.png`
>
> *Captura completa de Portafolio → Vista ejecutiva mostrando los 4 paneles.*

### Paso 3 · Drill-down a un proyecto problemático

Click en cualquier celda roja de la Risk Matrix o en una fila roja del Allocation Heatmap. Te lleva al detalle del proyecto/usuario específico.

> 📸 **Captura sugerida:** `screenshots/05-risk-matrix-drilldown.png`
>
> *Captura de la Risk Matrix con una celda seleccionada y el side panel mostrando los riesgos individuales que la componen.*

---

## 4. Definir la estrategia · OKRs y Goals

### Paso 1 · Ir a Objetivos

Sidebar → **Estrategia** → **Objetivos**.

> 📸 **Captura sugerida:** `screenshots/06-objetivos-listado.png`
>
> *Lista de Goals existentes con filtros por proyecto, owner, status.*

### Paso 2 · Crear un Goal estratégico

Click **"Nuevo Objetivo"**. Llena:

- **Título:** verbo activo + métrica + plazo. Ej: *"Reducir time-to-market 30% antes de fin 2026"*.
- **Descripción:** contexto de negocio (por qué importa).
- **Owner:** típicamente tú mismo o un GERENTE_AREA delegado.
- **Proyecto:** opcional. Si lo dejas vacío, queda como **Goal corporativo** (cross-project).
- **Target Date:** fecha objetivo.

> 📸 **Captura sugerida:** `screenshots/07-nuevo-objetivo-form.png`
>
> *Formulario "Nuevo Objetivo" con los campos rellenados con un ejemplo realista.*

### Paso 3 · Agregar KeyResults

Cada Goal necesita entre **2 y 5 KeyResults** medibles. Click **"+ KeyResult"** dentro del Goal:

| Tipo de métrica | Cuándo usarla | Ejemplo |
|---|---|---|
| `PERCENT` | Cobertura, satisfacción, porcentajes | "85% de uptime mensual" |
| `NUMERIC` | Cantidades absolutas con unidad | "$1.2M ahorrado en licencias" |
| `BOOLEAN` | Hito binario (logrado/no logrado) | "Migración SAP completada" |
| `TASKS_COMPLETED` | Vinculado a tareas Sync | "Cerrar 40 tareas del Sprint X" |

> 📸 **Captura sugerida:** `screenshots/08-keyresults-progress.png`
>
> *Goal con 3 KeyResults mostrando barras de progreso, current value vs target value, y porcentaje alcanzado.*

### Paso 4 · Vincular KeyResults a tareas (opcional pero potente)

Si elegiste `TASKS_COMPLETED`, abre el KeyResult y agrega tareas. Sync recalcula el progreso automáticamente cuando los USERs cierran las tareas.

---

## 5. Monitorear el portafolio

### Vista de salud · KPIs por Proyecto

Sidebar → **Portafolio** → **KPIs de Proyectos**.

Cada proyecto se lista con:

- **CPI** (Cost Performance Index) — verde si ≥1.0
- **SPI** (Schedule Performance Index) — verde si ≥1.0
- **% avance**
- **# tareas DONE / total**
- **Velocity sprint actual vs P50 histórico**

> 📸 **Captura sugerida:** `screenshots/09-kpis-proyectos-listado.png`
>
> *Tabla ordenable de KPIs por proyecto con semáforos visuales de CPI/SPI.*

### Vista financiera · Costos & EVM

Sidebar → **Portafolio** → **Costos & EVM**.

Curva-S consolidada del portafolio con tres líneas:

- **PV** (Planned Value) — verde
- **EV** (Earned Value) — azul
- **AC** (Actual Cost) — rojo

Cuando AC > EV, hay sobrecosto. Cuando EV < PV, hay retraso.

> 📸 **Captura sugerida:** `screenshots/10-evm-curve-s.png`
>
> *Curva-S EVM del portafolio con las 3 líneas + tabla histórica abajo.*

### Vista de capacidad · Allocation cross-project

Sidebar → **Portafolio** → **Allocation equipo**.

Heatmap user × week. Identifica:

- 🟢 Verde: 0-80% (underutilized — pueden tomar más trabajo).
- 🟡 Amarillo: 80-100% (óptimo).
- 🔴 Rojo: >100% (overloaded — risk de burnout o deadlines incumplidos).

Pasa el mouse sobre cualquier celda roja para ver los proyectos que la componen.

> 📸 **Captura sugerida:** `screenshots/11-allocation-heatmap.png`
>
> *Heatmap allocation con celdas rojas visibles y tooltip de drill-down.*

---

## 6. Aprobar Change Requests (CCB)

Cualquier cambio significativo en alcance, cronograma, costo o calidad debe pasar por **Change Control Board**. Como Gerente General eres el aprobador típico.

### Paso 1 · Ver CRs pendientes

Sidebar → **PMI** → **Change Requests**. Filtra por status **"Under review"**.

> 📸 **Captura sugerida:** `screenshots/12-change-requests-listado.png`
>
> *Lista filtrada por status Under Review mostrando título, proyecto, impacto 4D resumido, submitter.*

### Paso 2 · Revisar impacto 4D

Click en el CR. Verás cuatro tarjetas:

| Dimensión | Qué evaluar |
|---|---|
| **Scope** | ¿Qué se agrega/quita? ¿Afecta el Charter? |
| **Schedule** | ¿Cuántos días adicionales? ¿Mueve milestones? |
| **Cost** | ¿USD adicional? ¿Pasa el umbral de presupuesto? |
| **Quality** | ¿Cambia los Acceptance Criteria? ¿Reduce DoD? |

> 📸 **Captura sugerida:** `screenshots/13-cr-detalle-impacto.png`
>
> *Detalle del CR con las 4 tarjetas de impacto + historial de comentarios.*

### Paso 3 · Decidir

Tienes 3 botones:

- ✅ **Aprobar** — el CR se materializa, se actualiza el proyecto.
- ❌ **Rechazar** — el CR se cierra sin aplicar.
- ⏸️ **Diferir** — vuelve al backlog, requiere más información.

Cada decisión genera un audit event y notifica al submitter.

---

## 7. Validar Lessons Learned

Los GERENTE_AREA y USERs capturan lessons al nivel `PROJECT` durante la ejecución. Tú decides cuáles se promueven a `WORKSPACE` (visibilidad cross-project) o `ORG` (knowledge base permanente).

### Paso 1 · Filtrar lessons del workspace

Sidebar → **PMI** → **Lessons Learned**. Filtra por **Visibilidad: PROJECT**.

> 📸 **Captura sugerida:** `screenshots/14-lessons-learned-listado.png`
>
> *Lista de lessons con filtros por categoría (8 categorías PMBOK), visibilidad, fecha.*

### Paso 2 · Promover una lesson valiosa

Click en una lesson útil → botón **"Promover a WORKSPACE"** o **"Promover a ORG"**.

> 📌 **Tip:** promueve lessons que:
> - Hayan ocurrido en 2+ proyectos (patrón repetible).
> - Sean accionables (no solo descriptivas).
> - Tengan categoría clara (Technical / Process / People / etc.).

---

## 8. Usar Brain AI Strategist

Brain AI Strategist es tu herramienta más potente. Analiza **cross-project** y detecta cosas que un humano tardaría horas en encontrar.

### Paso 1 · Abrir el Strategist

Sidebar → **Avante Brain AI** (icono Sparkles) → tab **Strategist AI**.

> 📸 **Captura sugerida:** `screenshots/15-strategist-ai-home.png`
>
> *Pantalla principal del Strategist con 3 secciones: Resource Contention, Dependency Conflicts, Reusable Lessons.*

### Paso 2 · Interpretar las 3 secciones

| Sección | Qué te dice |
|---|---|
| **Resource Contention** | Usuarios sobreasignados en N proyectos a la vez. Brain sugiere reasignar al menos cargado. |
| **Dependency Conflicts** | Cross-project deps con riesgo de retraso. Brain identifica el camino crítico. |
| **Reusable Lessons** | Patrones repetidos en lessons learned que merecen ser plantillas/proceso. |

Cada insight tiene:

- **Severity** (HIGH / MEDIUM / LOW).
- **Rationale** explicando el "por qué".
- **Recommended actions** accionables.

### Paso 3 · Generar Brief Ejecutivo para junta directiva

Click el botón **"Generar Brief Ejecutivo"** arriba a la derecha.

Brain produce un texto narrativo de ~300-500 palabras listo para presentar:

- Resumen ejecutivo del portafolio.
- Top 3 riesgos del mes.
- Top 3 oportunidades detectadas.
- Llamada a acción específica.

Click **"Copiar"** para pegarlo en tu email/slides.

> 📸 **Captura sugerida:** `screenshots/16-brief-ejecutivo.png`
>
> *Card con el brief LLM generado, key findings en bullets y la CTA destacada.*

### Paso 4 · Aplicar Auto-Pilot (si tu rol lo permite)

Como `GERENCIA_GENERAL`, tienes permiso para **Aplicar** las propuestas del Auto-Pilot.

Sidebar → **Estrategia** → **Brain Auto-Pilot**.

Cada propuesta muestra preview antes/después:

> 📸 **Captura sugerida:** `screenshots/17-autopilot-propuesta.png`
>
> *Card de Auto-Pilot con preview before/after en dos columnas, badge de confidence, botón Aplicar.*

Click **"Aplicar"** → ejecuta el cambio en transacción Prisma. Si te arrepientes, ve al "Historial" y click **"Revertir"** (válido por 24h).

---

## 9. Reportes para junta directiva

### Status Report mensual

Sidebar → **Estrategia** → **Reportes ejecutivos** → **"Generar Status Report"**.

Sync genera HTML print-friendly listo para PDF con:

- Resumen ejecutivo del mes.
- KPIs consolidados (CPI/SPI/avance).
- Top milestones cumplidos vs faltantes.
- Top risks abiertos.
- Cambios aprobados / pendientes.
- Brief ejecutivo Brain AI (opcional).

> 📸 **Captura sugerida:** `screenshots/18-status-report-pdf.png`
>
> *Status Report renderizado en HTML print-friendly (primera página visible).*

### Final Report al cierre de proyecto

Cuando un proyecto cambia a status `CLOSED`, el GERENTE_AREA puede generar el Final Report (XLSX multi-hoja). Tú lo valida y se lo envías a stakeholders externos si aplica.

---

## 10. Checklist semanal del Gerente General

Imprimible / pinable en pared:

```
☐ Lunes 9am · Portafolio → Vista ejecutiva (15 min)
   ↳ ¿KPIs en verde? ¿Alguna celda roja nueva?

☐ Lunes 10am · Estrategia → Objetivos
   ↳ Avance OKRs vs target date. ¿Algún KR en rojo?

☐ Miércoles · PMI → Change Requests
   ↳ Revisar CRs en "Under review" y decidir.

☐ Jueves · Brain AI → Strategist
   ↳ Revisar insights nuevos. Aplicar Auto-Pilot si aplica.

☐ Viernes · Estrategia → Reportes ejecutivos
   ↳ Generar Status Report si toca cierre de semana.

☐ Último día del mes · Brain AI → "Generar Brief Ejecutivo"
   ↳ Compartir con junta directiva.
```

---

## Recursos adicionales

- **Manual del Gerente de Área:** [`manual-gerente-area.md`](./manual-gerente-area.md) — para entender cómo trabajan tus PMs.
- **Manual del Agente:** [`manual-agente.md`](./manual-agente.md) — para entender el día a día operativo.
- **Manual general por roles:** [`flujo-creacion-proyecto.md`](./flujo-creacion-proyecto.md) — referencia completa.

## Soporte

Si encuentras un bug o tienes una sugerencia de mejora, contacta a tu ADMIN del Workspace o abre un ticket en el sistema interno de soporte.
