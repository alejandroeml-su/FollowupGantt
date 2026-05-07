# Wave P10 · Enterprise Portfolio · Kickoff Document

**Fecha kickoff:** 2026-05-07
**Sponsor:** Edwin Martinez (Líder FollowupGantt · Inversiones Avante)
**Orquestador:** @Orq
**Modalidad:** SDLC Autónomo · 3 equipos paralelos · 5 semanas

---

## 0. Ejecutivo · TL;DR

Wave P10 eleva FollowupGantt de gestor de proyecto único a **plataforma de portfolio corporativo** mediante 7 historias de usuario distribuidas en 3 equipos paralelos (Alpha/Beta/Gamma) durante 5 semanas. Reemplaza el scope original de integración Jira/Linear por capacidades portfolio-level de alto valor ejecutivo (riesgos consolidados, costos EVM, allocation cross-project, dependencias programa, velocity forecasting).

**Métricas objetivo:**
- 7 HUs · 55 SP · 5 semanas
- 10 developers + 2 DBAs + 1 UI/UX + 1 QA + 1 QAF + 1 SRE
- Velocity efectivo ~2x vs paradigma single-team (P9)
- Fecha objetivo Sprint 2 closure: **2026-06-11** (sujeto a confirmación Edwin)

---

## 1. Fase 1 · @AE · Análisis de Impacto

### 1.1 Alineación estratégica TOGAF

| Capa TOGAF | Impacto |
|---|---|
| **Business Architecture** | Habilita governance multi-proyecto · CIO/PMO obtiene visibilidad portfolio |
| **Data Architecture** | 6 nuevas entidades persistentes + agregaciones cross-project · ~76 tablas en prod tras P10 |
| **Application Architecture** | Nuevos módulos: portfolio/, calendar/, analytics/ · reuso de motor CPM/EVM existente |
| **Technology Architecture** | Sin nuevos servicios externos (a diferencia de scope Jira removido) · stack actual suficiente |

### 1.2 Compliance & Seguridad

| Aspecto | Evaluación | Acción |
|---|---|---|
| RLS portfolio cross-project | 🟡 Riesgo medio | Política `is_portfolio_viewer()` con whitelist de roles |
| GDPR/datos personales | 🟢 Bajo | Allocation muestra carga, no datos sensibles |
| Sox/auditoría costos | 🟡 Medio | EVM consolidado requiere audit trail extendido |
| Performance N+1 | 🔴 Alto | Materialized views obligatorias en HU-10.1 / 10.6 |

### 1.3 Cumplimiento normativo Avante

- ✅ Acepta política Unidad de Transformación Digital (sin terceros, sin OAuth externo).
- ✅ Datos permanecen en Supabase (geografía aprobada).
- ✅ Sin nuevos secretos requeridos (vs scope Jira que requería OAuth Cloud).
- ✅ Compatible con plan de continuidad operativa (RTO < 4h, RPO < 1h).

### 1.4 Veredicto @AE

**Wave P10 APROBADA para construcción.** Sin bloqueos de gobernanza ni compliance. Riesgo principal: performance portfolio queries → mitigado en arquitectura @AS.

---

## 2. Fase 2A · @AS · Arquitectura Técnica

### 2.1 Modelo de datos nuevas entidades

> **HALLAZGO @AS:** `WorkCalendar` + `Holiday` **ya existen** en schema desde Ola P1.5 (línea 1204). HU-10.2 reduce alcance: solo `UserAvailability` nuevo + UI editor + bulk import + wire-up con CPM/SprintCapacity. **HU-10.2 baja de 8 SP a 5 SP.**

```prisma
// HU-10.2 Calendarios — REUTILIZA WorkCalendar/Holiday existentes (Ola P1.5)

model UserAvailability {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  startDate DateTime
  endDate   DateTime
  reason    AvailabilityReason  // VACATION | SICK | TRAINING | REDUCED_HOURS | OTHER
  reducedHoursPercent Int?      // 0-100, null si full block
  notes     String?
  createdAt DateTime @default(now())
  @@index([userId, startDate, endDate])
}

enum CalendarScope { PROJECT TEAM GLOBAL }
enum AvailabilityReason { VACATION SICK TRAINING REDUCED_HOURS OTHER }

// HU-10.4 Cross-project dependencies
model CrossProjectDependency {
  id              String   @id @default(uuid())
  sourceTaskId    String
  sourceTask      Task     @relation("CrossDepSource", fields: [sourceTaskId], references: [id], onDelete: Cascade)
  targetTaskId    String
  targetTask      Task     @relation("CrossDepTarget", fields: [targetTaskId], references: [id], onDelete: Cascade)
  type            DependencyType  // FS | SS | FF | SF
  lagDays         Int      @default(0)
  createdById     String?
  notes           String?
  createdAt       DateTime @default(now())
  @@unique([sourceTaskId, targetTaskId])
  @@index([sourceTaskId])
  @@index([targetTaskId])
}

// HU-10.7 Cross-project allocation (snapshot/cache para queries rápidas)
model ResourceAllocationSnapshot {
  id          String   @id @default(uuid())
  userId      String
  weekStart   DateTime  // lunes de la semana
  totalHours  Float
  allocations Json      // [{projectId, projectName, hours, percent}]
  computedAt  DateTime  @default(now())
  @@unique([userId, weekStart])
  @@index([weekStart])
}
```

