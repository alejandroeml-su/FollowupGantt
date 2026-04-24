Actúa como un @po con experiencia en herramientas de gestión 
de proyectos (ClickUp, Asana, Monday, Jira). Necesito que redactes una 
historia de usuario técnica y detallada para replicar los comportamientos de 
navegabilidad, drag & drop y menús contextuales que permitan la modificación 
de tareas en una plataforma de seguimiento de proyectos similar a ClickUp.

CONTEXTO DEL PRODUCTO:
- Plataforma web de gestión y seguimiento de proyectos
- Usuarios: Project Managers, líderes de equipo, colaboradores
- Referente de UX/UI: ClickUp (vistas List, Board/Kanban, Gantt, Calendar)
- Stack tecnológico: El actual para este proyecto

ENTREGABLES ESPERADOS:
1. Historia de usuario en formato estándar (Como… Quiero… Para…)
2. Criterios de aceptación en formato Gherkin (Given/When/Then)
3. Especificación detallada de cada comportamiento de interacción
4. Casos borde y manejo de errores
5. Requisitos no funcionales (performance, accesibilidad)

COMPORTAMIENTOS A CUBRIR OBLIGATORIAMENTE:

A) NAVEGABILIDAD ENTRE TAREAS
- Navegación por teclado (flechas, Tab, Enter, Esc)
- Breadcrumbs jerárquicos (Espacio > Carpeta > Lista > Tarea > Subtarea)
- Atajos de teclado tipo ClickUp (ej. "T" para nueva tarea, "/" para búsqueda)
- Navegación entre vistas (List, Board, Gantt, Calendar) manteniendo filtros
- Panel lateral deslizable para detalle de tarea sin perder contexto
- Navegación rápida entre tareas adyacentes (siguiente/anterior)

B) DRAG & DROP
- Reordenamiento de tareas dentro de una lista (cambio de prioridad/orden)
- Mover tareas entre estados/columnas en vista Kanban
- Mover tareas entre listas, carpetas o espacios
- Reasignación de responsable arrastrando avatar
- Cambio de fecha arrastrando en vista Gantt/Calendar
- Anidar subtareas arrastrando sobre una tarea padre
- Indicadores visuales: ghost element, drop zones, líneas guía
- Multi-selección y drag & drop en lote
- Scroll automático al arrastrar cerca de los bordes

C) MENÚS CONTEXTUALES (click derecho)
- Menú contextual sobre una tarea con acciones: editar, duplicar, mover, 
  copiar enlace, archivar, eliminar, cambiar estado, asignar, etiquetar
- Menú contextual sobre lista/columna: renombrar, colapsar, cambiar color
- Submenús para acciones agrupadas (ej. "Mover a > Espacio > Lista")
- Acciones masivas al seleccionar múltiples tareas
- Cierre automático con Esc, click fuera o selección de acción
- Posicionamiento inteligente (evitar salirse del viewport)
- Accesos rápidos con iconos y atajos de teclado mostrados

FORMATO DE SALIDA:
Entrega el documento estructurado con los siguientes encabezados:
1. Título de la historia
2. Descripción
3. Historia de usuario (formato estándar)
4. Criterios de aceptación (Gherkin)
5. Especificación funcional por bloque (A, B, C)
6. Wireframes descriptivos o referencias visuales
7. Casos borde
8. Requisitos no funcionales
9. Dependencias técnicas
10. Definición de Hecho (DoD)

Incluye consideraciones de accesibilidad (WCAG 2.1 AA), soporte táctil para 
tablets, y comportamiento responsive.