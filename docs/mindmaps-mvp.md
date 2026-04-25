# Sprint: Módulo Mapas Mentales (MVP)

**Orquestador:** @Orq · **Fecha:** 2026-04-25 · **Referencia funcional:** MindMup 3

---

## Fase 1 — Evaluación (@AE)

### Alineación estratégica con Avante

El módulo **Mapas Mentales** extiende FollowupGantt desde gestión de tareas (PMI/Agile/ITIL) hacia **gestión de conocimiento visual**, alineado con el pilar "Transformación Digital" de la Unidad.

**Casos de uso respaldados:**

| Caso | Stakeholder | Valor |
|---|---|---|
| Lluvia de ideas en fase de conceptualización | @PO, PM | Acelera discovery, reduce iteraciones tardías |
| WBS visual (Work Breakdown Structure) | Project Managers | PMBOK §5.4 — descomposición jerárquica visible |
| Mapa de arquitectura / dominio | @AS, @AT | TOGAF — modelado de business capabilities |
| Documentación viva de procesos | @AE, auditoría | ITIL KM — *Service Knowledge Management System* |
| Planeación de dependencias (enlaces a Task) | PM + equipos | Cierra brecha entre ideación y ejecución |

### Cumplimiento y gobernanza

- **COBIT 2019 · BAI03** (Gestión de soluciones): el módulo incorpora versionado de mindmaps (vía `updatedAt`) para trazabilidad de cambios.
- **COBIT · DSS06** (Controles de procesos de negocio): los mindmaps se asocian a `Project` y `User` — se mantiene el control de acceso existente.
- **Sin impacto legal adicional** — sólo persistencia interna; no hay datos personales nuevos más allá de `ownerId`.

### Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Bundle size de `@xyflow/react` (~70 KB gzip) | Alta | Bajo | Lazy-load del editor; listado no lo carga |
| Curva de aprendizaje del equipo | Media | Medio | Docs de patrones + code review con @UIUX |
| Schema migration sin baseline Prisma | Media | Medio | Usar `db push` (patrón actual del repo); @SRE documenta runbook |
| Performance en mapas grandes (>500 nodos) | Baja | Alto | Virtualization y cap MVP a 200 nodos; deuda post-MVP |

---

## Fase 2 — Diseño

### @AS · Arquitectura de software

**Patrón:** Feature-sliced dentro de la app Next.js 16.

```
src/
├── app/mindmaps/
│   ├── page.tsx                      # RSC: listado de mindmaps
│   └── [id]/
│       └── page.tsx                  # RSC: editor fullscreen
├── components/mindmap/
│   ├── MindMapEditor.tsx             # Canvas xyflow (client)
│   ├── MindMapList.tsx               # Grid de mindmaps (client)
│   ├── MindMapNodeCard.tsx           # Custom node (inline edit + note icon)
│   ├── NotePanel.tsx                 # Panel lateral de nota expandida
│   └── use-mindmap-shortcuts.ts      # Keyboard bindings
└── lib/actions/
    └── mindmap.ts                    # Server actions CRUD
```

**Flujo de datos:**

```
[User] → xyflow onNodesChange/onEdgesChange (local) →
  debounce 500 ms → server action (Prisma upsert) →
    revalidatePath('/mindmaps/[id]')
```

**Principios aplicados:**

- **Optimistic updates**: cambios locales inmediatos, sync diferida.
- **Server Actions con validación de permisos** (patrón existente: `userRoles` + `projectAssignments`).
- **No acoplamiento con Task** — `MindMapNode.taskId` es opcional; un mindmap puede vivir sin ninguna task.

### @DBA · Modelo de datos (Prisma)

Tres nuevas entidades + extensión de `Project` y `User`:

