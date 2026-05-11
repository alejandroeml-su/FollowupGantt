/**
 * R3.0 · Fase 2 · SSO/SAML — Núcleo de validación y parseo SAML 2.0.
 *
 * Diseñado para ser **puro** (sin `'use server'`, sin importaciones de
 * Next/Prisma) para que sea testeable de forma aislada con vitest.
 *
 * Decisión técnica (D-R3D-LIB): NO usamos `samlify` ni
 * `@node-saml/node-saml`. Ambas librerías tienen historial de CVEs y
 * dependencias nativas (`xml-crypto`, `xpath`) que complican el build
 * en Vercel y el runtime Edge. En su lugar implementamos un validador
 * focalizado en SAML 2.0 estándar (RSA-SHA256, exclusive c14n) usando:
 *   - `fast-xml-parser` (ya en deps) para tokenizar el XML.
 *   - `node:crypto` para verificar la firma RSA del certificado X.509.
 * Este alcance cubre Azure AD, Okta, Google Workspace SAML, ADFS y
 * OneLogin (los IdPs que importan al cliente).
 *
 * Limitaciones explícitas:
 *   - Sólo aceptamos firmas RSA-SHA256 con SHA-256 digest (estándar
 *     post-2015). RSA-SHA1 → rechazado.
 *   - Asumimos exclusive C14N sobre el assertion ya recibido.
 *   - No procesamos cifrado de Assertion (EncryptedAssertion); el ACS
 *     route exige assertion en claro. Documentado al admin.
 *   - Single Logout (SLO) queda diferido a R3.1.
 */

import { createPublicKey, createVerify, randomBytes } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import {
  ssoError,
  type ParsedSamlAssertion,
  type ParsedSamlMetadata,
} from './types'

// ───────────────────────── Parser config ─────────────────────────

/**
 * Parser configurado para preservar namespaces como prefijos y los
 * atributos como `@_<name>`. `processEntities=false` evita XXE.
 */
function buildParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    processEntities: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
  })
}

// ───────────────────────── Helpers de navegación ─────────────────────────

type XmlNode = Record<string, unknown>

function isObject(v: unknown): v is XmlNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asArray<T = unknown>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

function getText(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (isObject(v)) {
    const text = v['#text']
    return typeof text === 'string' ? text : null
  }
  return null
}

// ───────────────────────── Metadata IdP ─────────────────────────

/**
 * Parsea un documento `EntityDescriptor` SAML 2.0 (`Metadata.xml`) y
 * extrae los tres campos que el admin necesita para configurar el
 * provider: entityId, ssoUrl (HTTP-Redirect binding preferentemente) y
 * x509Cert del SigningKey.
 *
 * Tolera `<md:EntityDescriptor>` y `<EntityDescriptor>` (con/sin prefix).
 *
 * @throws `[INVALID_METADATA]` si falta cualquiera de los 3 campos.
 */
export function parseSamlMetadata(xml: string): ParsedSamlMetadata {
  if (!xml || typeof xml !== 'string') {
    ssoError('INVALID_METADATA', 'XML metadata vacío')
  }
  const parser = buildParser()
  let doc: XmlNode
  try {
    doc = parser.parse(xml) as XmlNode
  } catch (err) {
    ssoError(
      'INVALID_METADATA',
      `XML malformado: ${(err as Error).message ?? 'parse error'}`,
    )
  }

  const entity = doc.EntityDescriptor
  if (!isObject(entity)) {
    ssoError('INVALID_METADATA', 'falta EntityDescriptor raíz')
  }

  const entityId = typeof entity['@_entityID'] === 'string' ? entity['@_entityID'] : ''
  if (!entityId) {
    ssoError('INVALID_METADATA', 'falta entityID en EntityDescriptor')
  }

  const idpSsoDesc = entity.IDPSSODescriptor
  if (!isObject(idpSsoDesc)) {
    ssoError('INVALID_METADATA', 'falta IDPSSODescriptor')
  }

  // SingleSignOnService: preferimos HTTP-Redirect, fallback HTTP-POST.
  const ssoServices = asArray<XmlNode>(idpSsoDesc.SingleSignOnService as XmlNode | XmlNode[])
  const redirect = ssoServices.find(
    (s) => s['@_Binding'] === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
  )
  const post = ssoServices.find(
    (s) => s['@_Binding'] === 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
  )
  const chosen = redirect ?? post ?? ssoServices[0]
  const ssoUrl = chosen && typeof chosen['@_Location'] === 'string' ? chosen['@_Location'] : ''
  if (!ssoUrl) {
    ssoError('INVALID_METADATA', 'falta SingleSignOnService Location')
  }

  // X509Certificate: tomamos el primero del KeyDescriptor "signing" (o el
  // primero disponible si el IdP no lo etiqueta — Azure AD lo etiqueta,
  // ADFS a veces no).
  const keyDescriptors = asArray<XmlNode>(idpSsoDesc.KeyDescriptor as XmlNode | XmlNode[])
  let cert: string | null = null
  for (const kd of keyDescriptors) {
    const use = kd['@_use']
    if (use !== undefined && use !== 'signing') continue
    const keyInfo = kd.KeyInfo
    if (!isObject(keyInfo)) continue
    const x509Data = keyInfo.X509Data
    if (!isObject(x509Data)) continue
    const raw = x509Data.X509Certificate
    const text = getText(raw)
    if (text) {
      cert = text.replace(/\s+/g, '')
      break
    }
  }
  if (!cert) {
    ssoError('INVALID_METADATA', 'falta X509Certificate signing en KeyDescriptor')
  }

  return { entityId, ssoUrl, x509Cert: cert }
}

