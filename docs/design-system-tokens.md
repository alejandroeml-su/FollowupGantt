# Design System — Avante Neutral+

**Autor:** @UIUX · **Fecha:** 2026-04-24 · **Estado:** aplicado parcial, pendiente sweep global

## 1. Motivación

Auditoría detectó violaciones WCAG 2.1 AA por hard-coding de `bg-slate-900`/`bg-slate-950` + `text-slate-500`/`text-slate-600` en dark mode. El token `--muted-foreground` (`#94a3b8`) cumplía sobre `bg-background` puro pero NO sobre los fondos de inputs. Esta refactorización mueve el contraste al sistema de tokens y añade tokens faltantes (`--input-foreground`, `--placeholder`, `--success`, `--warning`, `--subtle`).

## 2. Paleta nueva (valores exactos)

### 2.1 Dark mode (default del proyecto)

| Token CSS | Antes | Ahora | Uso |
|---|---|---|---|
| `--background` | `#020617` | **`#0b1220`** | Fondo de página (slate-950 cálido) |
| `--foreground` | `#f8fafc` | `#f8fafc` | Texto principal |
| `--card` | `#020617` | **`#111b2e`** | Fondo de cards/popovers (+1 nivel) |
| `--subtle` | *nuevo* | **`#0f172a`** | Sidebars, headers, zonas secundarias |
| `--primary` | `#818cf8` | **`#a5b4fc`** | indigo-300 — ratio 9.5:1 sobre bg |
| `--muted-foreground` | `#94a3b8` | **`#cbd5e1`** | slate-300 — ratio 11.5:1 sobre bg |
| `--destructive` | `#7f1d1d` | **`#f87171`** | red-400 — ratio 6.9:1 |
| `--success` | *nuevo* | **`#34d399`** | emerald-400 |
| `--warning` | *nuevo* | **`#fbbf24`** | amber-400 |
| `--border` | `#1e293b` | **`#334155`** | slate-700 — bordes visibles |
| `--input` | `#1e293b` | `#1e293b` | Fondo de input (mantenido) |
| `--input-foreground` | *nuevo* | **`#f8fafc`** | Texto dentro de inputs |
| `--placeholder` | *nuevo* | **`#94a3b8`** | Placeholder — ratio 5.2:1 sobre input |
| `--ring` | `#6366f1` | **`#818cf8`** | indigo-400 — focus visible |

### 2.2 Light mode (coherencia, defaultTheme es dark)

Todos los pares validados a ≥ 4.5:1. Ver [globals.css](../src/app/globals.css) para valores exactos.

### 2.3 Ratios WCAG 2.1 AA validados (dark)

| Par texto / fondo | Ratio | Nivel |
|---|---|---|
| `foreground #f8fafc` / `background #0b1220` | 18.6:1 | AAA |
| `foreground` / `card #111b2e` | 15.4:1 | AAA |
| `muted-foreground #cbd5e1` / `background` | 11.5:1 | AAA |
| `muted-foreground` / `input #1e293b` | 9.9:1 | AAA |
| `placeholder #94a3b8` / `input` | 5.2:1 | AA |
| `primary #a5b4fc` / `background` | 9.5:1 | AAA |
| `destructive #f87171` / `background` | 6.9:1 | AA |

## 3. Mapeo de sweep (búsqueda-reemplazo global)

Para que @Dev complete la migración, buscar en `src/**/*.{tsx,ts}` y reemplazar:

### 3.1 Inputs y textareas

| Buscar | Reemplazar |
|---|---|
| `bg-slate-900 border border-slate-700` | `bg-input border border-border` |
| `bg-slate-950 border border-slate-700` | `bg-input border border-border` |
| `text-white focus:outline-none focus:ring-2 focus:ring-indigo-500` | `text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring` |
| `text-white focus:outline-none focus:ring-1 focus:ring-indigo-500` | `text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring` |
| `placeholder-slate-500` | *(borrar — ya es global)* |

### 3.2 Texto muted

