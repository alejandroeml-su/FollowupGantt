/**
 * R4 · US-7.4 · Email ClickApp — Parser de correos entrantes.
 *
 * Lo que hace (sin dependencias externas — Edwin pidió no instalar
 * sanitize-html, usamos regex defensiva):
 *
 *   1. `extractMnemonicFromSubject(subject)` — busca el patrón `[#PROJ-123]`
 *      o `[PROJ-123]` (sin `#`) y devuelve el mnemonic normalizado. Si
 *      no encuentra patrón → null (entonces el email crea task nueva).
 *
 *   2. `stripHtml(html)` — sanitiza un HTML body a texto plano para
 *      persistir en `bodyText`. Mantenemos el HTML original en
 *      `bodyHtml` para auditoría. Estrategia conservadora:
 *        - Quita <script>, <style>, <iframe> con su contenido.
 *        - Sustituye <br>, <p>, </p> por saltos de línea.
 *        - Elimina cualquier otra tag.
 *        - Decodifica entidades básicas (&amp;, &lt;, &gt;, &quot;, &#39;, &nbsp;).
 *
 *   3. `parseFromAddress(raw)` — separa `"Edwin Martinez" <ed@x.com>`
 *      en `{ name, email }`. Tolera formatos sólo-email.
 *
 *   4. `normalizeSendgridPayload(form)` — toma el FormData multipart que
 *      envía SendGrid Inbound Parse y devuelve un `ParsedInboundEmail`
 *      con los campos relevantes. Los attachments quedan como
 *      `File[]` para que el caller los suba a Supabase Storage.
 *
 * Diseño intencional: este módulo NO escribe a BD ni a Storage — sólo
 * normaliza. La acción `processInboundEmail` (en
 * `src/lib/actions/inbound-email.ts`) orquesta el side-effect.
 */

export type ParsedFromAddress = {
  email: string
  name: string | null
}

export type ParsedInboundEmail = {
  /** Alias completo al que llegó el correo (ej. `inbox+myproj@sync.complejoavante.com`). */
  toAlias: string
  /** Slug local-part después del `+` (ej. `myproj`). NULL si no usa formato `+alias`. */
  toSlug: string | null
  from: ParsedFromAddress
  subject: string
  /** Mnemonic detectado en subject (ej. `PROJ-123`) o NULL para crear task. */
  mnemonic: string | null
  /** Subject sin el bloque `[#MNEMONIC]` (para usar como title cuando crea task). */
  cleanSubject: string
  bodyText: string
  bodyHtml: string | null
  spamScore: number | null
  /** Headers crudos en formato `Name: value\nName: value`. */
  rawHeaders: string | null
  /** Attachments del email (SendGrid envía `attachment1`, `attachment2`, ...). */
  attachments: File[]
}

// ───────────────────────── Subject mnemonic ─────────────────────────

/**
 * Match patterns soportados en subject:
 *   `[#PROJ-123]`  ← preferido (documentado al usuario)
 *   `[PROJ-123]`   ← tolerado por costumbre
 *
 * El mnemonic en sí cumple `<PREFIX>-<NUMBER>` donde PREFIX es A-Z (2-6
 * letras) y NUMBER son dígitos. Si llega `[#abc-xyz]` (caso lowercase
 * accidental), el caller lo verá normalizado a mayúsculas — Prisma
 * `findUnique({ mnemonic })` es case-sensitive así que igual fallará si
 * el mnemonic real estaba en mayúsculas; aceptamos esa limitación.
 */
const MNEMONIC_RE = /\[#?([A-Za-z]{2,6}-\d+)\]/

export function extractMnemonicFromSubject(subject: string): {
  mnemonic: string | null
  cleanSubject: string
} {
  if (!subject) return { mnemonic: null, cleanSubject: '' }
  const m = subject.match(MNEMONIC_RE)
  if (!m) return { mnemonic: null, cleanSubject: subject.trim() }
  const mnemonic = m[1].toUpperCase()
  // Strip cualquier "Re:" / "Fwd:" residual + el bloque [#X-1] y normaliza.
  const cleanSubject = subject
    .replace(MNEMONIC_RE, '')
    .replace(/^\s*(re|fwd|fw)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { mnemonic, cleanSubject }
}

// ───────────────────────── HTML stripper ─────────────────────────

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

/**
 * Convierte HTML → texto plano. Defensa primaria: elimina <script>,
 * <style>, <iframe>, <object>, <embed> CON su contenido (no sólo las
 * tags abridoras) para neutralizar XSS si el body se renderiza luego.
 *
 * No reemplaza `sanitize-html` para HTML que SÍ queremos preservar;
 * para eso conservamos `bodyHtml` crudo y lo mostramos sólo en sandboxed
 * iframe / Markdown render conservador en la UI futura.
 */
export function stripHtml(html: string): string {
  if (!html) return ''
  return html
    // 1. Bloques peligrosos completos.
    .replace(/<(script|style|iframe|object|embed|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // 2. Comentarios HTML.
    .replace(/<!--[\s\S]*?-->/g, '')
    // 3. Saltos de línea semánticos antes de eliminar tags.
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    // 4. Resto de tags.
    .replace(/<[^>]+>/g, '')
    // 5. Entidades básicas.
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m)
    // 6. Decodifica entidades numéricas comunes (&#123;).
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n)
      return Number.isFinite(code) && code >= 32 && code < 0x10ffff
        ? String.fromCodePoint(code)
        : ''
    })
    // 7. Trim de líneas múltiples + bordes.
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ───────────────────────── From parsing ─────────────────────────

/**
 * Acepta cualquiera de:
 *   `Edwin Martinez <ed@example.com>`
 *   `"Edwin Martinez" <ed@example.com>`
 *   `ed@example.com`
 */
export function parseFromAddress(raw: string | null | undefined): ParsedFromAddress {
  if (!raw) return { email: '', name: null }
  const trimmed = raw.trim()
  // Formato `Nombre <email>` o `"Nombre" <email>`.
  const angleMatch = trimmed.match(/^\s*"?([^"<]+?)"?\s*<\s*([^>]+)\s*>\s*$/)
  if (angleMatch) {
    return {
      name: angleMatch[1].trim() || null,
      email: angleMatch[2].trim().toLowerCase(),
    }
  }
  // Sólo email.
  return { email: trimmed.toLowerCase(), name: null }
}

