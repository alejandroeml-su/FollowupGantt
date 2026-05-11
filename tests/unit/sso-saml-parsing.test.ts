import { describe, it, expect } from 'vitest'

/**
 * R3.0 · Fase 2 · SSO/SAML — Tests de parseo de metadata XML y SAML Response.
 *
 * Cubre:
 *   - parseSamlMetadata extrae entityId, ssoUrl y x509Cert.
 *   - parseSamlMetadata lanza [INVALID_METADATA] con XML inválido.
 *   - parseSamlResponse extrae NameID + Issuer + atributos.
 *   - parseSamlResponse rechaza assertion expirado.
 *   - verifyXmlSignature rechaza firmas SHA1.
 */

import {
  parseSamlMetadata,
  parseSamlResponse,
  verifyXmlSignature,
  buildAuthnRequest,
} from '@/lib/sso/saml'

const FAKE_CERT_BODY =
  'MIIDdzCCAl+gAwIBAgIEU2KCcDANBgkqhkiG9w0BAQsFADBzMQswCQYDVQQGEwJVUzELMAkGA1UECBMCQ0ExFjAUBgNVBAcTDU1vdW50YWluIFZpZXcxFTATBgNVBAoTDFNhbXBsZSBTYW1wbGUxFTATBgNVBAsTDFNhbXBsZSBzYW1wbGUxETAPBgNVBAMTCFNhbXBsZUlkMB4XDTI0MDEwMTAwMDAwMFoXDTM0MDEwMTAwMDAwMFow'

const SAMPLE_METADATA = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
    entityID="https://sts.windows.net/tenant-abc/">
  <md:IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>${FAKE_CERT_BODY}</ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
        Location="https://login.microsoftonline.com/tenant-abc/saml2"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="https://login.microsoftonline.com/tenant-abc/saml2"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`

function buildSamlResponse(opts: {
  issuer: string
  nameId: string
  email: string
  notOnOrAfter?: string
  withSha1?: boolean
  attrs?: Record<string, string | string[]>
}): string {
  const expires =
    opts.notOnOrAfter ??
    new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const sigAlg = opts.withSha1
    ? 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
    : 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
  const attrs = opts.attrs ?? {
    'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': opts.email,
  }
  const attrXml = Object.entries(attrs)
    .map(([name, values]) => {
      const list = Array.isArray(values) ? values : [values]
      const vals = list
        .map((v) => `<saml:AttributeValue>${v}</saml:AttributeValue>`)
        .join('')
      return `<saml:Attribute Name="${name}">${vals}</saml:Attribute>`
    })
    .join('')

  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
    xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
    xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
    ID="resp_1" Version="2.0" IssueInstant="2026-05-11T10:00:00Z">
  <saml:Issuer>${opts.issuer}</saml:Issuer>
  <saml:Assertion ID="_a1" IssueInstant="2026-05-11T10:00:00Z" Version="2.0">
    <saml:Issuer>${opts.issuer}</saml:Issuer>
    <ds:Signature>
      <ds:SignedInfo>
        <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>
        <ds:SignatureMethod Algorithm="${sigAlg}"/>
        <ds:Reference URI="#_a1">
          <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
          <ds:DigestValue>abc</ds:DigestValue>
        </ds:Reference>
      </ds:SignedInfo>
      <ds:SignatureValue>aGVsbG8=</ds:SignatureValue>
    </ds:Signature>
    <saml:Subject>
      <saml:NameID>${opts.nameId}</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="${expires}"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotOnOrAfter="${expires}"/>
    <saml:AuthnStatement SessionIndex="sess_42">
      <saml:AuthnContext>
        <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>
      </saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>${attrXml}</saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`
}

describe('parseSamlMetadata', () => {
  it('1. extrae entityId, ssoUrl (HTTP-Redirect preferido) y x509Cert', () => {
    const parsed = parseSamlMetadata(SAMPLE_METADATA)
    expect(parsed.entityId).toBe('https://sts.windows.net/tenant-abc/')
    expect(parsed.ssoUrl).toBe(
      'https://login.microsoftonline.com/tenant-abc/saml2',
    )
    expect(parsed.x509Cert.startsWith('MIIDdzCC')).toBe(true)
    expect(parsed.x509Cert).not.toMatch(/\s/)
  })

  it('2. lanza [INVALID_METADATA] cuando falta EntityDescriptor', () => {
    expect(() => parseSamlMetadata('<root/>')).toThrowError(/INVALID_METADATA/)
  })

  it('3. lanza [INVALID_METADATA] cuando falta X509Certificate', () => {
    const broken = SAMPLE_METADATA.replace(
      /<ds:X509Certificate>[\s\S]*?<\/ds:X509Certificate>/,
      '',
    )
    expect(() => parseSamlMetadata(broken)).toThrowError(/INVALID_METADATA/)
  })

  it('4. tolera XML vacío con error tipado', () => {
    expect(() => parseSamlMetadata('')).toThrowError(/INVALID_METADATA/)
  })
})