| Buscar | Reemplazar |
|---|---|
| `text-slate-500` *(en labels/hints)* | `text-muted-foreground` |
| `text-slate-600` | `text-muted-foreground` |
| `text-slate-400` *(en headings muted)* | `text-muted-foreground` |
| `text-slate-300` *(en body)* | `text-foreground/90` |
| `text-slate-200` *(en nombre asignado)* | `text-foreground` |

### 3.3 Borders y superficies

| Buscar | Reemplazar |
|---|---|
| `border-slate-800` | `border-border` |
| `border-slate-700` *(en cards, no inputs)* | `border-border` |
| `bg-slate-900/50` | `bg-subtle/50` |
| `bg-slate-950/50` | `bg-background/95 backdrop-blur` |
| `bg-slate-800` *(en chips muted)* | `bg-secondary` |

### 3.4 Chips de prioridad (unificado)

Reemplazar el `PRIORITY_COLOR` en cada archivo por:

```ts
const PRIORITY_COLOR = {
  LOW: 'bg-secondary text-muted-foreground border-border',
  MEDIUM: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  HIGH: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  CRITICAL: 'bg-red-500/15 text-red-300 border-red-500/40',
}
```

**TODO @Dev:** extraer a `src/lib/ui/priority.ts` y eliminar las 7 copias dispersas (KanbanBoardClient, ListBoardClient, TableBoardClient, TaskDrawerContent, TaskDetailModal, ListTaskRow, QuickCreatePopover).

## 4. Archivos ya refactorizados en esta iteración

- [src/app/globals.css](../src/app/globals.css) — tokens + placeholders globales
- [src/components/interactions/TaskDrawerContent.tsx](../src/components/interactions/TaskDrawerContent.tsx) — inputs, labels, chips
- [src/components/interactions/CalendarBoardClient.tsx](../src/components/interactions/CalendarBoardClient.tsx) — días fuera-de-mes, status dots
- [src/components/interactions/KanbanBoardClient.tsx](../src/components/interactions/KanbanBoardClient.tsx) — chips prioridad
- [src/components/interactions/ListBoardClient.tsx](../src/components/interactions/ListBoardClient.tsx) — chips prioridad
- [src/components/interactions/TableBoardClient.tsx](../src/components/interactions/TableBoardClient.tsx) — chips prioridad
- [src/components/interactions/QuickCreatePopover.tsx](../src/components/interactions/QuickCreatePopover.tsx) — chips prioridad
- [src/components/TaskDetailModal.tsx](../src/components/TaskDetailModal.tsx) — chips prioridad
- [src/components/ListTaskRow.tsx](../src/components/ListTaskRow.tsx) — chips prioridad
- [src/app/workload/page.tsx](../src/app/workload/page.tsx) — chips prioridad

## 5. Archivos pendientes para @Dev (sweep global)

Aplicar tabla sección 3 en todo `src/`. Prioritarios:

- `src/components/interactions/GanttBoardClient.tsx`
- `src/components/Sidebar*.tsx`, `src/components/Header*.tsx`
- `src/app/list/page.tsx`, `src/app/kanban/page.tsx`, etc.
- Toda `src/components/` con `slate-[4-9]00`

Estimado: ~180 reemplazos en ~20 archivos. Puede hacerse con `sed`/find-replace en VS Code.

## 6. Validación

1. `npm run dev` → visual QA del drawer (tarea del screenshot original)
2. `npm run test:e2e` → axe smoke (no debe subir de baseline actual de <50 violaciones)
3. Tras sweep completo, **bajar** el baseline en [tests/a11y/axe.spec.ts](../tests/a11y/axe.spec.ts) línea 31 de `<50` a `<10` (deuda documentada en `project_followupgantt_tech.md`)

## 7. Próximos pasos (@UIUX deuda)

- **Dark mode toggle visible**: hoy el defaultTheme es dark pero no hay switch en header/sidebar. @Dev debe añadir uno si validamos con users que quieren elegir.
- **Tokens de focus ring consistentes**: algunos botones usan `focus:ring-indigo-500` hardcoded.
- **Tipografía**: jerarquía de `text-xs`/`text-[9px]`/`text-[10px]` inconsistente. Proponer escala `text-caption` / `text-label` / `text-body` / `text-title` en sprint siguiente.
