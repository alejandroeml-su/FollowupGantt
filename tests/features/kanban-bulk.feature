# language: es
Característica: Kanban · drag en lote y menú contextual de columna (Sprint 2)

  Antecedentes:
    Dado estoy en /kanban
    Y tengo 3 tareas en TODO y 0 en IN_PROGRESS (wipLimit=3)

  Escenario: Drag en lote mueve todas las tareas seleccionadas
    Dado selecciono 3 tareas con Ctrl+Click
    Cuando arrastro una de ellas a IN_PROGRESS
    Entonces las 3 tareas aparecen en IN_PROGRESS
    Y el DragOverlay muestra el badge "+2"
    Y se ejecuta una sola llamada a bulkMoveTasksWithStatus

  Escenario: WIP bloquea el movimiento cuando el lote no cabe
    Dado IN_PROGRESS ya tiene 2 de 3 y selecciono 2 tareas de TODO
    Cuando arrastro una a IN_PROGRESS
    Entonces el server responde [WIP_LIMIT_EXCEEDED]
    Y las tareas regresan a TODO
    Y se muestra toast rojo "WIP excedido · No caben 2 tareas en IN_PROGRESS (2/3)."

  Escenario: Menú contextual de columna permite cambiar color
    Cuando hago click derecho en el encabezado de TODO
    Y elijo "Cambiar color" > "Indigo"
    Entonces la columna TODO se muestra con acento indigo
    Y la preferencia persiste tras recargar (localStorage)

  Escenario: Menú contextual de columna permite override de WIP
    Cuando hago click derecho en el encabezado de REVIEW
    Y elijo "Definir WIP limit" > "Máx 1"
    Entonces la columna REVIEW muestra badge 0/1
    Y un movimiento subsiguiente con 2 tareas es rechazado

  Escenario: Colapsar columna
    Cuando hago click derecho en TODO
    Y elijo "Colapsar"
    Entonces TODO se muestra con ancho 48px
    Y el título se renderiza en orientación vertical

  Escenario: Restaurar defaults elimina los overrides
    Dado he configurado color, WIP y colapso en TODO
    Cuando elijo "Restaurar defaults"
    Entonces TODO vuelve al estado por defecto