```prisma
model MindMap {
  id          String   @id @default(uuid())
  title       String
  description String?
  projectId   String?
  project     Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)
  ownerId     String?
  owner       User?    @relation("MindMapOwner", fields: [ownerId], references: [id], onDelete: SetNull)
  nodes       MindMapNode[]
  edges       MindMapEdge[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model MindMapNode {
  id          String   @id @default(uuid())
  mindMapId   String
  mindMap     MindMap  @relation(fields: [mindMapId], references: [id], onDelete: Cascade)
  label       String   @default("Nuevo nodo")
  note        String?  // Markdown o texto libre (nota expandida)
  x           Float    @default(0)
  y           Float    @default(0)
  color       String?
  isRoot      Boolean  @default(false)
  taskId      String?  // Enlace opcional a Task
  task        Task?    @relation("TaskMindMapNodes", fields: [taskId], references: [id], onDelete: SetNull)
  sourceEdges MindMapEdge[] @relation("EdgeSource")
  targetEdges MindMapEdge[] @relation("EdgeTarget")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([mindMapId])
}

model MindMapEdge {
  id        String      @id @default(uuid())
  mindMapId String
  mindMap   MindMap     @relation(fields: [mindMapId], references: [id], onDelete: Cascade)
  sourceId  String
  source    MindMapNode @relation("EdgeSource", fields: [sourceId], references: [id], onDelete: Cascade)
  targetId  String
  target    MindMapNode @relation("EdgeTarget", fields: [targetId], references: [id], onDelete: Cascade)
  label     String?

  @@unique([sourceId, targetId])
  @@index([mindMapId])
}
```

### @AT · Infraestructura / Despliegue

- **Sin cambios de infra**: la feature es client-heavy + server actions + DB Postgres existente.
- **Bundle**: `@xyflow/react` se carga solo en `/mindmaps/[id]` vía Next.js code-splitting automático.
- **Vercel**: sin configuraciones nuevas. `next.config.ts` no cambia.

---

## Fase 3 — Planificación (@PO)

### Backlog MVP priorizado

| # | Historia | Prioridad | Estimación | Criterios de aceptación |
|---|---|---|---|---|
| H-01 | Como PM quiero crear un mindmap nuevo | Must | 1 pt | El listado muestra el mindmap creado; abre en editor vacío con un nodo raíz |
| H-02 | Como usuario quiero agregar nodos haciendo clic en el canvas | Must | 2 pt | Clic en canvas crea nodo con label "Nuevo nodo" en la posición del click |
| H-03 | Como usuario quiero editar el label de un nodo haciendo doble clic | Must | 2 pt | Doble clic activa input inline; Enter/blur guarda; Escape cancela |
| H-04 | Como usuario quiero eliminar nodos con la tecla Delete | Must | 1 pt | Nodo(s) seleccionado(s) + Delete → se eliminan (cascada borra edges conectadas) |
| H-05 | Como usuario quiero conectar dos nodos arrastrando desde un handle | Must | 3 pt | Drag desde handle source → drop en target crea edge; persiste en DB |
| H-06 | Como usuario quiero agregar una nota expandida a un nodo | Must | 2 pt | Icono "nota" en nodo → abre panel lateral con textarea; guarda al blur |
| H-07 | Como usuario quiero usar Tab para crear un nodo hijo | Should | 2 pt | Con nodo seleccionado, Tab crea hijo conectado con edge |
| H-08 | Como usuario quiero usar Enter para crear un nodo hermano | Should | 2 pt | Con nodo seleccionado, Enter crea sibling (mismo padre) |
| H-09 | Como usuario quiero hacer zoom y pan en el canvas | Must | 1 pt | Scroll = zoom, drag canvas = pan, botones Fit/Zoom-in/Zoom-out |
| H-10 | Como PM quiero listar todos mis mindmaps | Must | 1 pt | Grid con título + preview + fecha; clic abre editor |
| H-11 | Como PM quiero renombrar y eliminar un mindmap | Must | 1 pt | Context menu en card del listado |
| H-12 | Como usuario quiero enlazar un nodo a una Task existente | Could | 2 pt | Panel lateral: select de Task; al seleccionar, el nodo muestra mnemónico |