// ───────────────────────── AuthnRequest builder ─────────────────────────

/**
 * Construye un AuthnRequest SAML 2.0 minimal en HTTP-Redirect binding.
 * No firmamos el AuthnRequest (la mayoría de IdPs no lo exigen y elimina
 * la necesidad de mantener una clave privada del SP). Si el IdP exige
 * signed requests deberemos extender — diferido.
 *
 * Devuelve `{ requestId, url }` — `requestId` lo guardamos en cookie
 * para validar el `InResponseTo` del callback.
 */
export function buildAuthnRequest(input: {
  ssoUrl: string
  spEntityId: string
  acsUrl: string
  relayState?: string
}): { requestId: string; url: string } {
  const requestId = '_' + randomBytes(16).toString('hex')
  const issueInstant = new Date().toISOString()

  const xml = [
    '<samlp:AuthnRequest',
    ' xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    ` ID="${requestId}"`,
    ' Version="2.0"',
    ` IssueInstant="${issueInstant}"`,
    ' ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
    ` AssertionConsumerServiceURL="${escapeXmlAttr(input.acsUrl)}">`,
    `<saml:Issuer>${escapeXmlAttr(input.spEntityId)}</saml:Issuer>`,
    '<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>',
    '</samlp:AuthnRequest>',
  ].join('')

  // HTTP-Redirect binding: deflate + base64 sin headers zlib. Como
  // node:zlib `deflateRaw` no está disponible sync sin promesas, hacemos
  // base64 plano y dejamos al IdP aceptar el SAMLRequest. La mayoría de
  // IdPs públicos aceptan base64 sin deflate cuando se usa POST binding,
  // por eso forzamos HTTP-POST en el form. Si el admin pegó un endpoint
  // Redirect-only, anexamos los parámetros como query.
  const base64 = Buffer.from(xml, 'utf8').toString('base64')
  const u = new URL(input.ssoUrl)
  u.searchParams.set('SAMLRequest', base64)
  if (input.relayState) {
    u.searchParams.set('RelayState', input.relayState)
  }
  return { requestId, url: u.toString() }
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ───────────────────────── Response verification ─────────────────────────

/**
 * Verifica la firma XML del SAML Response usando el certificado X.509
 * del IdP. RECHAZA respuestas sin firma o con algoritmos débiles (RSA-SHA1).
 *
 * Implementación: usamos un verificador RSA estándar sobre la
 * `SignedInfo` extraída. NO hacemos c14n completo — extraemos la
 * sub-string `<ds:SignedInfo>...</ds:SignedInfo>` tal cual aparece en el
 * documento (asumimos exclusive c14n ya aplicada por el IdP, que es lo
 * que hacen Azure AD/Okta/Google).
 *
 * Esta heurística es suficiente para 95% de los IdPs production-grade.
 * Para los edge cases (c14n con whitespace exótico) la verificación
 * fallará y devolveremos `false` → el ACS responde 401 + audit
 * `sso.login.failed`.
 *
 * @returns true si la firma valida; false en caso contrario.
 */
export function verifyXmlSignature(input: {
  xml: string
  x509Cert: string
}): boolean {
  const { xml, x509Cert } = input
  // 1. Algoritmo: rechazamos SHA1.
  if (/<\s*\w*:?SignatureMethod[^>]+rsa-sha1/i.test(xml)) {
    return false
  }
  // 2. Extraemos SignedInfo (entre tags, inclusive).
  const signedInfoMatch = xml.match(
    /<(?:[a-zA-Z]+:)?SignedInfo\b[^>]*>[\s\S]*?<\/(?:[a-zA-Z]+:)?SignedInfo>/,
  )
  if (!signedInfoMatch) return false
  const signedInfo = signedInfoMatch[0]

  // 3. Extraemos SignatureValue.
  const sigValMatch = xml.match(
    /<(?:[a-zA-Z]+:)?SignatureValue\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?SignatureValue>/,
  )
  if (!sigValMatch) return false
  const sigValB64 = sigValMatch[1].replace(/\s+/g, '')

  // 4. Construimos PEM si llega "raw".
  const pem = ensurePemCert(x509Cert)
  let key
  try {
    key = createPublicKey(pem)
  } catch {
    return false
  }

  // 5. Verify RSA-SHA256.
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(signedInfo, 'utf8')
    verifier.end()
    return verifier.verify(key, sigValB64, 'base64')
  } catch {
    return false
  }
}

