# language: es
Característica: Drag & Drop multi-vista

  Antecedentes:
    Dado que estoy autenticado
    Y el proyecto tiene columnas TODO, IN_PROGRESS, REVIEW, DONE

  Escenario: Reordenar tarea en vista List
    Dado tareas A y B en el mismo nivel
    Cuando arrastro B por encima de A y suelto
    Entonces B queda antes de A
    Y el campo Task.position se actualiza
    Y durante el drag se ve un ghost translúcido con opacity-50
    Y una línea guía azul de 2px indica la zona de drop

  Escenario: Mover tarea entre columnas Kanban
    Dado la tarea T está en columna "TODO"
    Cuando la arrastro a columna "IN_PROGRESS" y suelto
    Entonces T aparece en IN_PROGRESS
    Y Task.status se actualiza optimistamente
    Y si la acción falla en el servidor, T regresa a TODO con toast "No se pudo mover"

  Escenario: Anidar subtarea con Shift + drag
    Dado tarea T sin parent y tarea P con parent
    Cuando arrastro T con Shift sobre P durante 400 ms
    Entonces P se expande con highlight amarillo
    Cuando suelto
    Entonces T queda como primera subtarea de P
    Y Task.parentId de T == P.id

  Escenario: Cambiar fecha en Gantt arrastrando barra
    Dado una tarea con startDate 2026-05-01 y endDate 2026-05-05
    Cuando arrastro el cuerpo de la barra +2 días
    Entonces startDate = 2026-05-03 y endDate = 2026-05-07
    Y el progreso no cambia

  Escenario: Multi-selección y drag en lote
    Dado selecciono 3 tareas con Ctrl+Click
    Cuando arrastro cualquiera de las 3 a otra columna
    Entonces las 3 se mueven manteniendo su orden relativo
    Y se ejecuta una sola bulkMoveTasksToColumn

  Escenario: DnD por teclado (WCAG)
    Dado la tarea tiene foco
    Cuando presiono "Space"
    Entonces entra en modo pickup y aria-grabbed = "true"
    Cuando presiono "ArrowDown" 3 veces
    Entonces el cursor lógico baja 3 posiciones
    Y la live region anuncia "Tarea movida a posición 4 de 10"
    Cuando presiono "Space" otra vez
    Entonces se confirma el move