### 2.2 Interfaces compartidas (cross-team contracts)

**`src/lib/portfolio/types.ts`** (Alpha/Gamma compartido):
```typescript
export type PortfolioProjectSummary = {
  id: string
  name: string
  status: ProjectHealthStatus
  progress: number  // 0-100
  cpi: number       // Cost Performance Index
  spi: number       // Schedule Performance Index
  activeTasks: number
  nextRelease: { id: string; name: string; targetDate: Date } | null
  currentSprint: { id: string; name: string; endDate: Date } | null
  riskCount: { high: number; medium: number; low: number }
}

export type ProjectHealthStatus = 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'BLOCKED'
```

**`src/lib/calendar/types.ts`** (Beta/Gamma compartido):
```typescript
export type WorkCalendarRules = {
  weekendsOff: boolean
  holidays: Date[]
  reducedDays: { date: Date; percent: number }[]
}

export function isWorkingDay(date: Date, rules: WorkCalendarRules): boolean
export function workingDaysBetween(start: Date, end: Date, rules: WorkCalendarRules): number
```

### 2.3 Decisiones arquitectura (ADRs Wave P10)

| ADR | Decisión | Rationale |
|---|---|---|
| **ADR-P10-1** | Materialized views para portfolio summary | N proyectos × M tasks × N+1 query inviable >50 proyectos |
| **ADR-P10-2** | `ResourceAllocationSnapshot` como cache (no view) | Computar on-demand en allocation heatmap es costoso · refresh nightly cron |
| **ADR-P10-3** | `WorkCalendar.scope` jerarquía GLOBAL→TEAM→PROJECT | Override pattern · permite holidays nacionales + ajustes por equipo |
| **ADR-P10-4** | `CrossProjectDependency` separado de `Dependency` existente | Schema actual `Dependency` solo intra-project · no romper compatibilidad |
| **ADR-P10-5** | Velocity forecasting Monte Carlo lite (1k iteraciones) | P10/P50/P90 con compute aceptable client-side · sin librería externa |
| **ADR-P10-6** | Riesgos consolidados reusa modelo `Risk` P8 (no nuevo) | Solo agregar índices + queries, sin schema cambios |
| **ADR-P10-7** | EVM portfolio reusa `Cost` P8 (no nuevo) | Solo nuevos endpoints/queries de agregación |

### 2.4 Estructura de directorios Wave P10

```
src/
├── app/
│   ├── portfolio/                    [Alpha]
│   │   ├── page.tsx                  HU-10.1
│   │   ├── risks/page.tsx            HU-10.5
│   │   ├── finance/page.tsx          HU-10.6
│   │   ├── dependencies/page.tsx     HU-10.4
│   │   └── allocation/page.tsx       HU-10.7
│   └── projects/[id]/
│       └── calendar/page.tsx         [Beta] HU-10.2
├── components/
│   ├── portfolio/                    [Alpha+Gamma]
│   │   ├── PortfolioDashboard.tsx
│   │   ├── HealthHeatmap.tsx
│   │   ├── RiskMatrix.tsx
│   │   └── EvmDashboard.tsx
│   ├── calendar/                     [Beta]
│   │   ├── CalendarEditor.tsx
│   │   └── HolidayImporter.tsx
│   ├── allocation/                   [Beta]
│   │   └── AllocationHeatmap.tsx
│   └── analytics/                    [Gamma]
│       ├── VelocityChart.tsx
│       ├── CrossDepGraph.tsx
│       └── ForecastWidget.tsx
└── lib/
    ├── portfolio/                    [Alpha+Gamma]
    │   ├── aggregations.ts
    │   ├── types.ts
    │   └── health.ts
    ├── calendar/                     [Beta]
    │   ├── types.ts
    │   ├── rules.ts
    │   └── working-days.ts
    ├── allocation/                   [Beta]
    │   └── compute.ts
    └── forecasting/                  [Gamma]
        ├── velocity.ts
        └── monte-carlo.ts
```

---

## 3. Fase 2B · @AT · Diseño Infra Cloud

### 3.1 Cambios Vercel/Supabase

