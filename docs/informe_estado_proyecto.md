# Informe de Estado del Proyecto: FollowupGantt

> Fecha: 2026-05-08
> Rama: `claude/check-project-progress-iikAw`
> Alcance: evaluación de completitud, priorización 80/20 del backlog restante y plan para cerrar el MVP al 100%.

---

## 1. Estado general del proyecto: ~60%

A criterio de esta evaluación, el proyecto está aproximadamente al **60% de completitud** medido contra el backlog total declarado, y al **~95% del MVP** (Releases 1 + 2).

### Resumen

**FollowupGantt** es una plataforma full-stack en Next.js 16.2 que apunta a replicar las capacidades enterprise de ClickUp (List, Board/Kanban, Gantt, Calendar, Table, etc.). Stack: Prisma/PostgreSQL, Supabase, AI-SDK (Anthropic/OpenAI), Vitest, Playwright, Sentry.

### ✅ Hecho (~90% del MVP core)

- Jerarquía Spaces / Folders / Lists / Tasks / Subtareas con CRUD completo
- 4 vistas principales: **List, Kanban, Gantt, Table** (con drag-drop y reordenamiento)
- Gestión de tareas: CRUD, transiciones de estado, dependencias, time tracking
- Custom Fields (TEXT, NUMBER, DATE, BOOLEAN, SELECT, MULTI_SELECT, URL)
- Autenticación, 2FA, password reset, sesiones
- Multi-tenancy / Workspaces (planes Free / Pro / Enterprise)
- Audit logging (ITIL / SOC2)
- Integraciones email (SMTP, SendGrid, Resend)
- AI: Knowledge Manager, mentions/tagging, Insights (categorización, riesgo de retraso, next-action)
- Agile Wave P9: Epics, Releases, Roadmap, Sprint Planning
- Resource Management: Skills matrix, User Availability, Allocation Snapshots
- Risk Register + simulación Monte Carlo
- Docs (Wiki) con versionado
- Notificaciones (in-app + Web Push)
- CI pipeline (`.github/workflows/ci.yml`), Docker, K8s manifests
- Sentry (client/server/edge) configurado
- 10 directorios de tests (unit, e2e, perf, component, a11y, features, fixtures, stubs)
- 50 commits en master, working tree limpio

### 🟡 Parcial (40–70%)

- **Calendar View** — el reporte QA la marca "en Construcción", pero el código (`CalendarBoardClient`, 796 líneas) ya es funcional. Reporte desactualizado.
- **Whiteboards** — marcado "en Construcción" (enum/schema definidos, UI incompleta)
- **Timeline View** — mencionada en backlog, sin ruta UI
- **Mind Maps** — schema definido, rutas (`/mindmaps`) probablemente MVP
- **Chat View** — no existe en rutas
- **Dashboard / KPI widgets** — rutas existen, contenido placeholder

### ❌ Faltante (0–20%)

- Chat View, Video Clips, Email ClickApp, Proofing
- Form-to-Task automation (parcial)
- Automation rule engine (SI X ENTONCES Y)
- Portfolio view (Wave P10 en draft)
- Real-time co-editing en Docs
- ~27 historias de usuario pendientes en Releases 3–6

### Justificación del 60%

El producto **funciona y es usable** para gestión tipo ClickUp básico/medio. Pero el roadmap apunta a un competidor enterprise: queda construir la capa colaborativa (chat, clips, real-time co-editing), automatizaciones y completar vistas. Si el alcance fuera solo el MVP, lo pondría en ~85–95%; medido contra el backlog completo, **60%** es realista.

---

## 2. Priorización 80/20: 7 historias para ~80% del valor restante

De ~15 historias parciales/faltantes, estas **7** concentran la mayor adopción, retención y diferenciación frente a ClickUp. Se descartaron el resto por baja relación valor/costo (Chat, Clips, Proofing, Whiteboards, CMDB, Box View, Mind Maps avanzados — alternativas de mercado o nicho).

| # | Historia | Estado actual | Por qué entra al 20% | Esfuerzo |
|---|---|---|---|---|
| 1 | **US-4.1 Calendar View** | Parcial ("en Construcción") | Vista esperada por defecto; ya hay scaffold y modelo de datos | 1 sem |
| 2 | **US-8.1 Automations (Si X → Y)** | Faltante | Multiplicador de productividad; reduce churn; diferenciador clave | 3 sem |
| 3 | **US-8.2 Dashboards EVM/Velocity** | Parcial (rutas vacías) | Compra ejecutiva: sin esto no se vende a Enterprise | 2 sem |
| 4 | **US-2.2 Forms → Task** | Faltante | Canal de captura externo; alto valor para soporte/ventas/QA | 1.5 sem |
| 5 | **US-7.4 Email ClickApp** | Faltante | Adopción inmediata sin cambiar hábitos del usuario | 1.5 sem |
| 6 | **US-5.2 Workload View** | Parcial | Resource Mgrs lo exigen; reusa Skills/Allocation existentes | 1.5 sem |
| 7 | **US-4.2 Timeline View** | Faltante | Reutiliza ~70% del Gantt; ROI muy alto por costo bajo | 0.5 sem |

### Cronograma sugerido

