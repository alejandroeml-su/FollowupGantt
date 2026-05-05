/**
 * Ola P8 · Equipo P8-3 · Cost Management — conversión de monedas.
 *
 * Helpers para convertir importes entre monedas usando `CurrencyRate` con
 * base USD. El repositorio asume USD como moneda canónica:
 *   - Las tasas se almacenan como `USD → X` (base="USD", quote="X").
 *   - Para convertir `from → to`:
 *       1. Obtener rate(from = USD, quote = from) → factor `f`.
 *       2. Obtener rate(from = USD, quote = to)   → factor `t`.
 *       3. `amount_to = amount_from / f * t`.
 *     Cuando `from === USD` la división es 1; cuando `to === USD` la
 *     multiplicación es 1.
 *
 * Decisión D-CONV-1: el helper trabaja con `number` (centavos perdidos
 * <0.01% en montos típicos < $1M). Para amounts > $1B usar Prisma.Decimal
 * directamente — fuera del scope MVP P8-3.
 *
 * Decisión D-CONV-2: si no hay rate disponible (BD vacía, fetch falló),
 * `convertCurrency` devuelve `null` (NO lanza). El caller decide si dejar
 * `amountUsd = NULL` en el Expense o aplicar política de fallback. Esto
 * preserva el invariante "submitir gasto nunca falla por feed externo".
 */

export interface CurrencyRateRow {
  base: string
  quote: string
  /** Cantidad de `quote` que vale 1 unidad de `base`. Ej. USD→MXN ≈ 17. */
  rate: number
  fetchedAt: Date
}

/**
 * Repositorio mínimo de tasas. La implementación productiva consulta BD
 * (`prisma.currencyRate.findFirst({ where: { base, quote }, orderBy:
 * fetchedAt desc })`); los tests inyectan un map en memoria.
 */
export interface CurrencyRateLookup {
  /**
   * Devuelve la tasa más reciente USD→quote (o null si no existe).
   */
  latest(quote: string): Promise<CurrencyRateRow | null> | CurrencyRateRow | null
}

/**
 * Convierte `amount` de la moneda `from` a la moneda `to` usando las tasas
 * más recientes disponibles. Asume que las tasas están normalizadas como
 * `USD → quote` y trianguliza vía USD.
 *
 * Devuelve null si falta cualquier tasa requerida.
 */
export async function convertCurrency(
  amount: number,
  from: string,
  to: string,
  lookup: CurrencyRateLookup,
): Promise<number | null> {
  if (!Number.isFinite(amount)) return null
  const fromUpper = from.trim().toUpperCase()
  const toUpper = to.trim().toUpperCase()
  if (!fromUpper || !toUpper) return null
  if (fromUpper === toUpper) return amount

  const fromFactor = fromUpper === 'USD' ? 1 : await resolveFactor(fromUpper, lookup)
  if (fromFactor === null) return null

  const toFactor = toUpper === 'USD' ? 1 : await resolveFactor(toUpper, lookup)
  if (toFactor === null) return null

  // amount[from] / (USD→from) = amount[USD]; * (USD→to) = amount[to]
  const amountUsd = amount / fromFactor
  const result = amountUsd * toFactor
  return roundHalfEven(result, 2)
}

/**
 * Atajo para amount → USD (la operación más común del repo).
 * Equivalente a `convertCurrency(amount, currency, 'USD', lookup)`.
 */
export async function toUsd(
  amount: number,
  currency: string,
  lookup: CurrencyRateLookup,
): Promise<number | null> {
  return convertCurrency(amount, currency, 'USD', lookup)
}

async function resolveFactor(
  quote: string,
  lookup: CurrencyRateLookup,
): Promise<number | null> {
  const row = await Promise.resolve(lookup.latest(quote))
  if (!row) return null
  if (!Number.isFinite(row.rate) || row.rate <= 0) return null
  return row.rate
}

/**
 * Redondeo bancario (half-even / round-half-to-even) — minimiza sesgo
 * acumulado en agregaciones masivas (vs `Math.round` que sesga hacia
 * arriba en .5 exactos). Necesario porque sumamos cientos de gastos en
 * el dashboard y queremos `sum(toUsd(x))` ≈ `toUsd(sum(x))` dentro de
 * 1 centavo.
 */
export function roundHalfEven(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  const factor = 10 ** decimals
  const scaled = value * factor
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  let rounded: number
  if (diff > 0.5) {
    rounded = floor + 1
  } else if (diff < 0.5) {
    rounded = floor
  } else {
    // exactly 0.5 → bankers rounding (to even)
    rounded = floor % 2 === 0 ? floor : floor + 1
  }
  return rounded / factor
}

/**
 * Construye un `CurrencyRateLookup` a partir de un array plano de filas.
 * Usado por tests y por flujos donde las rates ya se cargaron upfront.
 */
export function lookupFromRows(rows: CurrencyRateRow[]): CurrencyRateLookup {
  // Indexamos por quote tomando la fila con `fetchedAt` más reciente.
  const byQuote = new Map<string, CurrencyRateRow>()
  for (const row of rows) {
    if (row.base !== 'USD') continue // sólo soportamos USD como base canónica
    const prev = byQuote.get(row.quote.toUpperCase())
    if (!prev || row.fetchedAt.getTime() > prev.fetchedAt.getTime()) {
      byQuote.set(row.quote.toUpperCase(), row)
    }
  }
  return {
    latest(quote: string) {
      return byQuote.get(quote.toUpperCase()) ?? null
    },
  }
}
