# language: es
Característica: Menús contextuales estilo ClickUp

  Antecedentes:
    Dado que estoy autenticado
    Y hay tareas en la vista Kanban

  Escenario: Click derecho sobre una tarea
    Cuando hago click derecho sobre una tarjeta de tarea
    Entonces aparece un menú con los items:
      | Editar         |
      | Duplicar       |
      | Mover a        |
      | Cambiar estado |
      | Asignar        |
      | Etiquetar      |
      | Copiar enlace  |
      | Archivar       |
      | Eliminar       |
    Y cada ítem muestra un icono de lucide
    Y los ítems con atajo muestran la combinación de teclas

  Escenario: Submenú Mover a
    Cuando hago click derecho sobre una tarea
    Y paso el cursor sobre "Mover a"
    Entonces aparece un submenú con las columnas disponibles
    Y puedo navegar con ArrowRight / ArrowLeft

  Escenario: Acciones masivas con multi-selección
    Dado tengo 5 tareas seleccionadas
    Cuando hago click derecho sobre cualquiera de ellas
    Entonces el título dice "Acciones para 5 tareas"
    Y "Eliminar" actúa sobre las 5
    Y "Eliminar" pide confirmación explícita

  Escenario: Cierre del menú
    Dado el menú está abierto
    Cuando presiono "Escape"
    Entonces el menú se cierra
    Y el foco regresa al trigger
    Cuando hago click fuera del menú
    Entonces el menú se cierra sin efectos

  Escenario: Menú sobre columna Kanban
    Cuando hago click derecho en el encabezado de la columna "REVIEW"
    Entonces aparece un menú con:
      | Renombrar      |
      | Cambiar color  |
      | Colapsar       |
      | Definir WIP    |
      | Eliminar       |

  Escenario: Posicionamiento inteligente cerca del borde
    Dado una tarea en el borde derecho del viewport
    Cuando hago click derecho
    Entonces el menú se posiciona hacia la izquierda para no salirse
