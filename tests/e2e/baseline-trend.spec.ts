import { test } from '@playwright/test'

/**
 * HU-3.4 · E2E para el panel SV/SPI.
 *
 * TODO(EPIC-P0-3): habilitar cuando el helper de seed (`seedBaselines`)
 * permita preparar un proyecto con baseline + tareas reales con
 * progreso/EV. Hoy `makeGanttFixture` no expone una utilidad de seed
 * para `Baseline` con valores monetarios coherentes.
 *
 * Cuando se habilite, cubrir:
 *  - Toggle "Ver SV/SPI" disabled si no hay baseline activa.
 *  - Click en toggle → panel se expande a 360px con animación.
 *  - SVG renderiza puntos coloreados por SPI (verde/amarillo/rojo).
 *  - Tabla últimos 6 meses incluye fila con `aria-current="date"` para
 *    el mes actual cuando aplica.
 *  - Cierre con Escape vuelve al estado colapsado.
 *  - Persistencia: recargar la página recupera el estado abierto/cerrado.
 *  - Sin baseline activa: placeholder "Selecciona una línea base…".
 */

test.describe.skip('HU-3.4 · panel evolución SV/SPI', () => {
  test('expande/colapsa el panel y persiste el estado', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('grafica puntos SV con tono según SPI', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('tabla resalta el mes actual con aria-current=date', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('Escape cierra el panel', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })

  test('toggle disabled cuando no hay baseline activa', async () => {
    // Pendiente — ver TODO(EPIC-P0-3) arriba.
  })
})
