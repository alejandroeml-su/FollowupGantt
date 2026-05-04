import { describe, expect, it } from 'vitest'

import { listRedactionPlaceholders, redactPII, redactPIIBatch } from '@/lib/ai/llm/redact-pii'

/**
 * Wave P7 · Equipo P7-1 — Tests de redacción heurística de PII.
 *
 * Cobertura: emails, teléfonos (MX y genéricos), RFC mexicano, API
 * tokens (fg_*, sk_*, ghp_*), Bearer tokens, URLs con tokens, mix de
 * casos en un mismo texto, idempotencia.
 */

describe('redactPII · emails', () => {
  it('reemplaza email simple', () => {
    expect(redactPII('contacto: ana@example.com')).toBe('contacto: [EMAIL]')
  })

  it('reemplaza emails con + y subdominios', () => {
    const r = redactPII('Avísale a juan.perez+filtro@mail.complejoavante.com')
    expect(r).toBe('Avísale a [EMAIL]')
  })

  it('reemplaza múltiples emails preservando texto', () => {
    const r = redactPII('cc: a@x.com, b@y.org y c@z.net')
    expect(r).toBe('cc: [EMAIL], [EMAIL] y [EMAIL]')
  })
})

describe('redactPII · teléfonos', () => {
  it('reemplaza teléfono MX con prefijo +52', () => {
    expect(redactPII('llámame al +52 55 1234 5678')).toContain('[PHONE]')
    expect(redactPII('+52 55 1234 5678')).toBe('[PHONE]')
  })

  it('reemplaza teléfono con paréntesis y guiones', () => {
    expect(redactPII('(555) 123-4567')).toBe('[PHONE]')
  })

  it('reemplaza 10 dígitos seguidos', () => {
    expect(redactPII('Tel 5512345678 ok')).toBe('Tel [PHONE] ok')
  })

  it('NO reemplaza números cortos como años o IDs', () => {
    expect(redactPII('año 2026 id 42')).toBe('año 2026 id 42')
  })
})

describe('redactPII · RFC mexicano', () => {
  it('reemplaza RFC persona física con guión', () => {
    expect(redactPII('RFC: GAMA-790101-AB1')).toBe('RFC: [RFC]')
  })

  it('reemplaza RFC persona física sin guión', () => {
    expect(redactPII('RFC GAMA790101AB1')).toBe('RFC [RFC]')
  })

  it('reemplaza RFC persona moral (3 letras)', () => {
    expect(redactPII('proveedor ABC-010101-XYZ')).toBe('proveedor [RFC]')
  })
})

describe('redactPII · API tokens', () => {
  it('reemplaza FollowupGantt API key', () => {
    expect(redactPII('use fg_live_abcdef0123456789')).toBe('use [TOKEN]')
  })

  it('reemplaza OpenAI/Stripe sk_*', () => {
    expect(redactPII('cred: sk_test_abcdefghijklmnop1234')).toBe('cred: [TOKEN]')
  })

  it('reemplaza GitHub PAT (ghp_*)', () => {
    expect(redactPII('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toContain('[TOKEN]')
  })

  it('NO reemplaza tokens demasiado cortos', () => {
    expect(redactPII('fg_live_short')).toBe('fg_live_short')
  })
})

describe('redactPII · Bearer y URLs', () => {
  it('reemplaza Bearer token preservando "Bearer"', () => {
    const r = redactPII('Authorization: Bearer abcd1234EFGH5678ijkl')
    expect(r).toBe('Authorization: Bearer [BEARER]')
  })

  it('reemplaza URL con ?token=xxx preservando host/path', () => {
    const r = redactPII('https://api.example.com/v1/items?token=secret123abc')
    expect(r).toBe('https://api.example.com/v1/items?token=[URL_TOKEN]')
  })

  it('reemplaza URL con &apikey=xxx', () => {
    const r = redactPII('https://x.com/?foo=1&apikey=ABCDEF')
    expect(r).toBe('https://x.com/?foo=1&apikey=[URL_TOKEN]')
  })

  it('reemplaza URL con access_token=', () => {
    const r = redactPII('redirect=https://cb?access_token=xyz789')
    expect(r).toContain('[URL_TOKEN]')
  })
})

describe('redactPII · sin PII', () => {
  it('preserva texto sin patrones sensibles', () => {
    const txt = 'Reorganizar el sprint 12 y revisar el roadmap del Q2'
    expect(redactPII(txt)).toBe(txt)
  })

  it('preserva strings vacíos', () => {
    expect(redactPII('')).toBe('')
  })
})

describe('redactPII · mix y idempotencia', () => {
  it('redacta varios tipos en un mismo texto', () => {
    const txt = 'A juan@x.com (RFC GAMA790101AB1) llamar al 5512345678 con fg_live_abcdef0123456789'
    const r = redactPII(txt)
    expect(r).toContain('[EMAIL]')
    expect(r).toContain('[RFC]')
    expect(r).toContain('[PHONE]')
    expect(r).toContain('[TOKEN]')
    expect(r).not.toContain('juan@x.com')
    expect(r).not.toContain('GAMA790101AB1')
    expect(r).not.toContain('5512345678')
    expect(r).not.toContain('fg_live_abcdef0123456789')
  })

  it('es idempotente: aplicar dos veces da el mismo resultado', () => {
    const txt = 'cc: ana@x.com tel +52 55 1234 5678 token sk_live_abcdefghijklmnop1234'
    const once = redactPII(txt)
    const twice = redactPII(once)
    expect(twice).toBe(once)
  })

  it('redactPIIBatch aplica a todo el array', () => {
    const out = redactPIIBatch(['ana@x.com', 'sin pii', '+52 55 1234 5678'])
    expect(out[0]).toBe('[EMAIL]')
    expect(out[1]).toBe('sin pii')
    expect(out[2]).toBe('[PHONE]')
  })
})

describe('redactPII · API auxiliar', () => {
  it('listRedactionPlaceholders incluye todos los placeholders', () => {
    const list = listRedactionPlaceholders()
    expect(list).toContain('[EMAIL]')
    expect(list).toContain('[PHONE]')
    expect(list).toContain('[RFC]')
    expect(list).toContain('[TOKEN]')
    expect(list).toContain('[URL_TOKEN]')
    expect(list).toContain('[BEARER]')
  })
})