describe('parseSamlResponse', () => {
  it('5. extrae NameID, Issuer, sessionIndex y atributos', () => {
    const xml = buildSamlResponse({
      issuer: 'https://idp.example.com/',
      nameId: 'user@example.com',
      email: 'user@example.com',
    })
    const parsed = parseSamlResponse(xml)
    expect(parsed.nameId).toBe('user@example.com')
    expect(parsed.issuer).toBe('https://idp.example.com/')
    expect(parsed.sessionIndex).toBe('sess_42')
    expect(
      parsed.attributes['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
    ).toBe('user@example.com')
  })

  it('6. captura múltiples valores en attributesMulti (groups)', () => {
    const xml = buildSamlResponse({
      issuer: 'https://idp.example.com/',
      nameId: 'u',
      email: 'u@e.com',
      attrs: {
        'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'u@e.com',
        groups: ['ADMINS', 'ENG', 'PMO'],
      },
    })
    const parsed = parseSamlResponse(xml)
    expect(parsed.attributesMulti.groups).toEqual(['ADMINS', 'ENG', 'PMO'])
    expect(parsed.attributes.groups).toBe('ADMINS')
  })

  it('7. lanza [EXPIRED_ASSERTION] cuando NotOnOrAfter ya pasó', () => {
    const xml = buildSamlResponse({
      issuer: 'i',
      nameId: 'u',
      email: 'u@e.com',
      notOnOrAfter: '2020-01-01T00:00:00Z',
    })
    expect(() => parseSamlResponse(xml)).toThrowError(/EXPIRED_ASSERTION/)
  })

  it('8. lanza [INVALID_RESPONSE] cuando falta NameID', () => {
    const xml = buildSamlResponse({
      issuer: 'i',
      nameId: 'u',
      email: 'u@e.com',
    }).replace(/<saml:NameID>[^<]*<\/saml:NameID>/, '')
    expect(() => parseSamlResponse(xml)).toThrowError(/INVALID_RESPONSE/)
  })
})

describe('verifyXmlSignature', () => {
  it('9. rechaza firmas RSA-SHA1 (algoritmo débil)', () => {
    const xml = buildSamlResponse({
      issuer: 'i',
      nameId: 'u',
      email: 'u@e.com',
      withSha1: true,
    })
    const ok = verifyXmlSignature({ xml, x509Cert: FAKE_CERT_BODY })
    expect(ok).toBe(false)
  })

  it('10. rechaza XML sin SignatureValue', () => {
    const xml = `<Response><Assertion><Signature><SignedInfo></SignedInfo></Signature></Assertion></Response>`
    const ok = verifyXmlSignature({ xml, x509Cert: FAKE_CERT_BODY })
    expect(ok).toBe(false)
  })

  it('11. rechaza cuando el cert es inválido/no parseable', () => {
    const xml = buildSamlResponse({
      issuer: 'i',
      nameId: 'u',
      email: 'u@e.com',
    })
    const ok = verifyXmlSignature({ xml, x509Cert: 'not-a-cert' })
    expect(ok).toBe(false)
  })
})

describe('buildAuthnRequest', () => {
  it('12. genera URL con SAMLRequest base64 y requestId UUID-ish', () => {
    const { requestId, url } = buildAuthnRequest({
      ssoUrl: 'https://idp.example.com/sso',
      spEntityId: 'https://app.test/sp',
      acsUrl: 'https://app.test/acs',
    })
    expect(requestId).toMatch(/^_[a-f0-9]{32}$/)
    const u = new URL(url)
    expect(u.origin + u.pathname).toBe('https://idp.example.com/sso')
    const samlRequest = u.searchParams.get('SAMLRequest')
    expect(samlRequest).toBeTruthy()
    const decoded = Buffer.from(samlRequest!, 'base64').toString('utf8')
    expect(decoded).toContain('samlp:AuthnRequest')
    expect(decoded).toContain(requestId)
    expect(decoded).toContain('AssertionConsumerServiceURL="https://app.test/acs"')
  })
})
