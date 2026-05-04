/**
 * Ola P2 · Equipo P2-5 — Renderer markdown ligero (regex-based).
 *
 * Sin dependencias externas (`marked`, `remark`, etc.). Cubre el subset
 * funcional del editor de docs:
 *   - Headers (#, ##, ### hasta ######)
 *   - Bold (**texto**)
 *   - Italic (*texto* o _texto_)
 *   - Code inline (`texto`)
 *   - Code blocks (``` … ```)
 *   - Lists ordenadas (1., 2., …) y desordenadas (-, *)
 *   - Links [texto](url)
 *   - Párrafos separados por línea en blanco
 *
 * Decisiones:
 *   D-MD-1: Escapamos HTML primero (XSS prevention) ANTES de parsear los
 *           marcadores. Esto significa que el usuario no puede escribir
 *           HTML embebido (intencional — markdown puro es más seguro).
 *   D-MD-2: No soportamos imágenes ni tablas en MVP — están fuera del
 *           alcance funcional de la HU y simplifican el render.
 *   D-MD-3: Code blocks se procesan PRIMERO (antes que cualquier otro
 *           marcador) para que su contenido no sea reinterpretado.
 *           Reservados con sentinelas únicos `CB{N}` que el
 *           usuario no puede tipear desde un teclado normal.
 *   D-MD-4: La función es pura y deterministic ⇒ unit-testeable sin
 *           jsdom.
 *
 * Uso:
 *   const html = renderMarkdown(doc.content)
 *   <div dangerouslySetInnerHTML={{ __html: html }} />
 *
 * Seguridad: el HTML producido NUNCA contiene atributos del usuario sin
 * escapar (las URLs de links pasan por `escapeAttr`, que también bloquea
 * el pseudo-protocolo `javascript:`). Es seguro inyectarlo con
 * `dangerouslySetInnerHTML`.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c)
}

function escapeAttr(s: string): string {
  // Para atributos de URL: escape HTML + reject javascript: pseudo-protocol.
  const trimmed = s.trim()
  if (/^\s*javascript:/i.test(trimmed)) return '#'
  return escapeHtml(trimmed)
}

// Sentinelas únicos para placeholders. Usamos caracteres de control que el
// usuario no puede generar desde un teclado normal — colisiones imposibles.
const SENTINEL_CB_OPEN = 'CB' // code block
const SENTINEL_END = ''
const SENTINEL_IC_OPEN = 'IC' // inline code
const SENTINEL_IC_END = ''

/**
 * Aplica los marcadores inline (bold, italic, code, link) a un fragmento
 * de texto YA escapado a HTML.
 */
function applyInline(text: string): string {
  let out = text
  // Code inline `…` PRIMERO (su contenido no se reinterpretera).
  const codeStash: string[] = []
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codeStash.push(code)
    return `${SENTINEL_IC_OPEN}${codeStash.length - 1}${SENTINEL_IC_END}`
  })
  // Links [text](url)
  out = out.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`,
  )
  // Bold **…** (no greedy)
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  // Italic *…* o _…_  (boundary check para no romper bold residual)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
  // Restaurar code inline
  out = out.replace(
    new RegExp(`${SENTINEL_IC_OPEN}(\\d+)${SENTINEL_IC_END}`, 'g'),
    (_m, idx: string) => {
      const code = codeStash[Number(idx)] ?? ''
      return `<code>${code}</code>`
    },
  )
  return out
}

/**
 * Renderiza markdown crudo a HTML. Pura, idempotente, sin side-effects.
 */
export function renderMarkdown(input: string): string {
  if (!input) return ''

  // 1. Aislar code blocks ``` … ``` ANTES de cualquier otra cosa.
  const codeBlocks: string[] = []
  let pre = input.replace(
    /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g,
    (_m, _lang, body: string) => {
      codeBlocks.push(escapeHtml(body))
      return `${SENTINEL_CB_OPEN}${codeBlocks.length - 1}${SENTINEL_END}`
    },
  )

  // 2. Escapar HTML en TODO el resto.
  pre = escapeHtml(pre)
  // El escape de HTML transformó `` y `` ¿NO?: sólo escapa
  // <, >, ", ', &. Los chars de control quedan tal cual. ✓

  // 3. Procesar bloque por bloque (parágrafos separados por línea en
  //    blanco).
  const blocks = pre.split(/\n{2,}/)
  const rendered = blocks.map((block) => renderBlock(block))
  let html = rendered.join('\n')

  // 4. Re-inyectar code blocks como <pre><code>.
  html = html.replace(
    new RegExp(`${SENTINEL_CB_OPEN}(\\d+)${SENTINEL_END}`, 'g'),
    (_m, idx: string) => {
      const code = codeBlocks[Number(idx)] ?? ''
      return `<pre><code>${code}</code></pre>`
    },
  )

  return html
}

/**
 * Procesa un bloque (puede ser header, lista, párrafo). El input está
 * ya escapado a HTML.
 */
function renderBlock(block: string): string {
  const trimmed = block.trim()
  if (!trimmed) return ''

  // Code block placeholder solo (un block que sólo contiene el sentinela
  // se devuelve verbatim para que el outer pass lo reemplace).
  if (
    new RegExp(`^${SENTINEL_CB_OPEN}\\d+${SENTINEL_END}$`).test(trimmed)
  ) {
    return trimmed
  }

  const lines = block.split('\n').map((l) => l.trimEnd())

  // Header (#, ##, … ######) — sólo si la línea entera empieza con #.
  const firstLine = lines[0] ?? ''
  const headerMatch = /^(#{1,6})\s+(.+)$/.exec(firstLine)
  if (headerMatch && lines.length === 1) {
    const level = headerMatch[1].length
    const text = applyInline(headerMatch[2])
    return `<h${level}>${text}</h${level}>`
  }

  // Lista desordenada (- ó *)
  if (lines.every((l) => /^\s*[-*]\s+/.test(l) || l.length === 0)) {
    const items = lines
      .filter((l) => l.length > 0)
      .map((l) => l.replace(/^\s*[-*]\s+/, ''))
      .map((l) => `<li>${applyInline(l)}</li>`)
      .join('')
    return `<ul>${items}</ul>`
  }

  // Lista ordenada (1. 2. …)
  if (lines.every((l) => /^\s*\d+\.\s+/.test(l) || l.length === 0)) {
    const items = lines
      .filter((l) => l.length > 0)
      .map((l) => l.replace(/^\s*\d+\.\s+/, ''))
      .map((l) => `<li>${applyInline(l)}</li>`)
      .join('')
    return `<ol>${items}</ol>`
  }

  // Párrafo normal — preserva saltos de línea como <br>.
  const inline = applyInline(lines.join('<br>'))
  return `<p>${inline}</p>`
}
