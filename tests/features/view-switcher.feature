# language: es
Característica: Cross-vista · preservación de filtros (Sprint 4)

  Escenario: Navegar de List a Kanban manteniendo filtros
    Dado estoy en /list?status=TODO&assignee=u1
    Cuando hago click en el tab "Kanban"
    Entonces la URL es /kanban?status=TODO&assignee=u1
    Y la vista Kanban muestra sólo tareas filtradas

  Escenario: `month` sólo sobrevive a /gantt
    Dado estoy en /gantt?month=2026-05&priority=HIGH
    Cuando hago click en el tab "List"
    Entonces la URL NO contiene "month="
    Y la URL contiene "priority=HIGH"

  Escenario: Breadcrumbs globales reflejan la ruta
    Dado estoy en /projects
    Entonces el breadcrumb contiene "Inicio" y "Proyectos"
    Y "Proyectos" tiene aria-current="page"

  Escenario: Paleta de comandos carga datos reales
    Dado que presiono "/"
    Entonces la paleta abre con placeholder "Cargando datos…"
    Cuando los datos cargan
    Entonces el placeholder cambia a "Buscar tareas, proyectos o acciones…"
    Y escribir parte del título de una tarea la muestra en los resultados

  Escenario: Click en resultado "tarea" abre el Drawer
    Dado la paleta muestra la tarea T
    Cuando hago click en el resultado
    Entonces el Drawer se abre con la tarea T
    Y la paleta se cierra

  Escenario: Click en resultado "proyecto" navega
    Dado la paleta muestra el proyecto P
    Cuando hago click en el resultado
    Entonces la URL cambia a /projects/{P.id}
