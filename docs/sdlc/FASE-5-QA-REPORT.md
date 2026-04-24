# Fase 5 · Reporte de Validación — @QA + @QAF

> **Orquestador:** @Orq · **EPIC:** 001 (Navegación + DnD + Menús contextuales) · **Fecha:** 2026-04-23
> **Entregado por:** @QA (SDET) + @QAF (BDD)

---

## 1. Resumen ejecutivo

| Indicador | Valor |
|---|---|
| Tests unit + component | **66 / 66 ✅** |
| Cobertura statements | **93.99 %** (> 80 % umbral) |
| Cobertura branches | **93.15 %** |
| Cobertura functions | **88 %** |
| Typecheck (`tsc --noEmit`) | **EXIT 0** |
| Features BDD redactadas | **7** (28 escenarios) |
| Specs E2E redactadas | **5 files** (listas para correr contra dev server) |
| Escenarios E2E ejecutados | **0** · requiere dev server + seed (deuda operativa) |

**Veredicto @QA:** *módulo de lógica y primitivas UI listos para merge*. Deuda explícita: smoke-run E2E contra un entorno con DB seed.

---

## 2. Entregables @QA (SDET)

### 2.1 Configuración

- [vitest.config.ts](../../vitest.config.ts) — jsdom + globals + thresholds 80 %.
- [tests/setup.ts](../../tests/setup.ts) — mocks globales de `next/cache`, `next/navigation`, `matchMedia`, `crypto.randomUUID`.
- [playwright.config.ts](../../playwright.config.ts) — matriz Chromium/Firefox/WebKit/Mobile, `webServer` condicional a CI.
- [tests/tsconfig.json](../../tests/tsconfig.json) — aislado con `types` de vitest + RTL.
- Scripts npm añadidos: `test`, `test:watch`, `test:coverage`, `test:e2e`.

### 2.2 Suite unit/component (vitest · 66 tests)

| Archivo | Tests | Módulo | Cobertura |
|---|--:|---|--:|
| `tests/unit/reorder.test.ts` | 10 | `actions/reorder.ts` fractional indexing, duplicar, bulk | 82.7 % |
| `tests/unit/reorder-wip.test.ts` | 8 | `actions/reorder.ts` WIP enforcement (Sprint 2) | ↑ |
| `tests/unit/schedule.test.ts` | 7 | `actions/schedule.ts` INVALID_RANGE + dependencias FS (Sprint 3) | 100 % |
| `tests/unit/filters.test.ts` | 9 | `lib/filters.ts` pickFilters + hrefWithFilters (Sprint 4) | 100 % |
| `tests/unit/keys.test.ts` | 9 | `lib/keys.ts` mapa + displayShortcut + isTypingTarget | 100 % |
| `tests/unit/ui-store.test.ts` | 9 | `stores/ui.ts` selección múltiple + columnPrefs + drawer | 97.9 % |
| `tests/component/Toaster.test.tsx` | 5 | auto-dismiss, roles ARIA (alert/status), botón cerrar | 100 % |
| `tests/component/ViewSwitcher.test.tsx` | 4 | preservación de filtros, `month` por vista, aria-selected | 100 % |
| `tests/component/ContextMenuPrimitive.test.tsx` | 5 | apertura con right-click, submenú, separador, disabled | 100 % |

### 2.3 Suite E2E (playwright · listas para CI)

- `tests/e2e/kanban-dnd.spec.ts` — DnD mouse + teclado + rollback de red (Sprint 0).
- `tests/e2e/keyboard-nav.spec.ts` — overlay, palette, escape, sin disparo en inputs.
- `tests/e2e/gantt-drag.spec.ts` — drag de barras, teclado, navegación prev/next mes (Sprint 3).
- `tests/e2e/view-switcher-preserve.spec.ts` — filtros sobreviven, `month` se descarta/preserva, breadcrumbs aria-current (Sprint 4).
- `tests/e2e/command-palette.spec.ts` — apertura, búsqueda real, Esc cierra (Sprint 4).
- `tests/a11y/axe.spec.ts` — axe-core con tags WCAG 2.1 AA en `/list`, `/kanban`, `/gantt`, `/table`.
- `tests/perf/reorder.k6.js` — carga a `/api/tasks/reorder` con umbrales p95 < 300 ms, fail rate < 0.5 %.

