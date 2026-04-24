# language: es
Característica: Gantt · arrastre y redimensionado de barras (Sprint 3)

  Antecedentes:
    Dado que estoy en /gantt en el mes actual
    Y hay una tarea T con startDate 2026-05-01 y endDate 2026-05-05

  Escenario: Arrastrar el cuerpo de la barra desplaza ambas fechas
    Cuando arrastro el cuerpo de la barra de T 2 días a la derecha
    Entonces T.startDate = 2026-05-03
    Y T.endDate = 2026-05-07
    Y la región aria-live anuncia "Tarea desplazada +2 días"

  Escenario: Redimensionar desde el handle derecho sólo cambia el fin
    Cuando arrastro el handle derecho de T 1 día a la derecha
    Entonces T.startDate = 2026-05-01
    Y T.endDate = 2026-05-06

  Escenario: Redimensionar desde el handle izquierdo sólo cambia el inicio
    Cuando arrastro el handle izquierdo de T 1 día a la izquierda
    Entonces T.startDate = 2026-04-30
    Y T.endDate = 2026-05-05

  Escenario: Validación de rango invierte
    Cuando intento redimensionar para que startDate > endDate
    Entonces el server rechaza con [INVALID_RANGE]
    Y la UI revierte al snapshot previo
    Y se muestra un toast con el detalle

  Escenario: Dependencia FS se respeta
    Dado una tarea P con endDate 2026-05-10 como predecesora FS de T
    Cuando intento mover T a startDate 2026-05-05
    Entonces el server rechaza con [DEPENDENCY_VIOLATION]
    Y el toast incluye el título del predecesor

  Escenario: Teclado: ArrowLeft/Right desplaza 1 día
    Dado la barra de T tiene foco
    Cuando presiono "ArrowRight"
    Entonces T se desplaza +1 día
    Cuando presiono "Shift+ArrowLeft"
    Entonces endDate disminuye 1 día

  Escenario: Hitos se arrastran manteniendo su fecha única
    Dado T es un hito con isMilestone = true
    Cuando arrastro el diamante 1 día a la derecha
    Entonces la fecha única avanza 1 día

  Escenario: Navegación por meses
    Dado estoy en "mayo 2026"
    Cuando hago click en "mes siguiente"
    Entonces la URL contiene "?month=2026-06"
    Y las tareas del rango se actualizan
