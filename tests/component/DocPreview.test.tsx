import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * Ola P2 · Equipo P2-5 — Tests de `DocPreview`.
 *
 * El render markdown corre en `renderMarkdown` (lib/markdown.ts). Los tests
 * cubren los marcadores principales y el escapado XSS para que cualquier
 * regresión en la regex se detecte temprano.
 */

import { DocPreview } from '@/components/docs/DocPreview'

describe('DocPreview', () => {
  it('muestra hint de vacío cuando no hay contenido', () => {
    render(<DocPreview content="" />)
    expect(screen.getByTestId('doc-preview-empty')).toBeInTheDocument()
  })

  it('renderiza headers, bold, italic y code inline', () => {
    const md = '# Título\n\nUn **strong**, un *em* y `code`.'
    const { container } = render(<DocPreview content={md} />)
    const root = container.querySelector('[data-testid="doc-preview"]')!
    expect(root.querySelector('h1')?.textContent).toBe('Título')
    expect(root.querySelector('strong')?.textContent).toBe('strong')
    expect(root.querySelector('em')?.textContent).toBe('em')
    expect(root.querySelector('code')?.textContent).toBe('code')
  })

  it('renderiza listas (- y 1.) y links', () => {
    const md = '- uno\n- dos\n\n1. primero\n2. segundo\n\n[Avante](https://example.com)'
    const { container } = render(<DocPreview content={md} />)
    const root = container.querySelector('[data-testid="doc-preview"]')!
    expect(root.querySelectorAll('ul li')).toHaveLength(2)
    expect(root.querySelectorAll('ol li')).toHaveLength(2)
    const link = root.querySelector('a')!
    expect(link.getAttribute('href')).toBe('https://example.com')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('renderiza code blocks ``` … ``` como <pre><code>', () => {
    const md = '```\nconst x = 1\n```'
    const { container } = render(<DocPreview content={md} />)
    const pre = container.querySelector('pre code')
    expect(pre?.textContent).toMatch(/const x = 1/)
  })

  it('escapa HTML maligno (XSS) — el script no se ejecuta', () => {
    const md = 'Antes <script>alert("xss")</script> después'
    const { container } = render(<DocPreview content={md} />)
    expect(container.querySelector('script')).toBeNull()
    // El texto literal se ve en el DOM (escapado a entidades)
    expect(container.textContent).toMatch(/<script>alert\("xss"\)<\/script>/)
  })

  it('bloquea el pseudo-protocolo javascript: en links', () => {
    const md = '[hack](javascript:alert(1))'
    const { container } = render(<DocPreview content={md} />)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).not.toMatch(/^javascript:/i)
  })
})
