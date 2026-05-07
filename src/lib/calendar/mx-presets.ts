/**
 * Wave P10 (HU-10.2 · BETA-1.5) — Presets de holidays oficiales México.
 *
 * Módulo puro (sin Prisma, sin server actions). Genera filas listas para
 * inyectar en `bulkImportHolidays` desde la UI o un seed.
 *
 * Cubre los 4 holidays fijos por mes/día. Los holidays "movibles" (LFT Art. 74
 * fracciones I-bis, II, V — 1er lun feb, 3er lun mar, 3er lun nov) se generan
 * por año vía `buildMxMovableHolidayRows(year)`.
 */

export const MX_HOLIDAYS_FIXED: ReadonlyArray<{
  monthDay: string // "MM-DD"
  name: string
}> = [
  { monthDay: '01-01', name: 'Año Nuevo' },
  { monthDay: '05-01', name: 'Día del Trabajo' },
  { monthDay: '09-16', name: 'Independencia de México' },
  { monthDay: '12-25', name: 'Navidad' },
]

/** Holidays MX fijos · año dado · recurring=true. */
export function buildMxFixedHolidayRows(
  year: number,
): Array<{ date: Date; name: string; recurring: true }> {
  return MX_HOLIDAYS_FIXED.map(({ monthDay, name }) => {
    const d = new Date(`${year}-${monthDay}T00:00:00.000Z`)
    return { date: d, name, recurring: true }
  })
}

/**
 * Devuelve la fecha del N-ésimo día de la semana en un mes (1-indexed).
 * `nthMonday(2026, 1, 1)` = primer lunes de febrero 2026.
 * Mes 0-indexed (0 = enero, 11 = diciembre).
 */
function nthDayOfMonth(
  year: number,
  monthZeroIndexed: number,
  weekdayJs: number, // 0=domingo … 6=sábado
  nth: number, // 1-indexed
): Date {
  const first = new Date(Date.UTC(year, monthZeroIndexed, 1))
  const firstWeekday = first.getUTCDay()
  const offset = (weekdayJs - firstWeekday + 7) % 7
  const day = 1 + offset + (nth - 1) * 7
  return new Date(Date.UTC(year, monthZeroIndexed, day))
}

/**
 * Holidays MX movibles del año dado · LFT Art. 74:
 *  - 1er lunes de febrero (Constitución)
 *  - 3er lunes de marzo (Natalicio Benito Juárez)
 *  - 3er lunes de noviembre (Revolución Mexicana)
 *
 * `recurring=false` porque la fecha cambia año a año.
 */
export function buildMxMovableHolidayRows(
  year: number,
): Array<{ date: Date; name: string; recurring: false }> {
  const MON = 1
  return [
    {
      date: nthDayOfMonth(year, 1, MON, 1),
      name: 'Día de la Constitución',
      recurring: false,
    },
    {
      date: nthDayOfMonth(year, 2, MON, 3),
      name: 'Natalicio de Benito Juárez',
      recurring: false,
    },
    {
      date: nthDayOfMonth(year, 10, MON, 3),
      name: 'Día de la Revolución Mexicana',
      recurring: false,
    },
  ]
}

/** Combo conveniente: 7 holidays MX para un año (4 fijos + 3 movibles). */
export function buildMxAllHolidayRows(
  year: number,
): Array<{ date: Date; name: string; recurring: boolean }> {
  return [...buildMxFixedHolidayRows(year), ...buildMxMovableHolidayRows(year)]
}