---

## 3. Entregables @QAF (BDD)

Living documentation en `tests/features/*.feature` — lenguaje ubicuo, ejecutable por Cucumber si se desea, o referencia humana directa.

| Feature | Escenarios | Sprint |
|---|--:|---|
| `navegacion.feature` | 7 | 1 |
| `drag-drop.feature` | 6 | 0 + 1 + 2 |
| `context-menu.feature` | 6 | 0 + 2 |
| `accesibilidad.feature` | 6 | transversal |
| `gantt-drag.feature` | **8** | 3 — `INVALID_RANGE`, `DEPENDENCY_VIOLATION`, teclado, hitos, navegación de meses |
| `view-switcher.feature` | **6** | 4 — preservación de filtros, breadcrumbs, palette real |
| `kanban-bulk.feature` | **6** | 2 — bulk drag, WIP excedido, color persistido, colapso |

Total: **45 escenarios** Gherkin.

---

## 4. Gates @QA

| Gate | Criterio | Estado |
|---|---|---|
| G1 · Código tipa | `tsc --noEmit` = 0 | ✅ |
| G2 · Unit suite | 100 % de tests en verde | ✅ 66/66 |
| G3 · Cobertura mínima | ≥ 80 % en módulos unit-test | ✅ 93.99 % |
| G4 · Gherkin escrito | todos los CA del PO cubiertos | ✅ |
| G5 · Playwright ejecutado | dev server + seed + browsers | ❌ **deuda** |
| G6 · axe-core sin serious/critical | navegador real | ❌ **deuda** |
| G7 · k6 bajo p95 300 ms | DB real + load | ❌ **deuda** |
| G8 · Lint | `eslint` limpio | ⏭️ no ejecutado (no bloqueante de QA) |

Gates G1-G4 cumplidos. G5-G7 requieren entorno con base de datos seeded y dev server. @SRE tiene el pipeline CI listo ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) que ejecutará los 3 gates automáticamente al crear PR contra `main`.

---

## 5. Defectos encontrados durante la fase 5

**Ninguno bloqueante.** Dos issues menores corregidos en vivo durante la escritura de tests:

1. **Toaster singleton** — el store del Toaster es un zustand global; tests consecutivos dejaban toasts residuales. Expuse `toast.__resetForTests()` y lo uso en `beforeEach`.
2. **`div.isContentEditable` en jsdom** — getter no implementado cuando el atributo se asigna. Los tests stubean la propiedad con `Object.defineProperty`.

Ambos cambios son *test-only*, no afectan runtime.

---

## 6. Deuda explícita hacia @Orq

1. **Correr E2E en CI** con Postgres ephemeral + `prisma migrate deploy` + `node seed.js`. El workflow ya existe, falta disparo en PR real.
2. **`src/lib/actions.ts`** (el módulo original, no el refactor `actions/*`) tiene **0 %** de cobertura unit. Pre-existe al EPIC-001 — deuda técnica previa que el equipo debería cubrir en un ticket aparte.
3. **`src/lib/hooks/useHorizontalDrag.ts`** y `useTaskShortcuts.ts` — no están en el set unit-tested. Se validan indirectamente por Playwright (drag real y shortcuts reales).
4. **`KanbanBoardClient / ListBoardClient / GanttBoardClient`** — componentes complejos (DnD + pointer events + optimistic updates). Su validación natural es E2E, no jsdom.

---

## 7. Recomendación @Orq

La Fase 5 se considera **"validada en el plano unit/component"**. Para declarar el EPIC-001 como *Completado*, se requiere que @SRE ejecute el pipeline CI contra un ambiente con datos y reporte los 3 gates restantes (G5-G7).

**Decisión propuesta:** mergear a `master` con flag `ff_new_interactions=true` desactivado en producción, correr suite E2E en staging, y promover a 100 % de tráfico tras 48 h de soak sin incidentes.
