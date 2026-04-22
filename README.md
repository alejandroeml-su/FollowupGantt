# FollowupGantt — Enterprise Work Orchestration Platform

Plataforma integral de orquestación de trabajo **híbrida Agile + PMI + ITIL v4 + SAFe**, basada en la especificación `especificacion-producto-hibrido.md`.

**Stack**

- Backend: **NestJS** (Node.js, TypeScript) desplegado como funciones serverless en Vercel
- Frontend: **HTML + Tailwind (CDN) + JS vanilla** con módulos interactivos
- Base de datos: **Supabase** (PostgreSQL)
- Despliegue: **Vercel**

---

## Estructura del proyecto

```
FollowupGantt/
├── api/                         # Backend NestJS
│   └── src/
│       ├── main.ts              # Entry point (bootstrap + static)
│       ├── app.module.ts
│       ├── supabase/            # Cliente Supabase (Service + Module)
│       └── modules/
│           ├── projects/        # Proyectos
│           ├── tasks/           # Tareas universales (story, task, bug, milestone)
│           ├── sprints/         # Sprints
│           ├── kanban/          # Columnas + tablero con WIP limits
│           ├── gantt/           # Timeline + Critical Path Method
│           ├── dependencies/    # FS, SS, FF, SF + lag
│           ├── baselines/       # Líneas base (max 3) + Schedule Variance
│           ├── itil/            # Tickets + SLA engine
│           ├── kpis/            # Dashboard (Cycle Time, SPI, CPI, CFD, SLA, MTTR)
│           └── users/
├── public/                      # Frontend estático
│   ├── index.html               # Landing
│   ├── dashboard.html           # KPIs (Chart.js)
│   ├── kanban.html              # Drag & drop + WIP alerts
│   ├── gantt.html               # Timeline con ruta crítica
│   ├── sprints.html
│   ├── projects.html
│   ├── itil.html                # Tickets con timers SLA en vivo
│   ├── js/ (api.js, app.js, nav.js)
│   └── css/app.css
├── supabase/
│   └── schema.sql               # DDL completo + seed
├── vercel.json                  # Configuración de despliegue
├── package.json
├── tsconfig.json
├── nest-cli.json
└── .env.example
```

---

## Setup local

### 1. Instalación
```bash
npm install
```

### 2. Configurar Supabase

1. Crear un proyecto en [supabase.com](https://supabase.com)
2. Ir al **SQL Editor** y ejecutar el contenido de `supabase/schema.sql`
3. Copiar las credenciales de **Settings → API**:
   - Project URL
   - `anon` public key
   - `service_role` secret key
4. Copiar `.env.example` a `.env` y rellenar:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
PORT=3000
```

> Si no se configuran credenciales, la app arranca en **modo demo** (sin persistencia) con datos de ejemplo.

### 3. Arrancar en dev
```bash
npm run start:dev
```
Abrir http://localhost:3000

---

## Despliegue en Vercel

1. Subir el repo a GitHub
2. En Vercel, **New Project → Import**
3. Añadir las **Environment Variables**:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY`
4. Deploy

El `vercel.json` enruta:
- `/api/*` → funciones serverless (NestJS)
- `/` y `/{kanban,gantt,dashboard,itil,sprints,projects}` → `public/*.html`
- Assets estáticos desde `public/`

---

## Módulos implementados (cobertura de la especificación)

### Épica 1: Motor de Orquestación Universal
- **US 1.1** Visualización multimodal: alternancia Kanban ↔ Gantt (mismo backend de tareas).
- **US 1.2** WIP Limits: alerta visual (borde rojo + pulse) cuando una columna supera su `wip_limit`. Evento registrado en tabla `events` para CFD.

### Épica 2: Gobernanza PMI
- **US 2.1** Dependencias FS/SS/FF/SF con lag en días. Cálculo de **ruta crítica** (CPM-lite con forward/backward pass) en `/api/gantt/timeline`.
- **US 2.2** Baselines: hasta 3 por proyecto, con `Schedule Variance` (`/api/baselines/:id/variance`).

### Épica 3: Ecosistema ITIL
- **US 3.1** SLA Engine: al crear un ticket se lee la `sla_policies` por prioridad y se calcula `sla_response_due`/`sla_resolution_due`. La UI muestra **timer en tiempo real** (verde/ámbar/rojo).

### Dashboard KPIs (Sección 5)
- **Flujo (Agile):** Cycle Time, Throughput, CFD.
- **Gobernanza (PMI):** SPI, CPI, Resource Utilization.
- **Servicio (ITIL):** SLA Compliance Rate, MTTR.

---

## API REST — endpoints principales

| Módulo | Método | Ruta | Descripción |
|---|---|---|---|
| Projects | GET/POST/PATCH/DELETE | `/api/projects` | CRUD proyectos |
| Tasks | GET | `/api/tasks?project_id=...` | Lista |
| Tasks | PATCH | `/api/tasks/:id/move` | Mover a otra columna |
| Kanban | GET | `/api/kanban/board?project_id=...` | Tablero con WIP status |
| Gantt | GET | `/api/gantt/timeline?project_id=...` | Timeline + ruta crítica |
| Dependencies | GET/POST/DELETE | `/api/dependencies` | Predecesor/sucesor |
| Baselines | POST | `/api/baselines` | Guardar baseline |
| Baselines | GET | `/api/baselines/:id/variance` | Schedule Variance |
| ITIL | POST | `/api/itil/tickets` | Crear ticket (SLA auto) |
| ITIL | GET | `/api/itil/sla-policies` | Políticas SLA |
| KPIs | GET | `/api/kpis/summary` | Resumen de KPIs |

---

## UAT (Casos de prueba de la especificación)

| ID | Escenario | Implementación |
|---|---|---|
| UAT-PMI-01 | Cambio en ruta crítica | El endpoint `/gantt/timeline` recalcula ES/EF/LS/LF y marca críticas. |
| UAT-02 | Integridad de baseline | Snapshot JSONB inmutable en tabla `baselines`. |
| UAT-03 | Sincronización híbrida | Al marcar `status=done` en Kanban, `TasksService.update()` fuerza `progress=100`, reflejándose en Gantt. |

---

## Próximos pasos sugeridos

- Autenticación con Supabase Auth + RLS policies.
- Notificaciones por email (Resend) para SLAs a punto de vencer (80%).
- WebSockets (Supabase Realtime) para sincronización bidireccional en vivo.
- Export a PDF/Excel de baselines.

---

**v1.0 · Documento base para Sprint 0.**
