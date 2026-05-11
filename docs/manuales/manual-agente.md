# Manual de Usuario · Agente

> **Rol:** `USER` (anteriormente `AGENTE`)
> **Plataforma:** Sync (FollowupGantt) — R4.0 GA · 2026-05-11
> **Audiencia:** Desarrolladores, consultores, analistas y cualquier colaborador operativo del equipo.

📁 **Capturas de pantalla:** las imágenes referenciadas con `📸 Captura sugerida:` se ubican en [`./screenshots/`](./screenshots/). Si aún no las ves, consulta [`screenshots/README.md`](./screenshots/README.md) para la guía de cómo tomarlas paso a paso.

---

## Índice

1. [¿Qué hago en Sync?](#1-qué-hago-en-sync)
2. [Aceptar tu invitación](#2-aceptar-tu-invitación)
3. [Tu Dashboard](#3-tu-dashboard)
4. [Encontrar y trabajar tus tareas](#4-encontrar-y-trabajar-tus-tareas)
5. [Registrar tu tiempo (Time Tracking)](#5-registrar-tu-tiempo-time-tracking)
6. [Participar en Daily Scrum](#6-participar-en-daily-scrum)
7. [Reportar Impedimentos y Defectos](#7-reportar-impedimentos-y-defectos)
8. [Colaborar · Mentions, Whiteboards y Docs](#8-colaborar--mentions-whiteboards-y-docs)
9. [Capturar Lessons Learned](#9-capturar-lessons-learned)
10. [Vistas para trabajar mejor](#10-vistas-para-trabajar-mejor)
11. [Notificaciones y Brain AI personal](#11-notificaciones-y-brain-ai-personal)
12. [Tips de productividad](#12-tips-de-productividad)

---

## 1. ¿Qué hago en Sync?

Como **Agente** (USER), eres quien hace que las cosas pasen. Tu trabajo es:

| Responsabilidad | Frecuencia |
|---|---|
| Ejecutar tareas asignadas | Diario |
| Actualizar status y progreso de tus tareas | Diario |
| Registrar tu tiempo (timer o manual) | Diario |
| Participar en Daily Scrum | Diario |
| Reportar impedimentos cuando te bloqueas | Cuando aplica |
| Reportar defectos que encuentres | Cuando aplica |
| Participar en Sprint Planning + Reviews + Retrospectives | Por sprint |
| Capturar Lessons Learned valiosas | Bajo demanda |

### Lo que NO tienes que hacer

- ❌ Crear proyectos (eso es tu Gerente de Área).
- ❌ Invitar usuarios (eso es ADMIN).
- ❌ Aprobar Change Requests (eso es Gerencia General).
- ❌ Configurar la plataforma (eso es SUPER_ADMIN).

---

## 2. Aceptar tu invitación

### Paso 1 · Recibe el email

Tu ADMIN o Gerente de Área te envió una invitación. Verás un email con:

```
Asunto: Has sido invitado a Sync · Workspace [Nombre]
Cuerpo: Click el siguiente botón para aceptar la invitación...
```

> 📸 **Captura sugerida:** `screenshots/50-invitation-email.png`
>
> *Captura del email de invitación con el botón "Aceptar invitación" destacado.*

### Paso 2 · Crear tu cuenta o login

Click el botón → te lleva a `https://followup-gantt.vercel.app/invite?token=...`.

Si **NO tienes cuenta:**
- Ingresa tu nombre completo.
- Define una contraseña fuerte (mínimo 12 caracteres).

Si **YA tienes cuenta** (otro Workspace):
- Solo haz login con tus credenciales.

> 📸 **Captura sugerida:** `screenshots/51-aceptar-invitacion.png`
>
> *Pantalla de aceptación con campos de nombre, password y los términos.*

### Paso 3 · Primer login

Tras aceptar, quedas asignado al Workspace + Gerencia + Área que el ADMIN configuró.

Te recomiendo:
- Configurar tu **avatar** (perfil arriba a la derecha).
- Habilitar **notificaciones push** del navegador cuando te lo pida.
- Si tienes iPhone/Android, instala la **PWA** (verás un banner "Instalar Sync").

---

## 3. Tu Dashboard

Cuando entras a Sync, el primer lugar es tu **Dashboard** (icono de cuadrícula en el sidebar).

> 📸 **Captura sugerida:** `screenshots/52-dashboard-agente.png`
>
> *Dashboard de un Agente mostrando: tarjeta "Mis tareas hoy" (5-8 tareas), "Próximos deadlines" (timeline horizontal), "Notificaciones" (3-5 latest), "Brain Insights sugeridos".*

### ¿Qué ves?

| Card | Para qué sirve |
|---|---|
| **Mis tareas hoy** | Tareas con `dueDate = hoy` o `IN_PROGRESS`. Click → vas directo. |
| **Próximos deadlines** | Línea de tiempo con tareas que vencen en los próximos 7 días. |
| **Notificaciones** | Mentions, comentarios, asignaciones nuevas. |
| **Brain Insights** | Sugerencias AI sobre tus tareas (ej. "esta tarea tiene riesgo de retraso"). |

---

## 4. Encontrar y trabajar tus tareas

### Lista plana de todas tus tareas

Sidebar → **Tareas** (icono lista).

> 📸 **Captura sugerida:** `screenshots/53-tareas-lista.png`
>
> *Vista de Tareas con filtros laterales: Proyecto, Sprint, Status, Priority + lista de tareas con badges de prioridad/status.*

Filtros disponibles:

- **Proyecto** (multi-select).
- **Sprint actual / pasado / futuro**.
- **Status** (TODO · IN_PROGRESS · REVIEW · DONE).
- **Priority** (LOW · MEDIUM · HIGH · CRITICAL).
- **Asignación** (Solo mías · Equipo · Watching).

### Abrir una tarea

Click en cualquier tarea → modal lateral con detalle completo.

> 📸 **Captura sugerida:** `screenshots/54-task-detail-modal.png`
>
> *Modal lateral con detalle de tarea mostrando: título editable, description con markdown, acceptance criteria checkbox, asignee + sprint, attachments, comments, time tracking widget.*

### Acciones rápidas en una tarea

| Acción | Cómo |
|---|---|
| Cambiar status | Click en el badge de status arriba |
| Marcar progress | Slider 0-100% |
| Asignar a alguien | Click en avatar → search |
| Comentar | Bottom del modal · soporta `@mentions` |
| Adjuntar archivo | Botón paperclip · drag-drop también funciona |
| Iniciar timer | Botón "Play" arriba a la derecha |

---

## 5. Registrar tu tiempo (Time Tracking)

### Opción A · Timer en vivo (recomendado)

1. Abre la tarea en la que vas a trabajar.
2. Click **"Iniciar timer"** (botón play).
3. Trabaja normalmente — el contador corre en segundo plano.
4. Cuando termines o cambies de tarea, click **"Detener timer"**.
5. Sync registra automáticamente el `TimeEntry` con la duración.

> 📸 **Captura sugerida:** `screenshots/55-timer-en-vivo.png`
>
> *Tarea con el timer corriendo, contador grande visible (HH:MM:SS) y botón Stop destacado.*

### Opción B · Manual desde Timesheets

Sidebar → **Operación** → **Timesheets**.

Vista calendario semanal. Arrastra para crear bloques de tiempo:

> 📸 **Captura sugerida:** `screenshots/56-timesheets-semanal.png`
>
> *Calendario semanal con bloques de tiempo coloreados por proyecto, totales por día abajo.*

### Submit del Timesheet (si tu workspace lo requiere)

Al final de la semana, click **"Submit"**. Tu Gerente de Área lo revisa y aprueba.

---

## 6. Participar en Daily Scrum

### Acceder al widget

Sidebar → **Agile** → **Daily Scrum**.

> 📸 **Captura sugerida:** `screenshots/57-daily-scrum-mi-fila.png`
>
> *Daily Scrum mostrando 5-6 miembros del equipo · tu fila destacada con los 3 inputs editables.*

### Llena las 3 columnas

Cada mañana (típicamente 9:00 am), responde:

| Columna | Qué escribir |
|---|---|
| **Yesterday** | Qué cerraste ayer (1-3 bullets cortos) |
| **Today** | Qué planeas trabajar hoy |
| **Blockers** | ¿Algo te impide avanzar? |

### Si tienes un blocker

Click el botón rojo **"Promote to Impediment"**:

- Severity: LOW / MEDIUM / HIGH / CRITICAL.
- Owner sugerido (tu Gerente de Área).
- Description: contexto del bloqueo.

Tu Gerente de Área recibe notificación inmediata.

> 📸 **Captura sugerida:** `screenshots/58-promover-blocker.png`
>
> *Modal "Promover blocker a Impediment" con severity selector y description editor.*

---

## 7. Reportar Impedimentos y Defectos

### Impedimentos (algo te bloquea)

Sidebar → **Agile** → **Impediments**.

Click **"Nuevo impedimento"**:

- **Title** corto y específico.
- **Description** del bloqueo.
- **Severity**.
- **Linked task** (opcional).

> 📸 **Captura sugerida:** `screenshots/59-impedimento-nuevo.png`
>
> *Formulario "Nuevo Impedimento" con severity slider colorizado.*

### Defectos (encontraste un bug)

Sidebar → **PMI** → **Quality** → tab **Defects**.

Click **"Nuevo defecto"**:

- **Title** (ej. "Login falla con email mayúscula").
- **Description** + steps to reproduce.
- **Severity**: BLOCKER / CRITICAL / MAJOR / MINOR / TRIVIAL.
- **Linked task** (la tarea donde lo encontraste).

> 📸 **Captura sugerida:** `screenshots/60-nuevo-defecto.png`
>
> *Formulario de nuevo defecto con campos de reproducción paso a paso.*

Tu Gerente de Área decide si entra al backlog del próximo sprint.

---

## 8. Colaborar · Mentions, Whiteboards y Docs

### Mentions

En cualquier descripción de tarea o comentario, escribe **`@`** y empieza a tipear el nombre:

> 📸 **Captura sugerida:** `screenshots/61-mention-autocomplete.png`
>
> *Editor con `@` activado mostrando lista autocomplete de miembros del equipo.*

La persona mencionada recibe:
- Notificación in-app (badge rojo en sidebar).
- Email (si su preferencia lo permite).
- Push notification (si tiene PWA/mobile + permisos).

### Whiteboards (mind maps colaborativos)

Sidebar → **Pizarras** (icono pen-square).

> 📸 **Captura sugerida:** `screenshots/62-whiteboard-coedit.png`
>
> *Whiteboard con mind map siendo editado por 2-3 usuarios en tiempo real (cursores con nombres visibles).*

Real-time co-edit con Yjs:

- Drag-drop de nodos.
- Cursores de otros usuarios visibles.
- Cambios se sincronizan en vivo.
- Auto-save cada 2 segundos.

### Documentación (wikis)

Sidebar → **Gestión** → **Documentación**.

Editor markdown con co-edit Yjs:

- Tiptap editor (similar a Notion).
- Mentions con `@`.
- Versionado automático.

> 📸 **Captura sugerida:** `screenshots/63-doc-collaborative-edit.png`
>
> *Editor de Docs con 2 usuarios editando simultáneamente, cursores con colores diferentes, presence avatars arriba.*

---

## 9. Capturar Lessons Learned

Después de un trabajo significativo (especialmente si algo salió mal o muy bien), captura una **Lesson Learned**.

### Paso 1 · Ir a Lessons Learned

Sidebar → **PMI** → **Lessons Learned**.

### Paso 2 · Click "Nueva lesson"

Llena:

- **Título** descriptivo (no genérico).
- **Descripción** con contexto + qué aprendiste + acción recomendada.
- **Categoría** (8 disponibles):
  - Technical · Process · People · Communications · Risk · Quality · Procurement · Stakeholder.
- **Visibilidad**: PROJECT (default, solo tu equipo la ve).

> 📸 **Captura sugerida:** `screenshots/64-lesson-learned-form.png`
>
> *Formulario "Nueva Lesson Learned" con editor markdown, categoría selector y visibilidad picker.*

### ¿Qué hace una buena Lesson?

- ✅ **Específica:** "Los webhooks de Stripe requieren validar la signature ANTES de procesar el payload" (NO: "El billing fue difícil").
- ✅ **Accionable:** explica qué hacer la próxima vez.
- ✅ **Honesta:** incluye lo que NO funcionó.
- ❌ Evita lessons vagas, blameosas o aspiracionales.

Si tu Gerente General la promueve a `WORKSPACE` u `ORG`, queda en la knowledge base permanente y puede ahorrar semanas a otros equipos.

---

## 10. Vistas para trabajar mejor

Además de la lista plana de tareas, Sync ofrece 6 vistas. Úsalas según el contexto:

| Vista | Ideal para |
|---|---|
| **List** (`/list`) | Trabajo personal diario · checklist mental |
| **Kanban** (`/kanban`) | Visualizar flujo TODO → DONE |
| **Gantt** (`/gantt`) | Cronograma y dependencias del proyecto |
| **Timeline** (`/timeline`) | Vista timeline portfolio · visualización temporal |
| **Calendar** (`/calendar`) | Tareas con deadline específico |
| **Table** (`/table`) | Análisis con filtros + sorting tipo Excel |
| **MindMap** (`/mindmaps`) | Brainstorming y organización jerárquica |

> 📸 **Captura sugerida:** `screenshots/65-vistas-switcher.png`
>
> *Top bar de las vistas con switcher entre List/Kanban/Gantt/Timeline/Calendar/Table mostrando la misma data.*

---

## 11. Notificaciones y Brain AI personal

### Centro de notificaciones

Sidebar → **Notificaciones** (icono campana).

Tipos de eventos:

- 🔔 **Mention** — alguien te mencionó en una tarea/comment.
- 📋 **Task assigned** — te asignaron una tarea nueva.
- ⏰ **Deadline próximo** — falta <24h para due date.
- 🚫 **Impediment asignado** — tu PM te asignó un impediment.
- 🤖 **Brain insight** — AI detectó algo sobre tus tareas.

> 📸 **Captura sugerida:** `screenshots/66-notifications-inbox.png`
>
> *Inbox de notificaciones con filtros por tipo, badges de leídas/no leídas, búsqueda.*

### Brain AI · Project Insights AI

Sidebar → **Avante Brain AI** → tab **Project Insights AI**.

Brain analiza tu proyecto activo y te dice:

- 🔮 **Forecast**: "El sprint actual probablemente no termina a tiempo (P75=15% retraso)".
- 💡 **Recommendation**: "La tarea X tiene 3 dependencias bloqueadas — considera reasignar".
- ⚠️ **Anomaly**: "Tu velocity bajó 40% esta semana".

> 📸 **Captura sugerida:** `screenshots/67-brain-insights-personal.png`
>
> *Brain Insights mostrando 3 forecasts, 3 recommendations, 3 anomalies con cards coloreadas y severity.*

### Brain AI · Writer AI (para tus comentarios y descriptions)

Sidebar → **Avante Brain AI** → tab **Writer AI**.

Pega texto coloquial y Brain lo convierte en una historia de usuario formal con título profesional + descripción Markdown + criterios de aceptación verificables.

> 📸 **Captura sugerida:** `screenshots/68-writer-ai-suggest.png`
>
> *Writer AI con texto coloquial arriba y sugerencia formal abajo en card destacada con botón "Aplicar a la tarea".*

---

## 12. Tips de productividad

### Atajos de teclado

| Tecla | Acción |
|---|---|
| `Cmd/Ctrl + K` | Abrir Command Palette (búsqueda universal) |
| `Cmd/Ctrl + /` | Ver lista completa de shortcuts |
| `T` | Crear nueva tarea rápida |
| `G` luego `D` | Ir a Dashboard |
| `G` luego `T` | Ir a Tareas |
| `Esc` | Cerrar modales |

### Modo oscuro

Click el icono de sol/luna abajo a la izquierda del sidebar.

### Instalar como PWA

En Chrome/Edge, click el icono "Instalar" en la barra de direcciones. Sync funcionará como app nativa con:

- Acceso desde escritorio.
- Notificaciones push reales.
- Funcionalidad offline básica.

### Buscar rápido

`Cmd/Ctrl + K` abre el Command Palette. Busca:

- Tareas por título.
- Proyectos por nombre.
- Documentos.
- Personas.
- Sprints.
- Acciones (ej. "ir a settings").

> 📸 **Captura sugerida:** `screenshots/69-command-palette.png`
>
> *Command Palette abierto con resultados agrupados por tipo y la query "migracion sap".*

### Daily checklist personal (sugerencia)

```
☐ 9:00 · Daily Scrum (Yesterday/Today/Blockers)
☐ 9:15 · Revisar Notificaciones + Brain Insights
☐ 9:30 · Iniciar timer en primera tarea del día
☐ 17:30 · Detener timer + actualizar progress
☐ 17:45 · Capturar Lesson Learned si aplica
```

---

## Recursos adicionales

- **Manual del Gerente General:** [`manual-gerencia-general.md`](./manual-gerencia-general.md)
- **Manual del Gerente de Área:** [`manual-gerente-area.md`](./manual-gerente-area.md)
- **Manual general:** [`flujo-creacion-proyecto.md`](./flujo-creacion-proyecto.md)

## ¿Atascado?

- Pregunta a tu Gerente de Área primero.
- Si es bug técnico, abre un Defect en `PMI → Quality → Defects`.
- Para sugerencias al producto, mention a tu ADMIN en `Documentación → Sugerencias`.