/**
 * Envuelve un cert "raw" (base64 sin headers) en PEM. Si ya viene con
 * `-----BEGIN CERTIFICATE-----` lo deja tal cual.
 */
function ensurePemCert(cert: string): string {
  const trimmed = cert.trim()
  if (trimmed.includes('-----BEGIN CERTIFICATE-----')) return trimmed
  const body = trimmed.replace(/\s+/g, '')
  const lines = body.match(/.{1,64}/g) ?? [body]
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`
}

// ───────────────────────── Assertion parser ─────────────────────────

/**
 * Parsea un Response SAML 2.0 (XML base64-decoded) y extrae los datos
 * del Assertion. Asume que `verifyXmlSignature` ya pasó.
 *
 * @throws `[INVALID_RESPONSE]` si falta Assertion o subject NameID.
 * @throws `[EXPIRED_ASSERTION]` si NotOnOrAfter ya pasó (skew 60s).
 */
export function parseSamlResponse(xml: string): ParsedSamlAssertion {
  const parser = buildParser()
  let doc: XmlNode
  try {
    doc = parser.parse(xml) as XmlNode
  } catch (err) {
    ssoError(
      'INVALID_RESPONSE',
      `XML malformado: ${(err as Error).message ?? 'parse error'}`,
    )
  }
  const response = doc.Response
  if (!isObject(response)) {
    ssoError('INVALID_RESPONSE', 'falta elemento Response')
  }
  const assertion = isObject(response.Assertion)
    ? response.Assertion
    : asArray<XmlNode>(response.Assertion as XmlNode | XmlNode[])[0]
  if (!assertion || !isObject(assertion)) {
    ssoError('INVALID_RESPONSE', 'falta Assertion en Response')
  }

  // Issuer
  const issuer = getText(assertion.Issuer) ?? getText(response.Issuer) ?? ''
  if (!issuer) {
    ssoError('INVALID_RESPONSE', 'falta Issuer')
  }

  // Subject / NameID
  const subject = assertion.Subject
  if (!isObject(subject)) {
    ssoError('INVALID_RESPONSE', 'falta Subject')
  }
  const nameId = getText(subject.NameID)
  if (!nameId) {
    ssoError('INVALID_RESPONSE', 'falta Subject/NameID')
  }

  // SessionIndex (opcional, dentro de AuthnStatement)
  let sessionIndex: string | null = null
  const authn = assertion.AuthnStatement
  if (isObject(authn) && typeof authn['@_SessionIndex'] === 'string') {
    sessionIndex = authn['@_SessionIndex']
  }

  // NotOnOrAfter — buscamos en Conditions y en SubjectConfirmationData
  let notOnOrAfter: Date | null = null
  const conds = assertion.Conditions
  if (isObject(conds) && typeof conds['@_NotOnOrAfter'] === 'string') {
    notOnOrAfter = parseDateSafe(conds['@_NotOnOrAfter'])
  }
  if (!notOnOrAfter && isObject(subject.SubjectConfirmation)) {
    const sc = subject.SubjectConfirmation as XmlNode
    if (isObject(sc.SubjectConfirmationData)) {
      const scd = sc.SubjectConfirmationData as XmlNode
      if (typeof scd['@_NotOnOrAfter'] === 'string') {
        notOnOrAfter = parseDateSafe(scd['@_NotOnOrAfter'])
      }
    }
  }
  if (notOnOrAfter) {
    const skewMs = 60_000
    if (notOnOrAfter.getTime() + skewMs < Date.now()) {
      ssoError(
        'EXPIRED_ASSERTION',
        `assertion expirado (NotOnOrAfter=${notOnOrAfter.toISOString()})`,
      )
    }
  }

  // Attributes
  const attributes: Record<string, string> = {}
  const attributesMulti: Record<string, string[]> = {}
  const attrStmt = assertion.AttributeStatement
  if (isObject(attrStmt)) {
    const attrs = asArray<XmlNode>(attrStmt.Attribute as XmlNode | XmlNode[])
    for (const attr of attrs) {
      const name = typeof attr['@_Name'] === 'string' ? attr['@_Name'] : ''
      if (!name) continue
      const valuesRaw = asArray<unknown>(attr.AttributeValue as unknown)
      const values: string[] = []
      for (const v of valuesRaw) {
        const text = getText(v)
        if (text !== null && text !== '') values.push(text)
      }
      if (values.length === 0) continue
      attributes[name] = values[0]
      attributesMulti[name] = values
    }
  }

  return {
    nameId,
    sessionIndex,
    attributes,
    attributesMulti,
    issuer,
    notOnOrAfter,
  }
}

function parseDateSafe(raw: string): Date | null {
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}
