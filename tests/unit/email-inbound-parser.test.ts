import { describe, it, expect } from 'vitest'

/**
 * R4 · US-7.4 · Email ClickApp — Tests del parser de correos entrantes.
 *
 * Coverage:
 *   - extractMnemonicFromSubject: con / sin patrón [#X-N], variantes Re:/Fwd:.
 *   - stripHtml: elimina <script>, decodifica entidades, preserva saltos.
 *   - parseFromAddress: formato `Nombre <email>`, sólo email, vacío.
 *   - normalizeSendgridPayload: integración mínima con FormData mock.
 */

import {
  extractMnemonicFromSubject,
  stripHtml,
  parseFromAddress,
  extractSlugFromAlias,
  normalizeSendgridPayload,
} from '@/lib/email/inbound-parser'

describe('extractMnemonicFromSubject', () => {
  it('detecta el patrón [#PROJ-123] y devuelve el mnemonic normalizado', () => {
    const { mnemonic, cleanSubject } = extractMnemonicFromSubject(
      'Re: tema importante [#PROJ-123]',
    )
    expect(mnemonic).toBe('PROJ-123')
    expect(cleanSubject).toBe('tema importante')
  })

  it('tolera el patrón sin almohadilla [PROJ-7]', () => {
    const { mnemonic } = extractMnemonicFromSubject('Hola [INFRA-7] algo')
    expect(mnemonic).toBe('INFRA-7')
  })

  it('devuelve null cuando no hay patrón', () => {
    const { mnemonic, cleanSubject } = extractMnemonicFromSubject(
      'asunto sin código',
    )
    expect(mnemonic).toBeNull()
    expect(cleanSubject).toBe('asunto sin código')
  })

  it('normaliza el mnemonic a mayúsculas y limpia "Re:"', () => {
    const { mnemonic, cleanSubject } = extractMnemonicFromSubject(
      'Re: avance [#proj-1]',
    )
    expect(mnemonic).toBe('PROJ-1')
    expect(cleanSubject).toBe('avance')
  })

  it('maneja subject vacío sin lanzar', () => {
    const result = extractMnemonicFromSubject('')
    expect(result.mnemonic).toBeNull()
    expect(result.cleanSubject).toBe('')
  })
})

describe('stripHtml', () => {
  it('elimina <script> con su contenido (defensa XSS básica)', () => {
    const html = '<p>Hola</p><script>alert(1)</script><p>Mundo</p>'
    const text = stripHtml(html)
    expect(text).not.toContain('alert')
    expect(text).toContain('Hola')
    expect(text).toContain('Mundo')
  })

  it('convierte <br> y </p> a saltos de línea', () => {
    const text = stripHtml('<p>uno</p><p>dos<br>tres</p>')
    expect(text).toContain('uno')
    expect(text).toContain('dos')
    expect(text).toContain('tres')
    // dos saltos entre `uno` y `dos`
    expect(text.split('\n').length).toBeGreaterThanOrEqual(3)
  })

  it('decodifica entidades comunes', () => {
    expect(stripHtml('a &amp; b &lt;c&gt;')).toBe('a & b <c>')
  })

  it('devuelve cadena vacía para input vacío', () => {
    expect(stripHtml('')).toBe('')
  })
})

describe('parseFromAddress', () => {
  it('separa "Nombre <email@x.com>" correctamente', () => {
    const r = parseFromAddress('Edwin Martinez <edwin@example.com>')
    expect(r.name).toBe('Edwin Martinez')
    expect(r.email).toBe('edwin@example.com')
  })

  it('tolera comillas alrededor del nombre', () => {
    const r = parseFromAddress('"Edwin M." <ed@x.com>')
    expect(r.name).toBe('Edwin M.')
    expect(r.email).toBe('ed@x.com')
  })

  it('acepta sólo el email', () => {
    const r = parseFromAddress('foo@bar.com')
    expect(r.email).toBe('foo@bar.com')
    expect(r.name).toBeNull()
  })

  it('lowercasea el email', () => {
    const r = parseFromAddress('FOO@BAR.COM')
    expect(r.email).toBe('foo@bar.com')
  })
})

describe('extractSlugFromAlias', () => {
  it('extrae el slug después del +', () => {
    expect(extractSlugFromAlias('inbox+myproj@sync.complejoavante.com')).toBe(
      'myproj',
    )
  })

  it('devuelve null si no hay +', () => {
    expect(extractSlugFromAlias('inbox@example.com')).toBeNull()
  })

  it('lowercasea el slug', () => {
    expect(extractSlugFromAlias('INBOX+MYPROJ@SYNC.COM')).toBe('myproj')
  })
})

describe('normalizeSendgridPayload', () => {
  function makeForm(fields: Record<string, string | File>): FormData {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    return fd
  }

  it('parsea un payload mínimo (text only, sin mnemonic)', () => {
    const fd = makeForm({
      to: 'inbox+myproj@sync.complejoavante.com',
      from: 'Edwin <ed@x.com>',
      subject: 'Nuevo issue',
      text: 'descripción del issue',
      spam_score: '0.3',
    })
    const parsed = normalizeSendgridPayload(fd, 'sync.complejoavante.com')
    expect(parsed.toAlias).toBe('inbox+myproj@sync.complejoavante.com')
    expect(parsed.toSlug).toBe('myproj')
    expect(parsed.from.email).toBe('ed@x.com')
    expect(parsed.from.name).toBe('Edwin')
    expect(parsed.subject).toBe('Nuevo issue')
    expect(parsed.mnemonic).toBeNull()
    expect(parsed.bodyText).toBe('descripción del issue')
    expect(parsed.spamScore).toBeCloseTo(0.3)
  })

  it('detecta mnemonic en subject y limpia el body', () => {
    const fd = makeForm({
      to: 'inbox+myproj@sync.complejoavante.com',
      from: 'ed@x.com',
      subject: 'Avance [#PROJ-9]',
      text: 'comentario sobre la tarea',
    })
    const parsed = normalizeSendgridPayload(fd, 'sync.complejoavante.com')
    expect(parsed.mnemonic).toBe('PROJ-9')
    expect(parsed.cleanSubject).toBe('Avance')
  })

  it('fall-backs a stripHtml cuando sólo viene `html`', () => {
    const fd = makeForm({
      to: 'inbox+myproj@sync.complejoavante.com',
      from: 'ed@x.com',
      subject: 'algo',
      html: '<p>hola <strong>mundo</strong></p>',
    })
    const parsed = normalizeSendgridPayload(fd, 'sync.complejoavante.com')
    expect(parsed.bodyText.toLowerCase()).toContain('hola')
    expect(parsed.bodyText.toLowerCase()).toContain('mundo')
    expect(parsed.bodyHtml).toContain('<p>')
  })

  it('selecciona el "to" que coincide con el dominio configurado', () => {
    const fd = makeForm({
      to: 'spam@otro.com, inbox+real@sync.complejoavante.com',
      from: 'ed@x.com',
      subject: 'x',
      text: 'y',
    })
    const parsed = normalizeSendgridPayload(fd, 'sync.complejoavante.com')
    expect(parsed.toAlias).toBe('inbox+real@sync.complejoavante.com')
    expect(parsed.toSlug).toBe('real')
  })
})