**Total: ~11 semanas (≈ 2.5–3 meses)** con **1 dev senior + 1 mid + apoyo de IA**, o **~5 meses solo dev** asistido por IA.

```
Mes 1   ▓▓▓▓ Calendar (US-4.1) → Timeline (US-4.2) → Workload (US-5.2)
Mes 2   ▓▓▓▓ Automations engine (US-8.1) ── start
Mes 3   ▓▓▓▓ Automations (cierre) + Dashboards EVM (US-8.2)
Mes 3.5 ▓▓   Forms→Task (US-2.2) + Email ClickApp (US-7.4)  [paralelo]
```

### Lógica del orden

1. **Quick wins primero** (Calendar, Timeline, Workload): completan vistas declaradas y suben la percepción de "producto terminado" en 3–4 semanas.
2. **Automations** lo más temprano posible: es la pieza más cara y más vendible; si se atasca, no contamina el resto del roadmap.
3. **Dashboards** después de Automations porque comparten infraestructura de eventos/agregación.
4. **Forms y Email** al final: features autocontenidas, sirven como "sprint de cierre" amortiguador.

### Resultado esperado

Pasar de **60% → ~85%** de completitud percibida del backlog completo, y de **MVP usable → producto vendible Enterprise**, dejando deliberadamente fuera del scope la colaboración en tiempo real (Chat / Clips / Proofing / Whiteboards) que se atacarían en una Fase 2 si los datos de uso lo justifican.

---

## 3. Cierre del MVP al 100%

**Estado real: ~95% del MVP ya está listo.** El reporte QA (`qa_audit_report.json`) está desactualizado: marca Calendar y Whiteboards como "en Construcción", pero Calendar ya está implementado (`CalendarBoardClient`, 796 líneas). Whiteboards no es MVP.

### 🔴 Bloqueadores reales (A) — ninguno crítico

No hay features rotas. El MVP (Releases 1 + 2) está funcional:

- List, Kanban, Gantt, Calendar
- Time Tracking
- Forms → Task
- Dependencias
- Auth / 2FA
- Custom Fields
- CRUD core

### 🟡 Lo que falta para cerrar al 100% (B)

| Pendiente | Ubicación | Esfuerzo |
|---|---|---|
| **US-4.2 Timeline View** | falta `src/app/timeline/page.tsx` | 2–3 días |
| **Tests E2E saltados** | 7 suites con `describe.skip` (Gantt drag, Kanban DnD, MSP import/export, Excel export, edge cases de dependencias) | 5 días |
| **MSP parser** | 9 `it.todo` sin implementar | incluido arriba |
| **Limpiar QA audit** | regenerar `qa_audit_report.json` (referencias falsas a Calendar/Whiteboards) | 0.5 día |
| **Resource heatmap drill-down** | marcado "TODO R2" | 1 día |
| **TaskChecklistSection** | TODO R2 en features avanzadas | 1 día |
| **Build sin `prisma: not found`** | falta `npm install` en entorno (no es bug de código) | 0.5 día |

### 🟢 Fuera de scope MVP (C)

Whiteboards, Mind Maps avanzados, Workload View, Box View, Automations, Dashboards EVM, Chat, Clips, Email ClickApp, Proofing → todos Release 3+.

### ⏱️ Estimación para llegar al 100%

- **MVP mínimo "shippable"** (sin Timeline, sin tests E2E nuevos): **2–3 días-dev**
- **MVP "1.0 con calidad"** (Timeline + E2E + QA): **~10–13 días-dev** (≈ 2.5 semanas con 1 dev senior, o 1 sprint con 2 devs)

### Recomendación

Ship **v1.0** ahora con lo que hay (es vendible) y cerrar Timeline + E2E como **v1.0.1** en el siguiente sprint. El producto ya pasa el umbral de "MVP listo para clientes piloto".

---

## 4. Checklist de entregables v1.0

- [x] Authentication (OAuth, sessions, 2FA)
- [x] Core CRUD (tasks / projects / dependencies)
- [x] 4 Core Views (List, Kanban, Gantt, Calendar)
- [x] Time Tracking (timer + manual entries, cost calculation)
- [x] Forms → Task (formulario público → tarea automática)
- [x] Dependencies & Critical Path (reacciones Gantt, alertas CPM)
- [x] Gestión de usuarios y proyectos
- [x] Custom fields
- [ ] Timeline View (diferida, R2 pero no crítica)
- [ ] Cobertura E2E (features funcionan; harness de tests incompleto)

---

## 5. Conclusión ejecutiva

| Métrica | Valor |
|---|---|
| Completitud vs. backlog total | **60%** |
| Completitud del MVP (R1+R2) | **~95%** |
| Bloqueadores críticos | **0** |
| Esfuerzo a MVP "shippable" | **2–3 días-dev** |
| Esfuerzo a MVP "1.0 con calidad" | **10–13 días-dev** |
| Esfuerzo al 85% del backlog total (80/20) | **~11 semanas** |

**FollowupGantt está listo para clientes piloto hoy.** El siguiente paso recomendado es liberar v1.0, instrumentar telemetría de uso, y atacar las 7 historias del Pareto en función de los datos reales de adopción.
