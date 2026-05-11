/**
 * Wave R4-E · Monetización SaaS — Pricing tiers.
 *
 * Módulo PURO (no IO, no server-only). Importable desde server actions,
 * route handlers y componentes cliente sin riesgo. La fuente de verdad
 * de los límites por plan vive aquí — server actions consultan vía
 * `getTierLimits()` y la UI muestra el catálogo via `PRICING_TIERS`.
 *
 * Decisiones documentadas:
 *   D-PRICING-1: `users: -1` significa unlimited (semántica explícita).
 *                Los checks en `enforce.ts` tratan -1 como `Infinity`.
 *   D-PRICING-2: `features` es array de strings simples (no enum) para
 *                permitir extender sin migración. La feature `'*'` en
 *                ENTERPRISE es wildcard — el gate considera cualquier
 *                feature pedida como disponible.
 *   D-PRICING-3: Precios USD por usuario por mes. Para el cálculo final
 *                Stripe usa `quantity = seats` en la Subscription line.
 *   D-PRICING-4: `brainCalls` es cuota mensual (resetea cada periodo).
 *                MVP: contador `Workspace.brainCallsThisMonth` (no Redis).
 *                Cron mensual `resetMonthlyCounters()` debe correr el día 1.
 */

export const PRICING_TIERS = {
  FREE: {
    label: 'Free',
    priceMonthly: 0,
    users: 3,
    projects: 1,
    storageGB: 1,
    brainCalls: 50,
    features: ['gantt', 'kanban', 'basic_brain'] as readonly string[],
    description: 'Para equipos pequeños probando Sync.',
    cta: 'Comenzar gratis',
  },
  PRO: {
    label: 'Pro',
    priceMonthly: 10,
    users: 25,
    projects: 10,
    storageGB: 25,
    brainCalls: 1000,
    features: [
      'gantt',
      'kanban',
      'evm',
      'risks',
      'monte_carlo',
      'auto_pilot',
      'realtime',
      'mobile',
    ] as readonly string[],
    description: 'PMI + Scrum + IA avanzada para PMOs en crecimiento.',
    cta: 'Probar Pro',
  },
  ENTERPRISE: {
    label: 'Enterprise',
    priceMonthly: 25,
    users: -1,
    projects: -1,
    storageGB: 500,
    brainCalls: 10000,
    features: [
      '*',
      'sso',
      'siem',
      'retention',
      'powerbi_directquery',
    ] as readonly string[],
    description: 'SSO, SIEM, retention y soporte 24/7 para corporativos.',
    cta: 'Contactar ventas',
  },
} as const

export type PricingTier = keyof typeof PRICING_TIERS
export type TierLimits = (typeof PRICING_TIERS)[PricingTier]

/** Lista ordenada de tiers (de menor a mayor capacidad). Útil para UI. */
export const TIER_ORDER: readonly PricingTier[] = ['FREE', 'PRO', 'ENTERPRISE']

/**
 * Recursos cuantificables que valida `requireCapacity`.
 * Mapea 1-1 con campos numéricos de `PRICING_TIERS`.
 */
export type CapacityResource = 'users' | 'projects' | 'storageGB' | 'brainCalls'

/**
 * Devuelve el catálogo de límites del tier. Defensivo: si el caller pasa
 * un string libre que no es tier conocido, cae a FREE (mismo comportamiento
 * del enforcement cuando un workspace no tiene `BillingSubscription`).
 */
export function getTierLimits(tier: string | null | undefined): TierLimits {
  if (tier && tier in PRICING_TIERS) {
    return PRICING_TIERS[tier as PricingTier]
  }
  return PRICING_TIERS.FREE
}

/**
 * `true` si el tier incluye una feature concreta. ENTERPRISE wildcard `'*'`
 * cubre cualquier feature. Comparación case-sensitive (intencional — las
 * features están en snake_case y son strings cerrados).
 */
export function tierIncludesFeature(tier: string | null | undefined, feature: string): boolean {
  const limits = getTierLimits(tier)
  return limits.features.includes('*') || limits.features.includes(feature)
}

/**
 * `true` si el tier permite alojar `current+1` recursos del tipo dado.
 * Trata `-1` (unlimited) como `Infinity`. Si `current` ya excede el límite
 * (caso edge: downgrade), también devuelve false.
 */
export function tierAllowsCapacity(
  tier: string | null | undefined,
  resource: CapacityResource,
  current: number,
): boolean {
  const limits = getTierLimits(tier)
  const max = limits[resource]
  if (max === -1) return true
  return current < max
}

/**
 * Lookup del Stripe Price ID configurado por env var. Devuelve `null` para
 * FREE (no requiere checkout) o si el env var no está seteado (la app debe
 * mostrar UI tipo "Contactar ventas" en lugar de iniciar checkout).
 *
 * Convención de env vars:
 *   - STRIPE_PRICE_PRO_MONTHLY
 *   - STRIPE_PRICE_ENT_MONTHLY
 *
 * Se mantienen separadas (no un solo JSON) para alinear con el patrón del
 * resto del repo y permitir override por entorno (test/staging/prod).
 */
export function getStripePriceIdForTier(tier: PricingTier): string | null {
  if (tier === 'FREE') return null
  if (tier === 'PRO') return process.env.STRIPE_PRICE_PRO_MONTHLY ?? null
  if (tier === 'ENTERPRISE') return process.env.STRIPE_PRICE_ENT_MONTHLY ?? null
  return null
}