| Componente | Cambio | Justificación |
|---|---|---|
| Vercel cron | +1 cron `0 2 * * *` para refresh `ResourceAllocationSnapshot` | Compute pesado, mejor nightly que on-demand |
| Supabase | 6 nuevas tablas + 2 materialized views | ADR-P10-1, ADR-P10-2 |
| Supabase RLS | 6 nuevas políticas + función `is_portfolio_viewer()` | Compliance @AE |
| Edge Functions | Sin cambios | No requeridos |
| ENV nuevas | `PORTFOLIO_REFRESH_INTERVAL_MIN=5` (cache TTL) | Tunable |

### 3.2 Migrations plan (orden)

```
1. p10_calendars_p10_2     [Beta]    Semana 1
2. p10_user_availability   [Beta]    Semana 1
3. p10_cross_deps          [Gamma]   Semana 1
4. p10_allocation_snapshot [Beta]    Semana 2
5. p10_portfolio_views     [Alpha]   Semana 1 (materialized views)
6. p10_rls_policies        [todos]   Semana 4 (consolidación)
```

### 3.3 Performance budgets

| Endpoint | P95 target | Estrategia |
|---|---|---|
| `/portfolio` | < 800ms | Materialized view + Redis-like cache 5min |
| `/portfolio/dependencies` | < 1500ms | Lazy graph loading (chunks 50 nodos) |
| `/portfolio/allocation` | < 1000ms | Snapshot table query directo |
| `/projects/{id}/calendar` | < 400ms | Standard CRUD |

### 3.4 Veredicto @AT

Infra existente soporta Wave P10 sin escalado adicional. Solo +1 cron Vercel (limit Hobby = 2 crons, actualmente 1 → OK).

---

## 4. Fase 3 · @PO · Tickets por equipo

### 4.1 Equipo Alpha · "Portfolio View" (3 devs + 1 UI/UX · 18 SP)

#### TICKET ALPHA-1: Portfolio Dashboard core (HU-10.1) · 13 SP · Sprint 1
- [ ] **A1.1** Materialized view `portfolio_project_summary` (3 SP)
- [ ] **A1.2** Server actions `getPortfolioOverview` + `refreshPortfolioCache` (2 SP)
- [ ] **A1.3** Página `/portfolio` con cards proyecto (3 SP)
- [ ] **A1.4** Heatmap salud verde/amarillo/rojo (2 SP)
- [ ] **A1.5** Filtros (unidad de negocio, fase PMI, responsable) (2 SP)
- [ ] **A1.6** Export PDF/Excel snapshot (1 SP)

#### TICKET ALPHA-2: Riesgos consolidados (HU-10.5) · 5 SP · Sprint 2
- [ ] **A2.1** Server action `getConsolidatedRisks` con filtros (2 SP)
- [ ] **A2.2** Componente `RiskMatrix` (probabilidad × impacto) (2 SP)
- [ ] **A2.3** Página `/portfolio/risks` + export PDF steering (1 SP)

### 4.2 Equipo Beta · "Capacity Engine" (3 devs + 1 DBA · 16 SP)

#### TICKET BETA-1: Calendarios laborales (HU-10.2) · 5 SP · Sprint 1
> **Reuso:** `WorkCalendar` + `Holiday` ya existen desde Ola P1.5. Solo se completa el módulo.
- [ ] **B1.1** Migration `UserAvailability` (1 SP)
- [ ] **B1.2** Server actions CRUD availability + holidays bulk (1 SP)
- [ ] **B1.3** `lib/calendar/working-days.ts` integrado con CPM existente (1 SP)
- [ ] **B1.4** Vista `/projects/{id}/calendar` con grid + edición (1.5 SP)
- [ ] **B1.5** Bulk import holidays CSV/JSON + presets MX (0.5 SP)

#### TICKET BETA-2: Allocation cross-project (HU-10.7) · 8 SP · Sprint 2
- [ ] **B2.1** Migration `ResourceAllocationSnapshot` + cron Vercel (1 SP)
- [ ] **B2.2** `lib/allocation/compute.ts` con tests Monte Carlo (3 SP)
- [ ] **B2.3** `AllocationHeatmap` componente (2 SP)
- [ ] **B2.4** Página `/portfolio/allocation` + alertas over-allocation (2 SP)

### 4.3 Equipo Gamma · "Analytics & Programa" (2 devs + 1 senior + 1 DBA · 21 SP)

#### TICKET GAMMA-1: Velocity + forecasting (HU-10.3) · 5 SP · Sprint 1
- [ ] **G1.1** Server action `computeVelocityHistory(projectId, sprints)` (2 SP)
- [ ] **G1.2** `lib/forecasting/monte-carlo.ts` con P10/P50/P90 (2 SP)
- [ ] **G1.3** Widget `VelocityChart` integrado en SprintPlanning + Releases (1 SP)

