/**
 * Wave P10 (HU-10.6) — Cálculos EVM puros (PMI/PMBOK).
 *
 * Sin Prisma, sin I/O. Recibe BAC/EV/AC/PV ya calculados y devuelve los
 * indicadores derivados: CPI, SPI, EAC, ETC, VAC.
 *
 *   BAC  · Budget at Completion (presupuesto total proyecto)
 *   EV   · Earned Value (valor ganado a la fecha)
 *   AC   · Actual Cost (costo real incurrido)
 *   PV   · Planned Value (valor planeado a la fecha)
 *   CPI  · Cost Performance Index = EV / AC
 *   SPI  · Schedule Performance Index = EV / PV
 *   EAC  · Estimate at Completion = BAC / CPI
 *   ETC  · Estimate to Complete = EAC - AC = (BAC - EV) / CPI
 *   VAC  · Variance at Completion = BAC - EAC
 *
 * Edge cases:
 *  - AC = 0 → CPI = null (división por cero); proyecto sin gasto reportado
 *  - PV = 0 → SPI = null
 *  - CPI = null → EAC, ETC, VAC = null
 */

export interface EvmInput {
  bac: number | null
  ev: number | null
  ac: number | null
  pv: number | null
}

export interface EvmMetrics {
  bac: number | null
  ev: number | null
  ac: number | null
  pv: number | null
  cpi: number | null
  spi: number | null
  eac: number | null
  etc: number | null
  vac: number | null
}

const round = (n: number, dec = 2) => Number(n.toFixed(dec))

export function computeEvmMetrics(input: EvmInput): EvmMetrics {
  const { bac, ev, ac, pv } = input

  const cpi =
    ev != null && ac != null && ac > 0 ? round(ev / ac, 4) : null
  const spi =
    ev != null && pv != null && pv > 0 ? round(ev / pv, 4) : null

  let eac: number | null = null
  let etc: number | null = null
  let vac: number | null = null

  if (bac != null && cpi != null) {
    eac = round(bac / cpi)
    if (ac != null) etc = round(eac - ac)
    vac = round(bac - eac)
  }

  return { bac, ev, ac, pv, cpi, spi, eac, etc, vac }
}

/**
 * Suma EVM de un portafolio agregando varios proyectos. Útil para totales
 * a nivel CFO.
 *
 * Nulls se tratan como 0 al sumar (asumimos que un proyecto sin EV/AC
 * no contribuye, no que falta data crítica).
 */
export function aggregatePortfolioEvm(
  projects: ReadonlyArray<EvmInput>,
): EvmMetrics {
  const totals = projects.reduce<{
    bac: number
    ev: number
    ac: number
    pv: number
  }>(
    (acc, p) => {
      acc.bac += p.bac ?? 0
      acc.ev += p.ev ?? 0
      acc.ac += p.ac ?? 0
      acc.pv += p.pv ?? 0
      return acc
    },
    { bac: 0, ev: 0, ac: 0, pv: 0 },
  )
  return computeEvmMetrics(totals)
}
