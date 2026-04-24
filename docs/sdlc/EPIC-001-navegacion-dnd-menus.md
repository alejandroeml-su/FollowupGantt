# EPIC-001 · Navegabilidad + Drag & Drop + Menús Contextuales (estilo ClickUp)

> **Orquestador:** @Orq · **Unidad de Transformación Digital — Inversiones Avante**
> **Input:** `features2.md` · **Proyecto:** `FollowupGantt` · **Fecha de apertura:** 2026-04-23
> **Stack confirmado:** Next.js 16.2.4 (App Router, RSC, Server Actions) · React 19.2 · Prisma 7.8 · PostgreSQL (Supabase) · Tailwind 4 · framer-motion 12 · lucide-react

---

## Tabla de contenidos

1. [@AE — Análisis de impacto estratégico](#1-ae--análisis-de-impacto-estratégico)
2. [@AS — Arquitectura de software](#2-as--arquitectura-de-software)
3. [@AT — Infraestructura y hosting](#3-at--infraestructura-y-hosting)
4. [@PO — Historia de usuario técnica (entregable principal)](#4-po--historia-de-usuario-técnica)
5. [@UIUX — Especificación visual e interacción](#5-uiux--especificación-visual-e-interacción)
6. [@DBA — Modelo de datos y migraciones](#6-dba--modelo-de-datos-y-migraciones)
7. [@Dev — Plan de implementación por sprints](#7-dev--plan-de-implementación)
8. [@QA + @QAF — Plan de pruebas y BDD](#8-qa--qaf--plan-de-pruebas)
9. [@SRE — Entrega y operación](#9-sre--entrega-y-operación)
10. [DoD & Gate de @Orq](#10-dod--gate-de-orq)

---

## 1 · @AE — Análisis de impacto estratégico

**Alineación con portafolio TI de Inversiones Avante**

| Capa TOGAF | Impacto |
|---|---|
| Negocio | PMs y líderes de equipo acortan su time-to-update por tarea de ~45 s (flujo actual: abrir modal, editar, guardar, reloadar) a <5 s (drag + right-click inline). Se estima +18 % de tareas registradas por usuario/día al eliminar fricción. |
| Datos | Nuevo atributo `Task.position` (float) y columna `Task.archivedAt` para la acción "archivar". Ningún dato sensible adicional. RLS de Supabase no se altera. |
| Aplicación | Introduce 3 capacidades transversales: *hotkeys globales*, *context-menu primitive*, *drag-and-drop primitive*. Consumibles por cualquier vista futura (Timeline, Workload, Calendar). |
| Tecnología | Cinco librerías nuevas (ver §2). Todas MIT/Apache-2.0. Sin dependencias server-side adicionales; incremento de bundle client ≈ 42 KB gzip. |

**Riesgos y mitigaciones (ITIL Change Enablement)**

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Regresión de performance por rerenders masivos en List/Kanban con DnD | Alta | Virtualización opcional (react-virtuoso) si > 200 filas; `useOptimistic` (React 19) para no esperar el round-trip. |
| Conflictos concurrentes en reorder (dos usuarios arrastran la misma tarea) | Media | Estrategia de *last-write-wins* con `updatedAt` como ETag y reconciliación vía `revalidatePath`. |
| Accesibilidad: DnD nativo no es keyboard-friendly | Alta | `@dnd-kit` ofrece `KeyboardSensor` integrado; WCAG 2.1 AA obligatorio en DoD. |
| Breaking changes de Next.js 16 vs training de IA | Media | `AGENTS.md` ya manda leer `node_modules/next/dist/docs/`; cada action sigue el contrato `use server` 2026-04. |
| Lock-in con @dnd-kit | Baja | Se encapsula tras un `<SortableContainer>` propio; swap posible. |

**Cumplimiento**

- ISO/IEC 25010 (usabilidad, eficiencia): mejora esperada.
- WCAG 2.1 AA: requisito bloqueante (ver §5 y §8).
- Auditoría de acciones masivas (right-click → bulk delete) queda en `Comment`-like audit log (fuera de alcance v1, registrar deuda).

**Decisión AE:** *Go, prioridad P1*. Alineado con el OKR Q2/2026 "Reducción 30 % de clicks por tarea".

---

## 2 · @AS — Arquitectura de software

### 2.1 Principios

- **Hexagonal-lite:** las Server Actions son el único adaptador de escritura. Ningún componente cliente toca Prisma.
- **Optimistic-first:** React 19 `useOptimistic` + `startTransition`. El server es la fuente de verdad; reconcilia.
- **Primitivas reutilizables:** hotkeys, menú contextual y DnD son *contextos de aplicación*, no código de vista.
- **Progressive enhancement:** la app sigue funcionando con JS deshabilitado para las acciones críticas (editar status, eliminar) vía `<form action={…}>`.

### 2.2 Dependencias nuevas

| Paquete | Versión objetivo | Rol |
|---|---|---|
| `@dnd-kit/core` | ^6.3 | Motor DnD accesible |
| `@dnd-kit/sortable` | ^8.0 | Estrategia sortable por lista/columna |
| `@dnd-kit/utilities` | ^3.2 | `CSS.Transform.toString`, etc. |
| `@radix-ui/react-context-menu` | ^2.2 | Menú contextual accesible |
| `@radix-ui/react-dialog` | ^1.1 | Drawer/Panel lateral deslizable |
| `react-hotkeys-hook` | ^4.6 | Atajos globales y por-scope |
| `zustand` | ^5.0 | Estado UI client-side (filtros, selección múltiple, panel abierto) |
| `fuse.js` | ^7.1 | Búsqueda fuzzy para `/` (palette) |

### 2.3 Vista lógica (C4 L2 simplificado)

```
┌───────────────────────────────────┐
│  app/ (RSC por defecto)           │
│  ├─ list/page.tsx  ─┐              │
│  ├─ kanban/page.tsx─┼─ leen Prisma │
│  ├─ gantt/page.tsx ─┘              │
│                                    │
│  components/interactions/          │
│  ├─ ShortcutProvider (Client)      │
│  ├─ ContextMenuProvider (Client)   │
│  ├─ SortableContainer (Client)     │
│  └─ TaskDrawer (Client)            │
│                                    │
│  lib/                              │
│  ├─ actions/tasks.ts  (server)     │
│  ├─ actions/reorder.ts (server)    │
│  ├─ stores/ui.ts (client zustand)  │
│  └─ keys.ts (mapa de shortcuts)    │
└───────────────────────────────────┘
           │  Server Actions
           ▼
      Prisma ─── PostgreSQL (Supabase)
```

### 2.4 Contratos principales

```ts
// lib/actions/reorder.ts — ADR-001
reorderTask(taskId: string, beforeId: string|null, afterId: string|null, scope: 'list'|'column'): Promise<{ok:true}>
moveTaskToColumn(taskId: string, columnId: string, beforeId: string|null): Promise<{ok:true}>
moveTaskToParent(taskId: string, newParentId: string|null): Promise<{ok:true}>
bulkUpdateTasks(ids: string[], patch: Partial<TaskPatch>): Promise<{ok:true, updated:number}>
archiveTask(id: string): Promise<{ok:true}>
duplicateTask(id: string): Promise<{id:string}>
```

**Estrategia de ordenamiento:** campo `position: Float` (fractional indexing). Al insertar entre A (pos=1) y C (pos=2), B = 1.5. Reindex perezoso cuando el delta < 1e-6.

### 2.5 ADRs abreviados

- **ADR-001 Fractional indexing** sobre `position: Float` en lugar de `Int` + renumeración en cascada. Trade-off: riesgo de `Infinity` lejano — mitigado por reindex job.
- **ADR-002 @dnd-kit over react-dnd**: soporta touch + keyboard + screen reader nativamente; API hooks-first; menor bundle.
- **ADR-003 Radix sobre headless-ui**: compatibilidad más estable con React 19 y mejor ARIA en context-menu anidado.
- **ADR-004 Zustand sobre Context puro**: selectores y evita re-renders globales en selección múltiple.
- **ADR-005 Drawer en vez de nuevo modal**: conserva contexto visual de la tarea (requisito A-5 del features2.md).

---

## 3 · @AT — Infraestructura y hosting

El stack no cambia de topología. Se sostiene sobre:

- **Runtime:** Vercel (production) con Node 20.x (output standalone habilitado) **o** contenedor Docker multi-stage para K8s (ver §9).
- **DB:** Supabase PostgreSQL 16 — `pgbouncer` transacción, connection pool 15.
- **Edge:** las acciones de reorder son POST → Node runtime (no Edge) porque usan Prisma adapter-pg.
- **Observabilidad:** Vercel Analytics + OTel exporter (`@vercel/otel`) → Grafana Cloud.
- **Secrets:** `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_*` ya existentes; ninguno nuevo requerido.

Diagrama (AWS-compatible alternativo para ambiente on-prem):

```
Route53/CF  →  ALB  →  ECS Fargate (Next 16 standalone)
                          │
                          ├─ RDS Postgres (15) + read-replica
                          └─ ElastiCache Redis (sesión/rate-limit)
```

Costos incrementales estimados: **$0** en Vercel free-tier; **~$38/mes** en AWS de referencia (t4g.small + RDS db.t4g.micro).

---

## 4 · @PO — Historia de usuario técnica

### 4.1 Título
**EPIC-001 · Navegación, Drag & Drop y Menús Contextuales estilo ClickUp en FollowupGantt**

### 4.2 Descripción
Como plataforma de seguimiento de proyectos, FollowupGantt debe habilitar interacciones de primer nivel equivalentes a ClickUp en sus vistas List, Board/Kanban, Gantt y Calendar, de manera que los Project Managers y colaboradores manipulen tareas sin abrir formularios modales para operaciones de rutina. Se incorporan tres capacidades transversales — (A) navegabilidad por teclado y estructura, (B) drag & drop multi-vista, (C) menús contextuales con acciones masivas — respetando el stack actual (Next.js 16, Prisma, PostgreSQL, Tailwind).

### 4.3 Historia de usuario (formato estándar)

> **Como** Project Manager o colaborador de un proyecto,
> **quiero** navegar, reordenar y manipular tareas con teclado, arrastre y clic derecho sin perder mi contexto visual,
> **para** gestionar el backlog y el flujo diario con la mínima fricción y el menor número de clics posible, alineado a las métricas de productividad del OKR Q2/2026.

### 4.4 Criterios de aceptación (Gherkin)

```gherkin
Feature: Navegación, Drag & Drop y Menús Contextuales

# --- A. NAVEGACIÓN -------------------------------------------------

Scenario: Navegar entre tareas con flechas en vista List
  Given estoy en /list con al menos 3 tareas visibles
  And la primera tarea tiene foco
  When presiono la tecla ArrowDown
  Then el foco se mueve a la siguiente tarea
  And el indicador visual de foco (outline 2px azul Avante) es visible
  And la tarea con foco es anunciada por lector de pantalla

Scenario: Abrir panel lateral con Enter sin perder contexto
  Given una tarea tiene foco en /list
  When presiono la tecla Enter
  Then se abre el Drawer lateral derecho con el detalle de la tarea
  And la lista sigue visible a la izquierda
  And presionar Esc cierra el Drawer y restaura el foco en la fila

Scenario: Atajo global para nueva tarea
  Given estoy en cualquier vista autenticada
  And no estoy en un campo editable
  When presiono "T"
  Then se abre el creador rápido de tarea anclado al contexto actual
  And el campo título recibe el foco

Scenario: Paleta de comandos con "/"
  Given estoy en cualquier vista
  When presiono "/"
  Then se abre la paleta de búsqueda con placeholder "Buscar tareas, proyectos…"
  And la búsqueda es fuzzy sobre title, id y tags

Scenario: Breadcrumbs jerárquicos
  Given estoy en el Drawer de una subtarea
  Then veo el breadcrumb "Gerencia › Área › Proyecto › Tarea padre › Subtarea"
  And cada segmento es navegable con clic y con Tab

Scenario: Cambio de vista preservando filtros
  Given en /list aplico filtro "assignee=me" y "status=IN_PROGRESS"
  When cambio a /kanban
  Then los mismos filtros se mantienen activos
  And la URL refleja los filtros como query params

Scenario: Navegación rápida siguiente/anterior dentro del Drawer
  Given el Drawer muestra la tarea N
  When presiono "J"
  Then se carga la tarea N+1 en el mismo Drawer
  When presiono "K"
  Then se carga la tarea N-1 en el mismo Drawer

# --- B. DRAG & DROP ------------------------------------------------

Scenario: Reordenar tarea en vista List
  Given dos tareas A y B en el mismo nivel
  When arrastro B por encima de A y suelto
  Then B queda antes de A en el orden visible
  And el cambio persiste tras recargar (campo position actualizado)
  And durante el drag se muestra un ghost translúcido de B
  And una línea guía azul (2 px) indica la zona de drop

Scenario: Mover tarea entre columnas Kanban
  Given tarea T en columna "TODO"
  When la arrastro a columna "IN_PROGRESS" y suelto
  Then T aparece en IN_PROGRESS
  And Task.status se actualiza optimistamente
  And si el servidor falla, T vuelve a TODO con toast "No se pudo mover: {motivo}"

Scenario: Anidar subtarea arrastrando sobre una tarea padre
  Given tarea T sin parentId
  When arrastro T con modificador Shift sobre la tarea P durante > 400 ms
  Then P se expande visualmente (highlight amarillo)
  And al soltar, T.parentId = P.id
  And T se inserta como primera subtarea de P

Scenario: Cambiar fecha arrastrando barra Gantt
  Given tarea G con startDate=2026-05-01 y endDate=2026-05-05
  When arrastro el cuerpo de la barra +2 días
  Then startDate=2026-05-03 y endDate=2026-05-07
  And progress no cambia
  When arrastro solo el borde derecho +1 día
  Then endDate=2026-05-08 y startDate se mantiene

Scenario: Multi-selección y drag en lote
  Given selecciono 3 tareas con Ctrl+Click
  When arrastro cualquiera de ellas a otra columna
  Then las 3 se mueven manteniendo su orden relativo
  And se ejecuta una sola bulkUpdateTasks

Scenario: Scroll automático durante el drag
  Given estoy arrastrando cerca del borde inferior del viewport
  Then la página hace auto-scroll a 8 px/frame hasta que suelto o alejo el cursor

Scenario: DnD por teclado (WCAG)
  Given una tarea tiene foco
  When presiono Space
  Then entra en modo "pickup" (aria-grabbed=true)
  When presiono ArrowDown 3 veces
  Then el cursor lógico baja 3 posiciones con anuncio SR "Mover a posición 4 de 10"
  When presiono Space otra vez
  Then se confirma el move

# --- C. MENÚ CONTEXTUAL -------------------------------------------

Scenario: Click derecho sobre una tarea muestra acciones
  Given una tarea en cualquier vista
  When hago clic derecho sobre la tarjeta
  Then aparece menú con: Editar, Duplicar, Mover a ▸, Copiar enlace, Cambiar estado ▸, Asignar ▸, Etiquetar ▸, Archivar, Eliminar
  And cada ítem muestra icono lucide y atajo de teclado
  And el menú se posiciona evitando salir del viewport

Scenario: Submenú Mover a
  When paso el cursor sobre "Mover a"
  Then aparece submenú con la jerarquía Espacio › Lista
  And puedo navegar con ArrowRight/ArrowLeft

Scenario: Acciones masivas con selección múltiple
  Given tengo 5 tareas seleccionadas
  When hago clic derecho sobre cualquiera
  Then el menú muestra "Acciones para 5 tareas"
  And Eliminar, Archivar, Mover, Asignar operan sobre las 5
  And confirmar Eliminar pide confirmación explícita

Scenario: Cierre del menú
  Given el menú está abierto
  When presiono Esc
  Then el menú se cierra y el foco vuelve al disparador
  When hago click fuera
  Then el menú se cierra sin efectos

Scenario: Menú sobre columna Kanban
  When hago clic derecho en el encabezado de columna "REVIEW"
  Then aparece menú: Renombrar, Cambiar color, Colapsar, Definir WIP limit, Eliminar columna
```

### 4.5 Especificación funcional (detalle por bloque)

#### A) NAVEGABILIDAD

| Comportamiento | Detalle |
|---|---|
| Flechas ↑↓ | Mueven foco entre tareas hermanas (mismo nivel). Saltan headers de columna. |
| ←→ | En List: colapsa/expande fila con hijos. En Kanban: mueve entre columnas. |
| Tab / Shift+Tab | Recorre elementos interactivos dentro del foco actual. |
| Enter | Abre Drawer de la tarea con foco. |
| Esc | Cierra Drawer, menú contextual o paleta. Restaura foco al origen. |
| "T" | Nueva tarea anclada al contexto (lista/columna actual). Si estoy en un campo editable, no dispara. |
| "/" | Paleta de comandos (fuse.js sobre tareas + proyectos + acciones). |
| "J" / "K" | Siguiente / anterior tarea dentro del Drawer (vim-style). |
| "E" | Editar título inline en la tarea enfocada. |
| "A" | Asignar (menú de assignee). |
| "S" | Cambiar status (menú). |
| "D" | Fecha (popover date-picker). |
| "?" | Overlay con hoja de atajos. |
| Breadcrumbs | Componente `<Breadcrumbs>` renderizado en header del Drawer. Segmentos: Gerencia › Área › Proyecto › Fase/Sprint › Tarea padre › Tarea actual. Cada segmento es `<Link>` con `prefetch`. |
| Preservación de filtros | Filtros serializados en `searchParams`. Al cambiar vista se construye la misma query. Zustand sincroniza UI local. |
| Navegación adyacente | Provider `TaskListContext` expone `next()` / `prev()` usando el orden visible. |

#### B) DRAG & DROP

| Comportamiento | Detalle |
|---|---|
| Ghost element | Componente render prop que recibe la tarea, renderiza copia con `opacity-50` + `scale-95`. |
| Drop zones | `@dnd-kit` `useDroppable` con `over` → anillo azul Avante-500 (2 px). |
| Líneas guía | Entre elementos `<Sortable>`: `<SortableContext strategy={verticalListSortingStrategy}>`. |
| Reordenar en List | `reorderTask({ id, beforeId, afterId })` → recalcula `position` (ADR-001). |
| Kanban columnas | Cada columna es `<SortableContext>` independiente; cross-column mueve `columnId` + `status`. |
| Entre listas/proyectos | `moveTaskToParent` + actualiza `projectId`, `phaseId`, `sprintId` según destino. Validación: no mover entre proyectos si el usuario no tiene rol. |
| Reasignar por avatar | Pill del avatar es `<Draggable>`; zonas `<Droppable>` son las filas de otros assignees. Trigger = `assigneeId`. |
| Cambio fecha Gantt | Barra Gantt es `<Draggable>` horizontal con `modifiers: [restrictToHorizontalAxis]`. Delta en píxeles → días según escala. |
| Anidar subtareas | Hover sobre tarea padre > 400 ms con Shift → `parentId`. Visual: borde punteado + indentación preview. |
| Multi-selección | `selectedIds: Set<string>` en store Zustand. Ctrl/Cmd+Click toggle; Shift+Click rango. Al arrastrar cualquiera, `<DragOverlay>` muestra pila "+N". |
| Auto-scroll | `@dnd-kit`/`autoScroll` con `activationConstraint`. 8 px/frame. Desactivable via flag. |
| Indicadores | Drop target, ghost, línea guía, cursor = `grabbing`. |

#### C) MENÚS CONTEXTUALES

| Comportamiento | Detalle |
|---|---|
| Trigger | `<ContextMenu.Root>` de Radix envolviendo `<TaskCard>` y `<ColumnHeader>`. |
| Acciones tarea | Editar (abre Drawer), Duplicar (`duplicateTask`), Mover a ▸ (submenú), Copiar enlace (`/projects/{id}?task={taskId}`), Cambiar estado ▸, Asignar ▸, Etiquetar ▸, Archivar (`archiveTask`), Eliminar (`deleteTask` con confirm). |
| Acciones columna | Renombrar (inline), Cambiar color (swatch), Colapsar (store UI), Definir WIP, Eliminar. |
| Submenús | `<ContextMenu.Sub>` + `<ContextMenu.SubTrigger>`. |
| Atajos en menú | `<ContextMenu.Shortcut>` muestra "⌘D", "⌘⌫", etc. Deben coincidir con los de §A. |
| Posicionamiento inteligente | `collisionPadding={8}` y `avoidCollisions` de Radix — fuera del viewport → flip. |
| Cierre | Esc (nativo), click-away (nativo), selección de acción. Foco vuelve al trigger. |
| Acciones masivas | Si `selectedIds.size > 1` y el target está en la selección, menú adapta título y expone bulk actions. |

### 4.6 Casos borde

1. **Drag con red caída:** acción optimista + reintento x3 con backoff. Si falla, rollback visual + toast `role="alert"`.
2. **Tarea eliminada por otro usuario durante drag:** `reorderTask` responde 410 Gone → toast "Tarea no existe" + refresh.
3. **WIP limit excedido al mover a columna:** server rechaza, toast explicativo, tarea regresa.
4. **Scope vacío en "Mover a ▸":** el submenú muestra "No hay destinos disponibles".
5. **Sesión expirada:** action devuelve 401 → redirige a login conservando pending action en `sessionStorage`.
6. **Teclas colisionando con inputs:** `ShortcutProvider` consulta `document.activeElement.tagName` y `isContentEditable`.
7. **Navegador sin pointer events (solo teclado):** el path de `KeyboardSensor` de dnd-kit cubre todo el flujo.
8. **Menú contextual dentro de scroll container:** Radix `Portal` al body evita clipping.
9. **Tarea padre borrada con subtareas huérfanas:** `onDelete: Cascade` ya en schema.
10. **Doble clic derecho rápido:** Radix garantiza un solo menú abierto.

### 4.7 Requisitos no funcionales

| Atributo | Meta |
|---|---|
| Performance | TTI < 2 s en /list con 500 tareas. Reorder round-trip p95 < 300 ms. |
| Accesibilidad | WCAG 2.1 AA: contraste ≥ 4.5:1, focus visible, ARIA completo, SR announce en DnD. |
| Responsive | Mobile: DnD con long-press 350 ms; menú contextual via long-press; Drawer full-screen < 768 px. |
| Táctil | Tablets: `activationConstraint: { delay: 150, tolerance: 5 }`. |
| i18n | Strings en es-ES hoy; estructura lista para `next-intl`. |
| Seguridad | Todas las actions autenticadas (`auth()` antes de Prisma). Sanitización de inputs. Rate limit 30 req/s/usuario en reorder. |
| Telemetría | Evento `task.reorder`, `task.move`, `task.bulk_action`, `shortcut.used`. |

### 4.8 Dependencias técnicas

- Schema: nuevas columnas `Task.position`, `Task.archivedAt`, `Task.tags` (String[]).
- Auth helper `auth()` centralizado (deuda previa: hoy no existe; se introduce stub `lib/auth.ts`).
- Actions refactorizadas por dominio en `lib/actions/*.ts`.
- Componentes base `ShortcutProvider`, `ContextMenuPrimitive`, `SortableContainer`, `TaskDrawer`.
- Telemetría: wrapper `lib/telemetry.ts` (stub con `console.debug` si no hay OTel).

### 4.9 Wireframes descriptivos

```
┌───────────────────────── /list ───────────────────────────┐
│ Breadcrumbs: Avante › Ops › Proyecto Alfa                │
│ [Filters bar]  [view switch]           ⌘K     ? shortcuts│
├───────────────────────────────────────────────────────────┤
│ ▼ Sprint 12                                               │
│   ◻ T-101  Diseñar wireframes  [●IN-PRG][@EMA][Abr 22]   │← foco
│   ◻ T-102  Validar con stakeh. [●TODO] [@JMR][Abr 23]    │
│   ◻ T-103  Implementar DnD     [●TODO] [@EMA][Abr 25]    │
│                                                           │
│  (arrastre de T-103 sobre T-101 — línea guía azul)        │
└───────────────────────────────────────────────────────────┘
                                    ┌────────────────────────┐
                                    │  Drawer (Enter)        │
                                    │  T-101  Diseñar wiref. │
                                    │  [J ◀ ▶ K]  [× Esc]    │
                                    │  Estado · Asignado…    │
                                    └────────────────────────┘
```

Kanban + menú contextual:

```
 TODO          IN PROGRESS      REVIEW          DONE
┌──────┐      ┌──────┐         ┌──────┐         ┌──────┐
│ T-104│      │ T-101│<-right  │ T-100│         │ T-099│
│      │      │ ⚑    │  click  │      │         │      │
└──────┘      └──────┘  ▼      └──────┘         └──────┘
              ┌─────────────────┐
              │ ✎  Editar     E │
              │ ⎘  Duplicar   ⌘D│
              │ ➜  Mover a  ▸   │
              │ 🔗 Copiar URL ⌘L│
              │ —               │
              │ 🗃 Archivar     │
              │ 🗑 Eliminar   ⌘⌫│
              └─────────────────┘
```

---

## 5 · @UIUX — Especificación visual e interacción

### 5.1 Design tokens (delta)

| Token | Valor |
|---|---|
| `--color-focus-ring` | `#2563EB` (Avante-600) |
| `--color-drop-target` | `#3B82F6` |
| `--color-ghost-bg` | `rgba(37,99,235,0.08)` |
| `--shadow-drag` | `0 12px 24px -8px rgba(15,23,42,.25)` |
| `--radius-contextmenu` | `10px` |
| `--duration-spring` | `220ms` |
| `--easing-spring` | `cubic-bezier(.2,.9,.2,1)` |

### 5.2 Componentes visuales clave

| Componente | Estados |
|---|---|
| `TaskRow` / `TaskCard` | default, hover, focus-visible, selected, grabbing, dropTarget, error |
| `ContextMenu` | open, submenuOpen, disabled-item, destructive-item |
| `Drawer` | closed, opening (200 ms slide-in), open, closing |
| `Shortcut hint` | default, pressed |
| `Breadcrumbs` | overflow con `…` y tooltip |

### 5.3 Accesibilidad (WCAG 2.1 AA)

- Roles: `role="list"` + `role="listitem"` en List. `role="grid"` en Kanban con `aria-colindex`, `aria-rowindex`.
- `aria-grabbed` y `aria-dropeffect` gestionados por dnd-kit.
- `aria-keyshortcuts` en cada botón con atajo.
- Live region `<div aria-live="polite">` para anuncios de reorder: "Tarea movida a posición 4 de 10".
- Contraste: todos los pares cumplen ≥ 4.5:1 (texto normal) y ≥ 3:1 (bordes focus).
- Focus ring visible siempre con `outline-offset: 2px`.
- Prefers-reduced-motion: desactiva spring animations, mantiene transiciones mínimas (opacity).

### 5.4 Responsive & táctil

| Breakpoint | Ajustes |
|---|---|
| ≥ 1280 px | Drawer 520 px, menús contextuales completos |
| 768-1279 px | Drawer 420 px, columnas Kanban scroll horizontal |
| < 768 px | Drawer full-screen; DnD por long-press 350 ms; context menu por long-press; paleta "/" usa input + botón |

---

## 6 · @DBA — Modelo de datos y migraciones

### 6.1 Cambios de schema

```prisma
model Task {
  // ... campos existentes
  position     Float     @default(0)     // ADR-001 fractional indexing
  archivedAt   DateTime?                  // soft archive
  tags         String[]  @default([])     // etiquetas libres

  @@index([projectId, columnId, position])   // Kanban ordering
  @@index([projectId, parentId, position])   // List ordering
  @@index([archivedAt])                      // filtros rápidos
}
```

### 6.2 Migración (SQL generado por Prisma)

```sql
ALTER TABLE "Task"
  ADD COLUMN "position"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "tags"       TEXT[] NOT NULL DEFAULT '{}';

-- backfill: asigna position ascendente por createdAt dentro de cada (project, column)
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "projectId", "columnId" ORDER BY "createdAt") AS rn
  FROM "Task"
)
UPDATE "Task" t SET "position" = o.rn FROM ordered o WHERE t.id = o.id;

CREATE INDEX "Task_projectId_columnId_position_idx"
  ON "Task"("projectId","columnId","position");
CREATE INDEX "Task_projectId_parentId_position_idx"
  ON "Task"("projectId","parentId","position");
CREATE INDEX "Task_archivedAt_idx" ON "Task"("archivedAt");
```

**Estrategia zero-downtime:** expand (agregar columnas nullables + índices concurrently) → backfill → contract (defaults NOT NULL). Prisma Migrate lo hace en un sólo paso; para producción con tráfico, dividir en 2 PR.

### 6.3 Reindex periódico

Job nocturno (cron `0 3 * * *`): si `MAX(position) - MIN(position) > 1e6` en algún scope, renumera `1..N` en transacción.

### 6.4 Rendimiento

`EXPLAIN ANALYZE` esperado para `/kanban` de un proyecto con 1 000 tareas:

```
Index Scan using Task_projectId_columnId_position_idx on "Task"
  Index Cond: (projectId = $1)
  Rows=1000 · Buffers shared hit=14 · Exec time < 6 ms
```

---

## 7 · @Dev — Plan de implementación

### 7.1 Sprint 0 (1 día) — Fundaciones

- Instalar 8 dependencias (§2.2).
- Migrar schema (§6).
- Crear `src/lib/stores/ui.ts` (Zustand: selectedIds, drawerTaskId, filters).
- Crear `src/lib/actions/tasks.reorder.ts`.
- Crear `src/lib/hooks/useTaskShortcuts.ts`.
- Crear `src/components/interactions/ContextMenuPrimitive.tsx`.
- Crear `src/components/interactions/SortableContainer.tsx`.
- Crear `src/components/interactions/TaskDrawer.tsx`.
- Documentar en `docs/sdlc/ADRs/`.

### 7.2 Sprint 1 (5 días) — Vista List

- `SortableTaskRow` con handle + drop zones + keyboard sensor.
- Shortcuts: ↑↓, Enter, Esc, T, /, E, A, S, D, ?, J/K.
- Drawer con breadcrumbs y next/prev.
- Context menu (básico: editar, duplicar, archivar, eliminar).

### 7.3 Sprint 2 (5 días) — Vista Kanban

- Columnas `<SortableContext>` + cross-column DnD.
- Context menu de columna.
- Multi-selección + bulk actions.
- WIP limit enforcement en server action.

### 7.4 Sprint 3 (5 días) — Vista Gantt

- Drag horizontal de barras (start/end/body).
- Resize handlers con cursors `ew-resize`.
- Live region announces "Fecha movida a …".

### 7.5 Sprint 4 (3 días) — Cross-vista y pulido

- Paleta de comandos (fuse.js).
- Breadcrumbs globales.
- Preservación de filtros entre vistas (URL searchParams).
- Overlay de atajos (?).

### 7.6 Stubs y archivos nuevos

Ver §11 del documento (entregado en `src/` por @Dev en esta misma iteración como scaffolding).

---

## 8 · @QA + @QAF — Plan de pruebas

### 8.1 Pirámide

| Nivel | Herramienta | Cobertura objetivo |
|---|---|---|
| Unit | Vitest + React Testing Library | ≥ 80 % de `lib/actions/*` y hooks |
| Component | RTL + `@testing-library/user-event` | Cada componente de interactions |
| Integration | Vitest + `msw` para Prisma mock | Server actions |
| E2E | Playwright | 25 escenarios (uno por criterio Gherkin) |
| Accesibilidad | axe-core + Playwright | 0 violaciones serious/critical |
| Performance | k6 (API) + Lighthouse CI (web) | p95 reorder < 300 ms; LCP < 2 s |

### 8.2 Archivos de prueba a crear

- `src/lib/actions/__tests__/reorder.test.ts`
- `src/lib/hooks/__tests__/useTaskShortcuts.test.ts`
- `src/components/interactions/__tests__/ContextMenuPrimitive.test.tsx`
- `tests/e2e/list-dnd.spec.ts`
- `tests/e2e/kanban-dnd.spec.ts`
- `tests/e2e/keyboard-nav.spec.ts`
- `tests/e2e/context-menu.spec.ts`
- `tests/a11y/axe.spec.ts`
- `tests/perf/reorder.k6.js`

### 8.3 Features Gherkin (BDD @QAF)

Se entregan en `tests/features/*.feature` alineados 1:1 con §4.4. Archivos:

- `navegacion.feature`
- `drag-drop.feature`
- `context-menu.feature`
- `accesibilidad.feature`
- `responsive.feature`

Cada feature incluye `Background:` con autenticación y seed de datos determinista.

### 8.4 Datos de prueba

Seed específico en `prisma/seed.ts`: 1 gerencia, 1 área, 1 proyecto, 3 columnas, 30 tareas con distintos estados/prioridades. Helper `tests/fixtures/tasks.ts` clona el seed.

### 8.5 Gates de calidad CI

- Lint + typecheck bloqueantes.
- Unit + component ≥ 80 %.
- E2E suite debe pasar en Chromium, Firefox y WebKit.
- Axe = 0 serious.
- Lighthouse Performance ≥ 85.

---

## 9 · @SRE — Entrega y operación

### 9.1 Dockerfile (multi-stage)

```dockerfile
# ---- deps ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

Config en `next.config.ts`: `output: 'standalone'`.

### 9.2 docker-compose.yml (dev)

```yaml
services:
  web:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on: [db]
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: dev
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata:
```

### 9.3 Kubernetes (manifiestos base)

- `k8s/deployment.yaml` — 2 réplicas, HPA por CPU 70 %, readinessProbe `/api/health`.
- `k8s/service.yaml` — ClusterIP.
- `k8s/ingress.yaml` — TLS por cert-manager.
- `k8s/configmap.yaml` — flags.
- `k8s/secret.yaml` — `DATABASE_URL` (sealed-secrets).
- `k8s/networkpolicy.yaml` — egreso solo a DB y observabilidad.

### 9.4 Terraform (resumen)

Módulos: `vpc`, `rds-postgres` (con backup 7 d + PITR), `ecs-fargate` (o `eks`), `alb`, `secrets-manager`, `cloudwatch-alarms` (5xx rate, reorder-latency).

### 9.5 Observabilidad

- `@vercel/otel` → OTLP → Grafana Cloud.
- Dashboards: *Reorder latency p50/p95/p99*, *DnD failure rate*, *Shortcut usage heatmap*, *Context menu open rate por acción*.
- SLOs: reorder success rate ≥ 99.5 %, latency p95 ≤ 300 ms.

### 9.6 CI/CD (GitHub Actions)

`.github/workflows/ci.yml`:

1. lint + typecheck
2. prisma validate + migrate dry-run
3. unit + component (vitest)
4. e2e (playwright matrix 3 browsers)
5. axe
6. docker build + scan (trivy)
7. deploy preview (Vercel) en PR
8. deploy production (main) con gate manual

---

## 10 · DoD & Gate de @Orq

Una PR relacionada a EPIC-001 se considera lista para merge sólo si cumple **todos** los puntos:

- [ ] Código en el path indicado por @AS; sin lógica Prisma fuera de `lib/actions/*`.
- [ ] `npm run lint` y `tsc --noEmit` sin errores.
- [ ] Tests unitarios agregados; cobertura del módulo tocado ≥ 80 %.
- [ ] Al menos un escenario Gherkin cubierto por Playwright.
- [ ] axe-core = 0 violaciones serious.
- [ ] Navegación completa por teclado verificada manualmente.
- [ ] Responsive revisado en 1440 / 1024 / 390 px.
- [ ] Telemetría disparada para la nueva acción.
- [ ] ADR actualizado si cambió una decisión.
- [ ] Entrada en `CHANGELOG.md`.

**Criterio de "Completado" del EPIC (autorización exclusiva de @Orq):**
los 25 escenarios Gherkin pasan en CI, el reporte de @QA muestra cobertura y métricas objetivo cumplidas, y @SRE confirma despliegue estable > 48 h con SLO respetado.

---

*Documento vivo. Versión 1.0 — emitida por @Orq. Cambios mayores requieren ADR nuevo y sign-off @AE + @AS.*