#### TICKET GAMMA-2: Cross-project dependencies (HU-10.4) · 8 SP · Sprint 1
- [ ] **G2.1** Migration `CrossProjectDependency` + relations (1 SP)
- [ ] **G2.2** Server actions CRUD deps + validación ciclos (2 SP)
- [ ] **G2.3** `CrossDepGraph` con react-flow o d3 (3 SP)
- [ ] **G2.4** Vista `/portfolio/dependencies` + alertas propagación (2 SP)

#### TICKET GAMMA-3: Costos/EVM consolidados (HU-10.6) · 8 SP · Sprint 2
- [ ] **G3.1** Server action `getPortfolioFinance` agregando CPI/SPI/EAC/ETC (3 SP)
- [ ] **G3.2** Componente `EvmDashboard` con drill-down (3 SP)
- [ ] **G3.3** Página `/portfolio/finance` + export Excel CFO (2 SP)

### 4.4 Definición de Done global Wave P10

Cada PR debe cumplir:
- [x] TypeScript sin errores
- [x] ESLint sin warnings
- [x] Tests unit con coverage ≥ 80% del nuevo código
- [x] WCAG AA validado en componentes UI
- [x] Audit actions registradas para mutaciones
- [x] RLS habilitada en nuevas tablas (permissive temporal OK)
- [x] Sin regresión en performance budgets @AT
- [x] Code review por TL de otro equipo (cross-team gates)
- [x] Documentación JSDoc en componentes/actions/types

---

## 5. Calendario consolidado

```
Semana 0  (2026-05-07 → 2026-05-13) │ Kickoff @AE/@AS/@AT + branches creadas + schema sketch
Semana 1  (2026-05-14 → 2026-05-20) │ Sprint 1 inicio · 3 equipos paralelos
Semana 2  (2026-05-21 → 2026-05-27) │ Sprint 1 cierre · 21-27 SP delivered
Semana 3  (2026-05-28 → 2026-06-03) │ Mid-wave · QA parcial · integración cross-equipo
Semana 4  (2026-06-04 → 2026-06-10) │ Sprint 2 inicio
Semana 5  (2026-06-11)              │ Sprint 2 cierre · QA final · @SRE despliegue
```

**Hitos:**
- 🎯 **2026-05-13:** kickoff técnico cerrado (este doc + branches + sketch schema)
- 🎯 **2026-05-27:** Sprint 1 demo (HU-10.1 + 10.2 + 10.3 + 10.4 funcionales)
- 🎯 **2026-06-03:** integración mid-wave estable
- 🎯 **2026-06-11:** Wave P10 cerrada · 7 HUs en producción

---

## 6. Risk register

| Riesgo | Prob | Impacto | Mitigación | Owner |
|---|---|---|---|---|
| Performance portfolio queries | Media | Alto | Materialized views + cache (ADR-P10-1) | @AS |
| Conflict en `prisma/schema.prisma` | Alta | Medio | Sección por equipo + merge S1 antes S2 | TLs |
| Headcount real < 10 devs | Media | Alto | Confirmado por Edwin · seguimiento weekly | @PO |
| Slip de Sprint 1 | Media | Alto | Buffer Semana 3 absorbe slip ≤ 5 días | @Orq |
| Test coverage degradado | Baja | Medio | Gate CI 80% + lead QA por equipo | @QA |
| Rollback complejo si falla deploy | Baja | Alto | Feature flags por HU + rollout gradual | @SRE |
| Materialized views stale en demo | Media | Bajo | Refresh manual button + cron 5min | @AT |

---

## 7. Branches strategy

```
master                                          (producción)
└── wave/p10-kickoff                           (este branch · solo doc + schema sketch)
    ├── feat/p10-alpha-portfolio                (Equipo Alpha)
    │   └── PRs: ALPHA-1.x → ALPHA-2.x
    ├── feat/p10-beta-capacity                  (Equipo Beta)
    │   └── PRs: BETA-1.x → BETA-2.x
    └── feat/p10-gamma-analytics                (Equipo Gamma)
        └── PRs: GAMMA-1.x → GAMMA-3.x
```

**Política merge:**
- Sub-branches mergean a `wave/p10-kickoff`
- `wave/p10-kickoff` mergea a `master` solo al final de Sprint 2 (rollout big-bang controlado por feature flags)

---

## 8. @Orq · Próximos pasos inmediatos (Semana 0)

1. ✅ Documento kickoff entregado (este archivo)
2. [ ] Edwin confirma fecha objetivo Sprint 2 closure (default 2026-06-11)
3. [ ] @Orq crea sub-branches Alpha/Beta/Gamma
4. [ ] @Orq aplica schema sketch a `prisma/schema.prisma` en `wave/p10-kickoff`
5. [ ] @Orq abre PR `wave/p10-kickoff` → master con doc + schema sketch (sin migración aplicada)
6. [ ] TLs Alpha/Beta/Gamma reciben tickets y arrancan Sprint 1 (Semana 1)
