# language: es
Característica: Calendar View — planificación mensual, quick-create y filtros

  Como Project Manager o colaborador
  Quiero visualizar, crear y reorganizar actividades sobre un calendario mensual
  Para planificar el mes completo sin solapar con otros proyectos

  Antecedentes:
    Dado que estoy autenticado
    Y existe la gerencia "Operaciones" con el área "DevOps" y el proyecto "Proyecto Alfa"
    Y estoy en la ruta "/calendar"

  # ── Visualización ───────────────────────────────────────────────────

  Escenario: Grid mensual con 7 columnas y filas de semanas
    Entonces veo un encabezado con los días "Lun Mar Mié Jue Vie Sáb Dom"
    Y el grid contiene semanas completas (lunes a domingo)
    Y cada celda representa un día
    Y el día de hoy tiene ring de color primary y el número en píldora

  Escenario: Días fuera del mes visible se muestran atenuados
    Dado navego al mes actual
    Entonces las celdas del mes anterior o siguiente tienen opacity reducida
    Y su número se muestra en text-muted-foreground

  Escenario: Celdas con actividades muestran chips con mnemónico y título
    Dado el proyecto "Proyecto Alfa" tiene 2 tareas en el día 15
    Cuando observo la celda del día 15
    Entonces veo dos chips con "PA-1 · <título>" y "PA-2 · <título>"
    Y cada chip muestra el borde izquierdo coloreado por prioridad
    Y cada chip muestra un punto circular coloreado por status

  Escenario: Overflow de más de 2 tareas por día
    Dado el día 15 tiene 5 actividades
    Cuando observo la celda
    Entonces veo las 2 primeras tareas
    Y un chip "+ 3 más" abre un popover con las 3 restantes

  # ── Quick-create ────────────────────────────────────────────────────

  Escenario: Click en celda vacía abre el quick-create
    Cuando hago click en una celda sin actividades del día 18
    Entonces se abre el popover "Nueva actividad"
    Y el header muestra "Jueves 18 de mayo"
    Y el input "Título" tiene foco automático

  Escenario: Crear actividad con Enter
    Dado el quick-create está abierto para el día 18
    Cuando escribo "Revisar cronograma" en el título
    Y selecciono el proyecto "Proyecto Alfa"
    Y presiono "Enter"
    Entonces se crea la tarea con mnemónico "PA-N"
    Y startDate = endDate = 2026-05-18
    Y se muestra toast "Creada PA-N: Revisar cronograma"
    Y el popover se cierra
    Y la nueva actividad aparece en la celda del día 18

  Escenario: Prioridad pre-seleccionada en MEDIUM
    Dado abro el quick-create
    Entonces el radio "Media" está seleccionado por defecto

  Escenario: Marcar como hito
    Dado abro el quick-create y marco el checkbox "Es un hito"
    Cuando creo la actividad
    Entonces la tarea tiene isMilestone=true
    Y el chip en la celda muestra icono estrella ámbar

  Escenario: Cancelar con Esc
    Dado el quick-create está abierto
    Cuando presiono "Escape"
    Entonces el popover se cierra sin crear tarea

  Escenario: Click en botón flotante "+" de una celda con actividades
    Dado la celda del día 20 tiene 2 tareas
    Cuando paso el cursor sobre la celda
    Entonces aparece un botón flotante "+" en la esquina superior derecha
    Cuando hago click en el botón "+"
    Entonces abre el quick-create para el día 20 (sin abrir el drawer de ninguna tarea)

  Escenario: Proyecto pre-seleccionado al tener filtro activo
    Dado aplico el filtro proyecto="Proyecto Alfa"
    Cuando abro el quick-create
    Entonces el select "Proyecto" muestra "Proyecto Alfa" pre-seleccionado

  # ── Filtros Gerencia / Área / Proyecto ─────────────────────────────

  Escenario: Filtrar por gerencia
    Dado hay tareas de 2 gerencias en el mes
    Cuando elijo la gerencia "Operaciones" en el filtro
    Entonces solo veo las tareas de proyectos de esa gerencia
    Y el contador muestra "N actividades en el mes"

  Escenario: Cascada Gerencia → Área → Proyecto
    Cuando selecciono la gerencia "Operaciones"
    Entonces el dropdown "Área" solo lista áreas de Operaciones
    Cuando selecciono el área "DevOps"
    Entonces el dropdown "Proyecto" solo lista proyectos de DevOps

  Escenario: Limpiar filtros
    Dado tengo filtros activos (gerencia + área + proyecto)
    Cuando hago click en el botón "Limpiar"
    Entonces los 3 filtros se resetean
    Y todas las tareas del mes son visibles

  Escenario: Los filtros persisten en la URL
    Cuando aplico gerencia="ger-1" y proyecto="proj-1"
    Entonces la URL contiene "?gerenciaId=ger-1&projectId=proj-1"
    Cuando copio la URL en otra pestaña
    Entonces los mismos filtros están aplicados

  # ── Navegación entre meses ─────────────────────────────────────────

  Escenario: Navegar al mes siguiente
    Dado estoy en "mayo 2026"
    Cuando hago click en la flecha "Mes siguiente"
    Entonces la URL contiene "?month=2026-06"
    Y el título muestra "junio 2026"
    Y el grid se actualiza a las semanas de junio

  # ── Drag & drop ────────────────────────────────────────────────────

  Escenario: Mover actividad a otro día arrastrando
    Dado una tarea "PA-1" en el día 10 con startDate=endDate=2026-05-10
    Cuando arrastro el chip a la celda del día 14 y suelto
    Entonces la tarea se actualiza a startDate=endDate=2026-05-14
    Y se muestra toast "Movida +4 días"
    Y la celda del día 14 muestra el chip

  Escenario: Rollback si el server rechaza por dependencia FS
    Dado "PA-1" tiene predecesor FS "PA-0" con endDate 2026-05-12
    Cuando arrastro "PA-1" al día 8
    Entonces el server rechaza con [DEPENDENCY_VIOLATION]
    Y la tarea regresa al día 10
    Y se muestra toast rojo con el detalle

  # ── Abrir detalle ──────────────────────────────────────────────────

  Escenario: Click en un chip abre el Drawer
    Cuando hago click sobre un chip de tarea
    Entonces se abre el Drawer con el detalle completo
    Y la celda del día NO abre el quick-create (propagación detenida)

  # ── Accesibilidad ───────────────────────────────────────────────────

  Escenario: Grid accesible por teclado
    Dado el foco está en la celda del día 10
    Cuando presiono "Enter"
    Entonces abre el quick-create para ese día
    Y el input título tiene foco inmediatamente

  Escenario: Etiquetas ARIA en cada celda
    Entonces cada celda tiene role="gridcell"
    Y aria-label con el formato "Jueves 18 de mayo, N actividades"
    Y el día actual tiene aria-selected="true"

  Escenario: Respeta prefers-reduced-motion
    Dado el sistema tiene prefers-reduced-motion="reduce"
    Entonces no se aplican animaciones de scale al hover
    Y el indicador "pulsing" del status IN_PROGRESS se desactiva

  # ── Responsive ─────────────────────────────────────────────────────

  Escenario: Viewport mobile muestra agenda lineal
    Dado el viewport es de 375 px
    Entonces el grid se reemplaza por una lista vertical agrupada por día
    Y el botón de filtros abre un drawer inferior
