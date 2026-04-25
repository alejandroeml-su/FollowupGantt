# Release Notes — Mindmaps MVP

**Versión:** 1.0.0 · **Responsable entrega:** @SRE · **Fecha objetivo:** 2026-04-28

## Qué se entrega

Módulo **Mapas Mentales** (ruta `/mindmaps`) con capacidades de brainstorming visual estilo MindMup 3:

- Listado de mapas con crear / renombrar / eliminar.
- Editor canvas con `@xyflow/react`: pan, zoom, minimap, controles.
- Nodos: crear (doble click en canvas), editar label inline (doble click), eliminar (Delete), drag para reposicionar.
- Conectores: drag desde handle source → target.
- Notas expandidas (Markdown) con autosave debounced.
- Enlace opcional de nodo a `Task` con buscador.
- Keyboard shortcuts: **Tab** (hijo), **Enter** (hermano), **Delete** (eliminar), **Escape** (deseleccionar).
- Accesibilidad: aria-labels, navegación por teclado, respeta `prefers-reduced-motion` (xyflow nativo).

## Cambios técnicos

### Nueva dependencia

- `@xyflow/react@^12` — ~70 KB gzip, carga diferida sólo en `/mindmaps/[id]`.

### Schema Prisma (3 nuevas tablas)

- `MindMap` — contenedor (título, descripción, project?, owner?, timestamps).
- `MindMapNode` — nodo (label, note, x, y, color, isRoot, taskId?).
- `MindMapEdge` — conector (`@@unique([sourceId, targetId])`).

Extensiones: `User.mindMaps`, `Project.mindMaps`, `Task.mindMapNodes`.

### Server actions

Nuevo archivo [src/lib/actions/mindmap.ts](../src/lib/actions/mindmap.ts):
- `createMindMap`, `renameMindMap`, `deleteMindMap`
- `createMindMapNode`, `updateMindMapNode`, `deleteMindMapNode`
- `createMindMapEdge`, `deleteMindMapEdge`
- `syncNodePositions` (transacción batch)
- `getMindMapList`, `getMindMapById`

### UI

- [src/app/mindmaps/page.tsx](../src/app/mindmaps/page.tsx) — listado (reemplaza la vista árbol estática previa).
- [src/app/mindmaps/[id]/page.tsx](../src/app/mindmaps/[id]/page.tsx) — editor fullscreen.
- [src/components/mindmap/*](../src/components/mindmap) — `MindMapEditor`, `MindMapListClient`, `MindMapNodeCard`, `NotePanel`, `use-mindmap-shortcuts`.

## Runbook de despliegue

### 1. Pre-requisitos

- Branch `feat/mindmaps-mvp` mergeada a `master` vía PR (CI verde).
- Variables de entorno: **sin cambios**.

### 2. Migración de schema

El repo no usa `prisma migrate` (decisión documentada en `project_followupgantt_tech.md`). Se usa `db push`.

**En dev local:**
```bash
npx prisma db push --accept-data-loss
npx prisma generate
```

**En producción (Supabase):**
```bash
DATABASE_URL="$PRODUCTION_DATABASE_URL" npx prisma db push --accept-data-loss
```

Las 3 tablas nuevas son **aditivas** — no hay pérdida de datos.

### 3. Build y deploy

Vercel detecta el merge y dispara build automático:

1. `npm ci` (lockfile actualiza `@xyflow/react`).
2. `postinstall` → `prisma generate`.
3. `npm run build` → incluye `prisma generate && next build`.
4. Deploy a producción.

### 4. Verificación post-deploy

- [ ] Navegar a `/mindmaps` → se ve el empty state O el listado existente.
- [ ] Crear un mapa nuevo → redirect a `/mindmaps/[id]`.
- [ ] Doble click en canvas → crea nodo.
- [ ] Conectar dos nodos con drag entre handles.
- [ ] Agregar nota → verificar persistencia al recargar.
- [ ] Atajos Tab / Enter / Delete funcionales.
- [ ] No hay errores en logs de Vercel.

### 5. Rollback

Si algo falla en producción:

```bash
git revert <commit-merge>
git push origin master
```

Vercel redeploya automáticamente. Las tablas Mindmap* quedan vivas pero no se usan — no afecta otras features.

Para limpiar las tablas:
```bash
DATABASE_URL="$PRODUCTION_DATABASE_URL" npx prisma db push --accept-data-loss
# (tras revertir el schema también)
```

## Métricas a observar (primera semana)

- **Adopción:** `count(mindmaps)` + `count(distinct ownerId)` — objetivo: >5 mapas creados por PMs.
- **Performance:** tiempo de render del editor con 50 nodos — objetivo: <300ms.
- **Errores:** ratio de toasts error en `createMindMapNode` / `createMindMapEdge` — objetivo: <1%.

Deuda: agregar panel Grafana `FollowupGantt · Mindmaps` post-MVP.

## Deuda registrada (backlog post-MVP)

1. Colapsar/expandir ramas.
2. Undo/Redo.
3. Import/Export OPML / FreeMind / Markdown.
4. Auto-layout (dagre o elkjs).
5. Colaboración realtime (Liveblocks / Yjs).
6. Theming avanzado por nodo (paletas, íconos).
7. Presentación modo slideshow.
8. Versionado (snapshots).

## Contactos

- **Producto:** @PO (Edwin Martínez)
- **Tech lead:** @Dev
- **QA:** @QAF + @QA
- **SRE:** este runbook
