# Seed · proyecto base "Sync"

Script idempotente que carga un proyecto agile completo con la historia
real de desarrollo del propio sistema (auto-historial Wave P0 → post-P10).

## Qué carga

| Entidad | Cantidad | Detalle |
|---|---|---|
| Workspace | 1 | `Avante · Default` |
| Gerencia | 1 | `Tecnología` |
| Área | 1 | `Desarrollo de Sistemas` |
| Project | 1 | `Sync · FollowupGantt` (status ACTIVE, agile) |
| Releases | 5 | R1 MVP · R2 Hardening · R3 AI/Enterprise · R4 Agile Maturity · R5 Portfolio + Sync |
| Epics | 10 | Una por Wave (P0, P1, P2-5, P6, P7, P8, P9, P10, post-P10, tech debt) |
| Sprints | 10 | Una por Wave, todas en estado COMPLETED con velocity actual |
| Tasks raíz | 40+ | Las HUs documentadas + 7 bugfixes ITIL_TICKET + 1 milestone |
| Subtasks | varias | Ej. CPM forward/backward pass, tests ciclos |
| DoR/DoD | sí | Templates en el proyecto a nivel producto |
| ReleaseEpic | 9 | Asociaciones M2M epic ↔ release |

Todas las entidades usan IDs prefijados `sync_*` para no chocar con los
seeds de tests (`test_*`) ni con datos productivos.

## Pre-condiciones

- Variable `DATABASE_URL` apuntando a la base destino.
- Al menos un User en BD (el seed lo elige como `owner`).
  - Opcionalmente, exportar `SYNC_OWNER_USER_ID` para forzar owner específico.

## Cómo correr

```bash
DATABASE_URL=postgresql://... tsx prisma/seed-sync-project.ts
```

Salida esperada:
```
🌱 Seed Sync project base · iniciando…
   Owner: <userId>
   ✓ Workspace Avante · Default
   ✓ Gerencia Tecnología → Área Desarrollo de Sistemas
   ✓ Project Sync (status=ACTIVE, agile)
   ✓ 5 Releases
   ✓ 10 Epics asociadas a sus Releases
   ✓ 10 Sprints (todos COMPLETED)
   ✓ 40+ tasks raíz + subtasks

🎉 Seed completado.
```

## Idempotencia

`upsert` por id en todas las entidades. Re-ejecutar no duplica datos:
solo refresca los campos. Útil cuando se itera sobre el contenido del
seed durante demos.

## Verificación post-seed

1. Abrir Sync (Vercel preview o local).
2. Sidebar → Configuración → Proyectos → debe aparecer "Sync · FollowupGantt".
3. Click → vista detalle muestra ~40+ tareas agrupadas por Sprint.
4. Sidebar → Agile → Releases/Roadmap → 5 Releases con sus Epics.
5. Sidebar → Agile → Epics → 10 Epics con su color y Release asociada.
6. Sidebar → Agile → Backlog → grid jerárquico Epic → Story → Task → Subtask.
7. Sidebar → Agile → Sprints → 10 Sprints en histórico (velocity actual).
8. Sidebar → Portafolio → vista ejecutiva incluye este proyecto en cards.
9. Sidebar → Agile → DoR & DoD → muestra templates a nivel proyecto.

## Limpiar el seed

Si necesitas borrar todo lo cargado por este script (sin tocar otros
proyectos):

```sql
-- En orden por FK (subtasks antes que parent, etc).
DELETE FROM "Task" WHERE id LIKE 'sync_t_%' OR id LIKE 'sync_milestone_%';
DELETE FROM "ReleaseEpic" WHERE "epicId" LIKE 'sync_epic_%';
DELETE FROM "Epic" WHERE id LIKE 'sync_epic_%';
DELETE FROM "Sprint" WHERE id LIKE 'sync_sprint_%';
DELETE FROM "Release" WHERE id LIKE 'sync_rel_%';
DELETE FROM "Project" WHERE id = 'sync_proj_main';
DELETE FROM "Area" WHERE id = 'sync_area_dev_sistemas';
DELETE FROM "Gerencia" WHERE id = 'sync_ger_tecnologia';
-- Workspace y membership: opcional, si no se usa para otra cosa
DELETE FROM "WorkspaceMember" WHERE "workspaceId" = 'sync_ws_default';
DELETE FROM "Workspace" WHERE id = 'sync_ws_default';
```

## Por qué este seed

Edwin pidió un proyecto base que **funcione como auto-demo** del
sistema, mostrando todas las capacidades (Releases + Epics + Sprints +
Backlog jerárquico + Bugfixes + DoR/DoD + Hitos) con datos realistas
y ya completados, en lugar de tener que crearlos manualmente para
cada demo.
