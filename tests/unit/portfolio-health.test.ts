import { describe, it, expect } from 'vitest'
import { deriveHealthStatus } from '@/lib/portfolio/health'

describe('portfolio-health · deriveHealthStatus', () => {
  it('ON_TRACK con CPI/SPI saludables y sin riesgos', () => {
    expect(
      deriveHealthStatus({ cpi: 1.0, spi: 1.0, highRiskCount: 0 }),
    ).toBe('ON_TRACK')
  })

  it('ON_TRACK cuando no hay datos EVM (cpi/spi null) y sin riesgos', () => {
    expect(
      deriveHealthStatus({ cpi: null, spi: null, highRiskCount: 0 }),
    ).toBe('ON_TRACK')
  })

  it('AT_RISK con riesgo HIGH abierto pese a EVM saludable', () => {
    expect(
      deriveHealthStatus({ cpi: 1.0, spi: 1.0, highRiskCount: 1 }),
    ).toBe('AT_RISK')
  })

  it('AT_RISK cuando SPI < 0.95 pero ≥ 0.85', () => {
    expect(
      deriveHealthStatus({ cpi: 1.0, spi: 0.9, highRiskCount: 0 }),
    ).toBe('AT_RISK')
  })

  it('AT_RISK cuando CPI < 0.95 pero ≥ 0.70', () => {
    expect(
      deriveHealthStatus({ cpi: 0.85, spi: 1.0, highRiskCount: 0 }),
    ).toBe('AT_RISK')
  })

  it('DELAYED cuando SPI < 0.85 (gana sobre AT_RISK)', () => {
    expect(
      deriveHealthStatus({ cpi: 1.0, spi: 0.7, highRiskCount: 0 }),
    ).toBe('DELAYED')
  })

  it('BLOCKED cuando hay riesgo HIGH y CPI < 0.7', () => {
    expect(
      deriveHealthStatus({ cpi: 0.5, spi: 1.0, highRiskCount: 2 }),
    ).toBe('BLOCKED')
  })

  it('BLOCKED gana sobre DELAYED si ambas reglas aplican', () => {
    expect(
      deriveHealthStatus({ cpi: 0.5, spi: 0.5, highRiskCount: 1 }),
    ).toBe('BLOCKED')
  })

  it('threshold exacto: SPI=0.85 → AT_RISK (no DELAYED)', () => {
    expect(
      deriveHealthStatus({ cpi: 1.0, spi: 0.85, highRiskCount: 0 }),
    ).toBe('AT_RISK')
  })

  it('threshold exacto: CPI=0.7 sin riesgo → AT_RISK (no BLOCKED)', () => {
    // BLOCKED requiere riesgo HIGH; sin él, CPI=0.7 cae en AT_RISK
    expect(
      deriveHealthStatus({ cpi: 0.7, spi: 1.0, highRiskCount: 0 }),
    ).toBe('AT_RISK')
  })
})
