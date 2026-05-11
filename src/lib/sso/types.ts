/**
 * R3.0 · Fase 2 · SSO/SAML — Tipos compartidos.
 *
 * Mantenidos en un archivo puro (sin `'use server'`) para que sean
 * importables tanto desde server actions como desde tests vitest y
 * route handlers Edge sin violar la pureza del módulo de acciones.
 */

import type { WorkspaceRole } from '@prisma/client'

// ───────────────────────── Attribute mapping ─────────────────────────

/**
 * Shape del JSON persistido en `SsoProvider.attributeMap`. Define cómo
 * traducir los atributos que el IdP entrega en el Assertion SAML a los
 * campos internos de Sync.
 *
 * - `email`:  nombre del atributo SAML que contiene el email (obligatorio).
 *             Comunmente uno de:
 *               - `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`
 *               - `email`
 *               - `mail`
 *               - `EmailAddress`
 * - `name`:   nombre del atributo SAML con el display name (opcional).
 *             Si falta, se deriva del email.
 * - `groups`: nombre del atributo SAML que entrega los grupos a los que
 *             el usuario pertenece (opcional). Si presente, se mapea via
 *             `roleMap` a `WorkspaceRole`.
 * - `roleMap`: tabla de equivalencia `<grupo IdP> → WorkspaceRole`.
 *             Procesada en orden de prioridad: OWNER > ADMIN > MEMBER.
 *             Si el usuario pertenece a varios grupos mapeados,
 *             gana el de mayor privilegio. Sin matches → MEMBER.
 */
export interface SsoAttributeMap {
  email: string
  name?: string
  groups?: string
  roleMap?: Record<string, WorkspaceRole>
}

// ───────────────────────── Errores tipados ─────────────────────────

export type SsoErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INVALID_METADATA'
  | 'INVALID_RESPONSE'
  | 'INVALID_SIGNATURE'
  | 'MISSING_SIGNATURE'
  | 'MISSING_EMAIL'
  | 'PROVIDER_DISABLED'
  | 'EXPIRED_ASSERTION'

export function ssoError(code: SsoErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Resultados de parseo ─────────────────────────

/**
 * Metadata parseada del XML que el IdP expone (típicamente accesible vía
 * `https://login.microsoftonline.com/<tenant>/federationmetadata/...`).
 * El admin lo pega en el form y obtenemos los 3 campos clave para crear
 * el provider sin tipear manualmente.
 */
export interface ParsedSamlMetadata {
  entityId: string
  ssoUrl: string
  x509Cert: string
}

/**
 * Resultado de validar y parsear un Assertion SAML 2.0 entrante.
 * `attributes` es el bag plano de atributos (clave → primer valor) tal
 * cual los entregó el IdP — el mapeo a campos Sync ocurre en
 * `mapAssertionToUserProfile()`.
 */
export interface ParsedSamlAssertion {
  /** NameID del subject (lo que persistimos en SsoUserLink.externalId). */
  nameId: string
  /** SessionIndex opcional (para SLO en futuras iteraciones). */
  sessionIndex: string | null
  /** Bag de atributos: nombre → primer valor encontrado. */
  attributes: Record<string, string>
  /**
   * Bag completo de valores múltiples (ej. groups suele ser N strings).
   * Mismo nombre clave que `attributes`. Garantiza al menos 1 elemento.
   */
  attributesMulti: Record<string, string[]>
  /** Issuer del Assertion — debe coincidir con SsoProvider.entityId. */
  issuer: string
  /** NotOnOrAfter del SubjectConfirmationData / Conditions. */
  notOnOrAfter: Date | null
}

/**
 * Perfil derivado tras aplicar `attributeMap` al assertion. Es el shape
 * que `createOrLinkUser()` recibe para crear/enlazar `User` y
 * `SsoUserLink` y luego ejecutar `createSessionWithMetadata()`.
 */
export interface MappedSsoProfile {
  externalId: string
  email: string
  name: string
  /** Rol derivado del attribute `groups` + `roleMap`. NULL si no aplica. */
  workspaceRole: WorkspaceRole | null
}