**Total MVP:** 20 pts.

### Out-of-scope (deuda post-MVP)

- Real-time collaboration (WebSockets/Liveblocks)
- Import/export (FreeMind, OPML, Markdown)
- Auto-layout (dagre, elkjs)
- Theming avanzado por nodo (paletas, íconos)
- Touch gestures mobile
- Undo/Redo
- Versionado de mindmap (snapshots)

---

## Fase 3 — Diseño visual (@UIUX)

### Tokens y estilos

Reutilizamos **Avante Neutral+** — no se introducen tokens nuevos. El editor usa:

- Canvas background: `bg-background` con dot-grid `bg-subtle/40` (xyflow `background variant="dots"`)
- Nodo: `bg-card border border-border rounded-xl shadow-lg`, seleccionado `ring-2 ring-ring`
- Nodo raíz: `bg-indigo-500/15 border-indigo-500/40 text-foreground`
- Edge: `stroke-border`, seleccionado `stroke-ring`
- Handles: `bg-primary` pequeños, visibles solo on hover
- Controls (zoom/fit): `bg-card border border-border` con iconos `text-muted-foreground`
- Note icon en nodo: `text-amber-300` cuando tiene nota, `text-muted-foreground/50` cuando no

### Microinteracciones

- **Nodo drag**: cursor `grabbing`, shadow aumenta (`shadow-2xl`).
- **Edge creation**: línea punteada mientras se arrastra, confirmación sonora opcional (no MVP).
- **Inline edit**: `<input>` reemplaza label, auto-focus, `outline-2 outline-ring`.
- **Delete**: fade-out 150ms antes de desaparecer (CSS transition).

### Accesibilidad

- `role="application"` en canvas con `aria-label="Editor de mapa mental"`
- Nodos con `role="treeitem"` si son parte de jerarquía, `role="button"` si son nodos sueltos
- Keyboard-only: Tab navegación entre nodos, flechas para mover nodo seleccionado
- `prefers-reduced-motion` desactiva las transiciones

---

## Fase 6 — Entrega (@SRE) · Runbook

### Pre-despliegue

1. Merge del PR a `master`.
2. En entorno local o de staging, aplicar schema:
   ```bash
   npx prisma db push --accept-data-loss
   npx prisma generate
   ```
3. Verificar que no haya errores en `prisma generate` ni en `npm run build`.

### Despliegue

- Vercel detecta el merge y dispara build automático.
- `postinstall` corre `prisma generate`.
- Sin variables de entorno nuevas requeridas.

### Rollback

- Revertir commit → Vercel redeploya el anterior.
- Las tablas `MindMap*` quedan huérfanas pero no bloquean (NO borrar data — `onDelete: Cascade` en relaciones salvaguarda integridad).

### Monitoreo

- Sin métricas custom en MVP. Deuda: agregar panel en Grafana con `count(mindmaps)` y `avg(nodes_per_mindmap)`.

---

## Anexo — Comparativa con MindMup 3

| Feature MindMup 3 | Presente en MVP | Notas |
|---|---|---|
| Canvas infinito con pan/zoom | ✅ | xyflow nativo |
| Crear/editar/eliminar nodos | ✅ | H-02, H-03, H-04 |
| Conectores jerárquicos | ✅ | H-05, H-07, H-08 |
| Conectores libres entre nodos | ✅ | H-05 |
| Notas expandidas | ✅ | H-06 |
| Keyboard shortcuts (Tab, Enter, Delete) | ✅ | H-07, H-08 |
| Drag de nodos | ✅ | xyflow nativo |
| Autosave | ✅ | Debounce 500ms en xyflow change events |
| Colapsar/expandir ramas | ❌ | Post-MVP |
| Iconos por nodo | ❌ | Post-MVP |
| Import OPML/FreeMind | ❌ | Post-MVP |
| Colaboración realtime | ❌ | Post-MVP |
| Presentación (modo slideshow) | ❌ | Post-MVP |
