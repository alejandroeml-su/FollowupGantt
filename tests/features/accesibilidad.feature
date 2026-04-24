# language: es
Característica: Accesibilidad WCAG 2.1 AA

  Escenario: Contraste de color
    Dado que cualquier texto tiene contraste mínimo 4.5:1 con su fondo
    Y todos los bordes de foco tienen contraste mínimo 3:1
    Entonces axe-core no reporta violaciones de tipo "color-contrast"

  Escenario: Roles ARIA en Kanban
    Dado la vista Kanban está cargada
    Entonces el contenedor tiene role="grid"
    Y cada columna tiene aria-colindex
    Y cada tarjeta tiene role="gridcell"

  Escenario: Live region para DnD
    Dado arrastro una tarea con teclado
    Cuando presiono Space para pickup
    Entonces la región aria-live="polite" anuncia "Tarea tomada"
    Cuando muevo la tarea
    Entonces se anuncia la nueva posición

  Escenario: Sin violaciones serious en ninguna vista
    Cuando recorro /list, /kanban, /gantt
    Entonces axe-core no reporta violaciones "serious" ni "critical"

  Escenario: Respeta prefers-reduced-motion
    Dado el sistema tiene prefers-reduced-motion="reduce"
    Cuando se abre un drawer o se arrastra una tarea
    Entonces no se ejecutan animaciones de spring
    Y sólo se usan transiciones de opacity

  Escenario: Touch target mínimo
    Dado un dispositivo táctil
    Entonces cada control interactivo mide al menos 44x44 px
