# `task-form/` — Formulario unificado de tareas

Este módulo contiene la **fuente de verdad** de la captura/edición de tareas
para FollowupGantt. Sustituye la lógica que vivía duplicada entre
`TaskCreationModal` (modal de creación) y `TaskDrawerContent` (drawer de
edición). Tras Sprint 5, ambos contenedores son capas delgadas que envuelven
`<TaskForm>`.

## Propósito

- Garantizar que crear y editar una tarea use **la misma UI y los mismos
  contratos** (validación, accesibilidad, persistencia).
- Aislar el formulario en un único componente para que cambios de campo se
  hagan en un sólo archivo (no en modal + drawer).
- Permitir crecer el formulario (tabs, sidebar) sin tocar los contenedores.

## API del componente

```ts
type TaskFormProps = {
  mode: 'create' | 'edit'
  task?: SerializedTask                   // requerido en mode='edit'
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  phases?: PhaseOption[]                  // épicas por proyecto
  sprints?: SprintOption[]
  allTasks?: ParentOption[] | SerializedTask[]
  defaultParentId?: string                // mode='create'
  defaultStatus?: TaskStatus              // mode='create'
  onCreated?: (taskId: string) => void
  onUpdated?: (taskId: string) => void
  onCancel?: () => void
  renderHeaderLeft?: (ctx: HeaderActionsContext) => React.ReactNode
  renderHeaderActions?: (ctx: HeaderActionsContext) => React.ReactNode
  hideFooter?: boolean
  layout?: 'modal' | 'drawer'             // default 'modal'
  formId?: string
}
```

`HeaderActionsContext` expone `{ isEditing, isPending, setEditing, saveAll }`
para que el padre pueda inyectar breadcrumbs y botones Editar/Guardar
manteniendo una sola fila visual (drawer).

## Diferencias entre `mode='create'` y `mode='edit'`

| Comportamiento | `create` | `edit` |
|---|---|---|
| Título | Espera "Guardar" global | Inline (botón Editar/Guardar global del drawer) |
| Descripción | Espera "Guardar" global | Inline mediante "Editar" |
| Tabs distintas a Detalle | Disabled con tooltip | Activas con count |
| Sidebar (TaskMetaSidebar) | Editable, espera "Guardar" | Embebida como sección "Contexto"; algunos campos persisten inline |
| Subtareas | Bloqueadas (placeholder) | CRUD inline |
| Colaboradores | Bloqueados (placeholder) | Add/remove optimista |
| Mnemónico | No visible | Chip arriba del título |
| Layout | 2 columnas con sidebar 240px | 1 columna fluida (drawer) |
| Footer | Cancelar / Crear | Sin footer (`hideFooter`) |

## Subcomponentes

- **`TaskMetaSidebar.tsx`** — sidebar 240px (en modal) / sección embebida
  (en drawer): Estado, Responsable, Colaboradores, Proyecto, Épica, Sprint,
  Hito, Inicio, Entrega, Estimación.
- **`TaskFormTabs.tsx`** — barra de tabs accesible (role=tablist) con
  soporte de `disabled + disabledReason` y `count`.
- **`PriorityPills.tsx`** / **`StatusPills.tsx`** — radio-groups con flechas,
  Home/End, focus management.
- **`TagChipInput.tsx`** — chip-input controlado, autocomplete sobre
  sugerencias, A11y combobox.
- **`CollaboratorsField.tsx`** — avatares + popover, optimista, M:N contra
  `addTaskCollaborator/removeTaskCollaborator`.
- **`ReferenceUrlField.tsx`** — input URL, validación http/https, persiste
  onBlur en mode=edit (`updateTaskReferenceUrl`).
- **`tabs/SubtasksTab.tsx`** — checklist inline (status check + asignado +
  progreso) con `createSubtaskInline`, `toggleSubtaskDone`,
  `assignSubtaskInline`.
- **`tabs/CommentsTab.tsx`** — comentarios públicos/internos
  (`createComment`).
- **`tabs/HistoryTab.tsx`** — render del array `task.history`.
- **`tabs/AttachmentsTab.tsx`** — drop-zone simulado + URL referencia
  (`createAttachment`).
- **`tabs/DependenciesTab.tsx`** — relaciones FS/SS/FF/SF
  (`addDependency`, `removeDependency`).

## Server actions utilizadas

| Acción | Archivo |
|---|---|
| `createTask`, `updateTask` | `src/lib/actions.ts` |
| `createSubtaskInline`, `toggleSubtaskDone`, `assignSubtaskInline` | `src/lib/actions.ts` |
| `createComment` | `src/lib/actions.ts` |
| `createAttachment` | `src/lib/actions.ts` |
| `addDependency`, `removeDependency` | `src/lib/actions.ts` |
| `listProjectTags` | `src/lib/actions/tags.ts` |
| `addTaskCollaborator`, `removeTaskCollaborator`, `updateTaskReferenceUrl` | `src/lib/actions/collaborators.ts` |

## Cómo añadir un campo nuevo

1. **Schema** — añadir la columna en `prisma/schema.prisma` y crear migración
   versionada en `prisma/migrations/`.
2. **Server action** — extender `createTask` / `updateTask` (o crear acción
   propia `update<Field>`) en `src/lib/actions.ts` o `src/lib/actions/<dominio>.ts`,
   con su Zod schema y `revalidatePath` correspondiente.
3. **Tipos** — añadir el campo a `SerializedTask` y a `serializeTask` en
   `src/lib/types.ts`.
4. **UI** — añadir el control dentro de `TaskForm.tsx` (cuerpo Detalle) o
   `TaskMetaSidebar.tsx` (si es metadato lateral). Respetar tokens del DS
   Avante Neutral+. Si el campo es complejo (chips, popover…) extraerlo a su
   propio archivo dentro de `task-form/`.
5. **README** — actualizar la tabla de subcomponentes y de server actions.

## Decisiones cerradas (Sprints 1–5)

- **Modal + drawer híbrido** (no página dedicada): el modal cubre el flujo
  de captura rápida, el drawer cubre el de revisión / edición de campo a
  campo.
- **Phase como Épica**: se reutiliza el modelo `Phase` de Prisma — no se
  introduce un modelo `Epic` nuevo (deuda separada en backlog).
- **Colaboradores M:N**: tabla `TaskCollaborator` con UNIQUE(taskId, userId).
- **Tags como chips**: array `tags string[]` en `Task` + autocomplete
  scoped por proyecto vía `listProjectTags`.
- **URL referencia**: campo `referenceUrl` opcional en `Task`, validado
  http/https client-side y server-side.
- **Tabs compartidas**: misma `TaskFormTabs` para creación y edición; en
  creación las distintas a Detalle quedan disabled hasta guardar.
- **Sidebar 240px** (modal) y **sección "Contexto"** (drawer): mismo
  `TaskMetaSidebar` con prop `mode`.
- **Persistencia mixta en edit**: campos cuantitativos (fechas,
  plannedValue, actualCost) persisten onBlur; resto persiste con el botón
  global "Guardar".
- **Sin sesión real (deuda)**: rol hardcoded `SUPER_ADMIN` y `userId =
  users[0].id` hasta que exista auth real.
