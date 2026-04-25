# language: es
Característica: Mapas Mentales — editor visual estilo MindMup 3

  Como Project Manager o miembro del equipo
  Quiero crear y editar mapas mentales con nodos, conectores y notas
  Para organizar ideas, planear alcance y documentar conocimiento visualmente

  Antecedentes:
    Dado que estoy autenticado como "Edwin Martínez"
    Y existe el proyecto "Proyecto Alfa"
    Y estoy en la ruta "/mindmaps"

  # ── Listado y creación ──────────────────────────────────────

  Escenario: Estado vacío cuando no existen mapas
    Dado no hay mapas mentales creados
    Entonces veo el empty state con icono "Plus" y mensaje "Aún no hay mapas mentales"
    Y veo el botón "Nuevo Mapa"

  Escenario: Crear un mapa mental nuevo
    Cuando hago click en "Nuevo Mapa"
    Entonces se abre un modal con los campos: Título, Descripción, Proyecto, Propietario
    Cuando escribo "WBS Proyecto Alfa" en Título
    Y selecciono el proyecto "Proyecto Alfa"
    Y hago click en "Crear"
    Entonces se crea el mapa y se redirige a "/mindmaps/<id>"
    Y el canvas muestra un nodo raíz con label "WBS Proyecto Alfa"

  Escenario: Renombrar un mapa desde el listado
    Dado existe el mapa "WBS Proyecto Alfa"
    Cuando paso el cursor sobre su card
    Y hago click en el icono Edit2
    Entonces el título se convierte en input editable
    Cuando escribo "WBS Alfa v2" y presiono "Enter"
    Entonces el mapa queda renombrado y se muestra toast "Renombrado"

  Escenario: Eliminar un mapa desde el listado
    Dado existe el mapa "Mapa de prueba"
    Cuando paso el cursor sobre su card
    Y hago click en el icono Trash2
    Entonces se muestra un diálogo de confirmación
    Cuando confirmo
    Entonces el mapa se elimina y desaparece del grid
    Y se muestra toast "Mapa eliminado"

  # ── Editor: creación y edición de nodos ─────────────────────

  Escenario: Nodo raíz presente al abrir un mapa nuevo
    Dado abro el editor de un mapa recién creado
    Entonces veo un nodo con estilo "raíz" (fondo primary/15, icono Star)
    Y el nodo raíz no se puede eliminar

  Escenario: Crear nodo con doble click en el canvas
    Dado el editor está abierto
    Cuando hago doble click en una zona vacía del canvas en la posición (400, 300)
    Entonces se crea un nodo con label "Nuevo nodo" en esa posición
    Y el nodo queda seleccionado

  Escenario: Editar label con doble click en el nodo
    Dado existe un nodo con label "Nuevo nodo"
    Cuando hago doble click sobre el nodo
    Entonces el label se convierte en input editable con el texto auto-seleccionado
    Cuando escribo "Análisis de requerimientos" y presiono "Enter"
    Entonces el label se actualiza y se persiste en la base de datos

  Escenario: Cancelar edición con Escape
    Dado estoy editando el label de un nodo
    Cuando presiono "Escape"
    Entonces el valor anterior se restaura sin guardar

  Escenario: Eliminar nodo con tecla Delete
    Dado el nodo "Análisis de requerimientos" está seleccionado
    Y no es nodo raíz
    Cuando presiono "Delete"
    Entonces el nodo se elimina
    Y las conexiones hacia/desde ese nodo también se eliminan (cascade)

  Escenario: No se puede eliminar el nodo raíz
    Dado el nodo raíz está seleccionado
    Cuando presiono "Delete"
    Entonces el nodo no se elimina
    Y se muestra toast "No se puede eliminar el nodo raíz"

  # ── Conectores ──────────────────────────────────────────────

  Escenario: Conectar dos nodos arrastrando desde un handle
    Dado existen los nodos A y B
    Cuando arrastro desde el handle inferior de A al handle superior de B
    Entonces se crea una conexión A → B
    Y la conexión se persiste en la tabla MindMapEdge

  Escenario: Un nodo no puede conectarse a sí mismo
    Cuando intento conectar el handle source y target del mismo nodo
    Entonces no se crea conexión
    Y no se muestra error (se ignora silenciosamente)

  Escenario: Eliminar una conexión
    Dado existe una conexión A → B
    Cuando selecciono la conexión y presiono "Delete"
    Entonces la conexión se elimina y se persiste el cambio

  Escenario: Conexiones duplicadas se ignoran
    Dado existe una conexión A → B
    Cuando intento crear otra conexión A → B
    Entonces se hace upsert (no se duplica) por el índice único (sourceId, targetId)

  # ── Notas expandidas ────────────────────────────────────────

  Escenario: Abrir panel de nota al seleccionar un nodo
    Cuando hago click en un nodo
    Entonces el panel lateral derecho se abre mostrando:
      | Campo              | Valor                          |
      | Título editable    | Label actual del nodo          |
      | Textarea de nota   | Nota actual (o vacío)          |
      | Buscador de tareas | Filtra por mnemónico o título  |

  Escenario: Nota se guarda con debounce de 600ms
    Dado el panel de nota está abierto
    Cuando escribo "Definir KPIs de éxito antes del kick-off" en el textarea
    Y dejo de escribir por 600ms
    Entonces la nota se persiste automáticamente
    Y el nodo en el canvas muestra el badge "Nota" (icono FileText ámbar)

  Escenario: Enlazar nodo a una tarea existente
    Dado el panel del nodo "Análisis" está abierto
    Cuando escribo "PA-3" en el buscador de tareas
    Y hago click en la tarea "PA-3 - Levantamiento de requerimientos"
    Entonces el nodo queda enlazado
    Y el badge del nodo muestra "#PA-3"

  Escenario: Desenlazar una tarea
    Dado un nodo está enlazado a la tarea PA-3
    Cuando hago click en el botón X del chip de tarea
    Entonces el nodo se desenlaza y vuelve a mostrar el buscador

  # ── Keyboard shortcuts estilo MindMup 3 ─────────────────────

  Escenario: Tab crea un nodo hijo
    Dado el nodo A está seleccionado
    Cuando presiono "Tab"
    Entonces se crea un nuevo nodo "Nuevo nodo" conectado como hijo de A
    Y el nuevo nodo queda seleccionado

  Escenario: Enter crea un nodo hermano
    Dado el nodo B es hijo de A y está seleccionado
    Cuando presiono "Enter"
    Entonces se crea un nuevo nodo hermano conectado también a A

  Escenario: Enter en un nodo sin padre muestra error
    Dado el nodo raíz R está seleccionado
    Cuando presiono "Enter"
    Entonces se muestra toast "Este nodo no tiene padre — usa Tab para crear un hijo en su lugar"

  Escenario: Shortcuts no interfieren con inputs
    Dado estoy editando el textarea del panel de nota
    Cuando presiono "Tab"
    Entonces Tab inserta tabulación en el textarea (o navega focus)
    Pero no crea un nodo hijo

  # ── Canvas: pan, zoom, minimap ──────────────────────────────

  Escenario: Hacer zoom con scroll del mouse
    Dado el cursor está sobre el canvas
    Cuando hago scroll hacia arriba
    Entonces el canvas hace zoom in

  Escenario: Pan arrastrando el canvas
    Cuando hago drag en una zona vacía del canvas
    Entonces el canvas se desplaza (pan)

  Escenario: Ajustar vista con botón Fit View
    Cuando hago click en el botón "fit view" del control
    Entonces todos los nodos visibles quedan encuadrados con padding

  Escenario: Minimap refleja posición y selección
    Entonces el minimap muestra todos los nodos
    Y el nodo raíz se resalta con color primary
    Y el rectángulo del viewport se actualiza al hacer pan/zoom

  # ── Persistencia y sincronización ───────────────────────────

  Escenario: Posiciones se sincronizan con debounce de 500ms
    Dado arrastro el nodo A de (100,100) a (300,200)
    Cuando suelto el nodo y transcurren 500ms sin más drags
    Entonces las nuevas coordenadas se persisten vía syncNodePositions
    Y el cambio es atómico dentro de prisma.$transaction

  Escenario: Navegar atrás guarda pendientes
    Dado hay un cambio de posición pendiente de sincronizar
    Cuando hago click en "Mapas" (volver al listado)
    Entonces el flush de posiciones ocurre antes de navegar

  # ── Accesibilidad ───────────────────────────────────────────

  Escenario: Panel tiene aria-label descriptivo
    Entonces el panel lateral tiene aria-label="Panel de detalle del nodo"

  Escenario: Canvas es navegable por teclado
    Dado el foco está en el canvas
    Cuando presiono Tab
    Entonces el foco pasa al siguiente nodo (comportamiento nativo xyflow)

  # ── Deuda registrada (fuera de scope MVP) ───────────────────

  @deuda
  Escenario: Colapsar/expandir ramas (no implementado)
    Cuando hago click en el indicador de colapso de un nodo
    Entonces sus descendientes se ocultan
    # TODO: requiere nueva propiedad collapsed en MindMapNode

  @deuda
  Escenario: Undo/Redo (no implementado)
    Cuando presiono Ctrl+Z después de eliminar un nodo
    Entonces el nodo se restaura
    # TODO: implementar stack de undo local + compensaciones en servidor

  @deuda
  Escenario: Import/export OPML/FreeMind (no implementado)
    Cuando hago click en "Importar" y selecciono un archivo .opml
    Entonces se crea el mapa con su jerarquía
    # TODO: parser OPML y FreeMind XML

  @deuda
  Escenario: Colaboración realtime (no implementado)
    Dado dos usuarios abren el mismo mapa
    Cuando uno mueve un nodo
    Entonces el otro ve el cambio en < 1s sin recargar
    # TODO: WebSockets / Liveblocks / Yjs
