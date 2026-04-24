# language: es
Característica: Notificaciones por correo al mencionar usuarios en comentarios

  Como colaborador de un proyecto en FollowupGantt
  Quiero que los usuarios mencionados con "@" en mis comentarios reciban un correo
  Para que el equipo se entere inmediatamente sin tener que revisar la herramienta

  Antecedentes:
    Dado que estoy autenticado como "Edwin Martínez" (edwin@complejoavante.com)
    Y existe el usuario "Ana López" con email "ana@complejoavante.com"
    Y existe el usuario "Carlos Pérez" con email "carlos@complejoavante.com"
    Y existe la tarea "PA-7 · Ajustar cronograma Q2" en el proyecto "Proyecto Alfa"
    Y la variable RESEND_API_KEY está configurada

  # ── Envío ────────────────────────────────────────────────────

  Escenario: Comentario con una mención genera un correo
    Cuando escribo el comentario "gracias @ana@complejoavante.com por revisar"
    Y envío el comentario en la tarea "PA-7"
    Entonces se envía 1 correo vía Resend a "ana@complejoavante.com"
    Y el asunto es "Edwin Martínez te mencionó en la tarea [PA-7] Ajustar cronograma Q2"
    Y el cuerpo HTML contiene el texto del comentario
    Y el cuerpo contiene un enlace a "/list?taskId=<id>"

  Escenario: Mención por nombre también resuelve al usuario
    Cuando escribo el comentario "cc @Ana López para visibilidad"
    Y envío el comentario
    Entonces se envía 1 correo a "ana@complejoavante.com"

  Escenario: Múltiples menciones disparan múltiples correos
    Cuando escribo "@ana@complejoavante.com @carlos@complejoavante.com revisen porfa"
    Y envío el comentario
    Entonces se envían 2 correos (uno a Ana, otro a Carlos)
    Y ninguno de los dos contiene al otro en copia

  Escenario: El autor no se notifica a sí mismo si se menciona
    Cuando escribo "@edwin@complejoavante.com recordatorio"
    Y envío el comentario
    Entonces no se envía ningún correo

  Escenario: Mención duplicada genera un solo correo
    Cuando escribo "@ana@complejoavante.com y otra vez @ana@complejoavante.com"
    Y envío el comentario
    Entonces se envía solamente 1 correo a Ana

  Escenario: Comentario sin menciones no dispara correos
    Cuando escribo "ok, procedo" sin menciones
    Y envío el comentario
    Entonces no se realiza ninguna llamada a Resend

  # ── Subtareas ────────────────────────────────────────────────

  Escenario: Mención en subtarea incluye contexto de tarea padre
    Dado la subtarea "PA-7.1 · Validar dependencias" con padre "PA-7"
    Cuando comento "@ana@complejoavante.com revisa FS" en la subtarea
    Entonces el asunto dice "te mencionó en la subtarea [PA-7.1]..."
    Y el cuerpo muestra "En la tarea principal: Ajustar cronograma Q2"

  # ── Seguimiento interno ──────────────────────────────────────

  Escenario: Comentario interno marca badge en el correo
    Dado el comentario se marca como "Seguimiento interno"
    Cuando menciono a "@ana@complejoavante.com"
    Entonces el correo incluye un badge "Seguimiento interno" en el asunto visible del cuerpo

  # ── Resiliencia ──────────────────────────────────────────────

  Escenario: El fallo de Resend no bloquea la creación del comentario
    Dado Resend responde con error 500
    Cuando envío un comentario con mención a "@ana@complejoavante.com"
    Entonces el comentario se persiste en base de datos
    Y el usuario recibe confirmación exitosa en la UI
    Y el error se registra en logs con prefijo "[email]"

  Escenario: Sin RESEND_API_KEY en entorno, la creación sigue funcionando
    Dado la variable RESEND_API_KEY no está configurada
    Cuando envío un comentario con mención
    Entonces el comentario se crea correctamente
    Y se registra un warning "[email] RESEND_API_KEY no configurada"
    Y no se hace ninguna llamada HTTP externa

  Escenario: Envío asincrónico no retrasa la respuesta
    Cuando envío un comentario con 3 menciones
    Entonces la Server Action retorna en menos de 500 ms
    Y los 3 correos se envían vía "after()" tras cerrar la respuesta

  # ── Deuda funcional registrada (fuera de scope) ──────────────

  @deuda
  Escenario: Opt-out por usuario (no implementado en esta iteración)
    Dado Ana ha desactivado las notificaciones por mención
    Cuando alguien la menciona
    Entonces no debería recibir correo
    # TODO: requiere modelo NotificationPreference

  @deuda
  Escenario: Rate limiting de menciones (no implementado)
    Dado un comentario con 50 menciones válidas
    Cuando se envía
    Entonces debería limitarse el número de correos
    # TODO: definir cap (p. ej. 10) y estrategia de agregación
