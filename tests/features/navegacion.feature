# language: es
Característica: Navegación por teclado y estructura

  Antecedentes:
    Dado que estoy autenticado como Project Manager
    Y el proyecto "Proyecto Alfa" tiene 3 tareas TODO en /list

  Escenario: Mover foco con flechas en vista List
    Dado que la primera tarea tiene foco
    Cuando presiono la tecla "ArrowDown"
    Entonces el foco se mueve a la siguiente tarea
    Y el indicador de foco es visible con outline 2px en color Avante-600

  Escenario: Abrir panel lateral con Enter sin perder contexto
    Dado que una tarea tiene foco
    Cuando presiono la tecla "Enter"
    Entonces el Drawer lateral se abre con el detalle de la tarea
    Y la lista permanece visible a la izquierda
    Cuando presiono la tecla "Escape"
    Entonces el Drawer se cierra
    Y el foco regresa a la fila original

  Escenario: Atajo global para nueva tarea
    Dado que estoy en cualquier vista
    Y que el foco no está en un campo editable
    Cuando presiono la tecla "T"
    Entonces se abre el creador rápido
    Y el campo título recibe el foco

  Escenario: Paleta de comandos con "/"
    Cuando presiono la tecla "/"
    Entonces se abre la paleta de búsqueda
    Y el placeholder dice "Buscar tareas, proyectos o acciones…"

  Escenario: Overlay de atajos con Shift + /
    Cuando presiono "Shift + /"
    Entonces se muestra el overlay con la tabla de atajos
    Y contiene el atajo "Mover foco ↓ / ↑"

  Escenario: Breadcrumbs jerárquicos
    Dado que abro el Drawer de una subtarea
    Entonces el breadcrumb muestra "Gerencia › Área › Proyecto › Tarea padre › Subtarea"
    Y cada segmento es enfocable con Tab

  Escenario: Navegación J/K dentro del Drawer
    Dado que el Drawer muestra la tarea "T-101"
    Cuando presiono la tecla "J"
    Entonces el Drawer carga la tarea adyacente siguiente
    Cuando presiono la tecla "K"
    Entonces el Drawer vuelve a la tarea anterior
