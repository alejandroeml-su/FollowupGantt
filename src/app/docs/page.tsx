/**
 * Ola P2 · Equipo P2-5 — Página principal de Docs / Wikis.
 *
 * Server component: carga el árbol completo + el doc seleccionado por
 * `?id=…` y delega al `DocsBoard` cliente toda la interacción.
 *
 * Rutas:
 *   /docs            → árbol cargado, panel vacío.
 *   /docs?id=<uuid>  → doc seleccionado en el editor.
 *
 * Strings visibles en español (convención de repo): "Docs", "Vista previa",
 * "Editar", "Historial de versiones", "Restaurar versión".
 */

import { getDocsTree, getDoc, type SerializedDoc } from '@/lib/actions/docs'
import { DocsBoard } from '@/components/docs/DocsBoard'

export const dynamic = 'force-dynamic'

type SP = Promise<{ id?: string }>

export default async function DocsPage({
  searchParams,
}: {
  searchParams: SP
}) {
  const sp = await searchParams
  const tree = await getDocsTree()

  let selectedDoc: SerializedDoc | null = null
  if (sp.id) {
    try {
      selectedDoc = await getDoc(sp.id)
    } catch {
      // Doc no encontrado o archivado externamente — caemos a panel vacío.
      selectedDoc = null
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <DocsBoard tree={tree} selectedDoc={selectedDoc} />
    </div>
  )
}
