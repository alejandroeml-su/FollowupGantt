'use client'

/**
 * Ola P2 · Equipo P2-5 — Render markdown del doc.
 *
 * Componente puro: recibe markdown crudo y lo renderiza como HTML usando
 * `renderMarkdown` (regex propia, sin deps externas).
 *
 * Las clases tailwind del wrapper imitan el aspecto del placeholder previo
 * (prose-invert) sin requerir el plugin `@tailwindcss/typography`.
 */

import { useMemo } from 'react'
import { renderMarkdown } from '@/lib/markdown'

type Props = {
  content: string
  /** Texto a mostrar cuando el doc está vacío. */
  emptyHint?: string
  className?: string
}

export function DocPreview({ content, emptyHint, className }: Props) {
  const html = useMemo(() => renderMarkdown(content), [content])

  if (!content.trim()) {
    return (
      <div
        className="rounded border border-dashed border-border bg-card/30 px-4 py-6 text-center text-xs text-muted-foreground"
        data-testid="doc-preview-empty"
      >
        {emptyHint ?? 'Vista previa vacía. Escribe contenido en el editor.'}
      </div>
    )
  }

  return (
    <div
      data-testid="doc-preview"
      className={
        'doc-preview text-sm leading-relaxed text-foreground/90 ' +
        '[&>h1]:mt-4 [&>h1]:mb-3 [&>h1]:text-3xl [&>h1]:font-bold [&>h1]:text-foreground ' +
        '[&>h2]:mt-4 [&>h2]:mb-2 [&>h2]:text-2xl [&>h2]:font-semibold [&>h2]:text-foreground ' +
        '[&>h3]:mt-3 [&>h3]:mb-2 [&>h3]:text-xl [&>h3]:font-semibold [&>h3]:text-foreground ' +
        '[&>p]:my-2 ' +
        '[&>ul]:my-2 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:my-2 [&>ol]:list-decimal [&>ol]:pl-5 ' +
        '[&_li]:my-0.5 ' +
        '[&_a]:text-primary [&_a]:underline ' +
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_code]:font-mono ' +
        '[&>pre]:my-3 [&>pre]:overflow-auto [&>pre]:rounded [&>pre]:border [&>pre]:border-border [&>pre]:bg-muted [&>pre]:p-3 [&>pre]:font-mono [&>pre]:text-[12px] ' +
        '[&>pre>code]:bg-transparent [&>pre>code]:p-0 ' +
        '[&_strong]:font-semibold [&_strong]:text-foreground ' +
        (className ?? '')
      }
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