// ───────────────────────── To alias parsing ─────────────────────────

/**
 * Dado `inbox+myproj@sync.complejoavante.com` devuelve `myproj`.
 * Si no hay `+`, devuelve null (alias plano sin subaddressing).
 */
export function extractSlugFromAlias(alias: string): string | null {
  if (!alias) return null
  const lower = alias.trim().toLowerCase()
  const at = lower.indexOf('@')
  if (at < 0) return null
  const local = lower.slice(0, at)
  const plus = local.indexOf('+')
  if (plus < 0) return null
  const slug = local.slice(plus + 1)
  return slug || null
}

// ───────────────────────── SendGrid normalizer ─────────────────────────

/**
 * SendGrid Inbound Parse envía un `multipart/form-data` con campos:
 *   - `to`, `from`, `subject`
 *   - `text` (plain text del body, ya extraído por SG)
 *   - `html` (HTML body, opcional)
 *   - `headers` (raw headers como string)
 *   - `spam_score` (string numérico)
 *   - `attachments` (count, string numérico)
 *   - `attachment1`, `attachment2`, ... (Blob/File entries)
 *
 * Limitación conocida: SendGrid puede enviar múltiples destinatarios en
 * `to` separados por coma. Tomamos el primero que coincide con nuestro
 * dominio `INBOUND_EMAIL_DOMAIN`; si ninguno coincide, devolvemos el
 * primero crudo (el caller fallará la búsqueda por alias y persistirá
 * en `status=FAILED`).
 */
export function normalizeSendgridPayload(
  form: FormData,
  inboundDomain: string,
): ParsedInboundEmail {
  const toRaw = (form.get('to') as string | null) ?? ''
  const fromRaw = (form.get('from') as string | null) ?? ''
  const subjectRaw = (form.get('subject') as string | null) ?? ''
  const text = (form.get('text') as string | null) ?? ''
  const html = (form.get('html') as string | null) ?? ''
  const headers = (form.get('headers') as string | null) ?? null
  const spamRaw = (form.get('spam_score') as string | null) ?? null

  // SendGrid devuelve "to" potencialmente como "a@x.com, b@y.com" cuando
  // el correo fue mandado a varias cuentas. Escogemos la que termina en
  // nuestro dominio para localizar el alias del proyecto.
  const toCandidates = toRaw.split(',').map((s) => s.trim()).filter(Boolean)
  const toAlias =
    toCandidates.find((c) =>
      c.toLowerCase().endsWith(`@${inboundDomain.toLowerCase()}`),
    ) ??
    toCandidates[0] ??
    ''
  const toSlug = extractSlugFromAlias(toAlias)

  const from = parseFromAddress(fromRaw)
  const { mnemonic, cleanSubject } = extractMnemonicFromSubject(subjectRaw)

  // Si SendGrid ya envió `text`, usamos eso (más fiel). Si sólo hay HTML,
  // lo stripeamos. Si vienen ambos, preferimos `text` (es lo que el
  // remitente realmente escribió).
  const bodyText = text.trim() || stripHtml(html)
  const bodyHtml = html.trim() || null

  // Attachments — recolecta cualquier entry cuyo valor sea Blob/File.
  const attachments: File[] = []
  // FormData no expone Symbol.iterator en todos los runtimes Node viejos
  // pero Next 16 / Node 22 sí. Usamos `forEach` por compatibilidad.
  form.forEach((value, key) => {
    if (!key.toLowerCase().startsWith('attachment')) return
    if (value instanceof File) attachments.push(value)
  })

  const spamScore = spamRaw !== null && spamRaw !== '' ? Number(spamRaw) : null

  return {
    toAlias,
    toSlug,
    from,
    subject: subjectRaw.trim(),
    mnemonic,
    cleanSubject: cleanSubject || subjectRaw.trim() || '(sin asunto)',
    bodyText,
    bodyHtml,
    spamScore: Number.isFinite(spamScore as number) ? (spamScore as number) : null,
    rawHeaders: headers,
    attachments,
  }
}
