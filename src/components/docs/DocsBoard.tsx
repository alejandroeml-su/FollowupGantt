'use client'

/**
 * Ola P2 · Equipo P2-5 — Cliente principal del editor de docs.
 *
 * Compone DocsSidebar + DocEditor + DocVersionsHistory + CreateDocDialog.
 * Mantiene el doc actualmente seleccionado en estado local y se comunica
 * con los server actions vía `useTransition` para feedback de pending.
 */

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DocsSidebar } from './DocsSidebar'
import { DocEditor } from './DocEditor'
import { DocVersionsHistory } from './DocVersionsHistory'
import { CreateDocDialog } from './CreateDocDialog'
import {
  type DocTreeNode,
  type SerializedDoc,
  updateDoc,
  deleteDoc,
  restoreDoc,
} from '@/lib/actions/docs'

type Props = {
  tree: DocTreeNode[]
  selectedDoc: SerializedDoc | null
}

function flattenForParents(tree: DocTreeNode[]): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = []
  const walk = (nodes: DocTreeNode[], depth: number) => {
    nodes.forEach((n) => {
      if (!n.isArchived) {
        out.push({
          id: n.id,
          title: `${'  '.repeat(depth)}${n.title}`,
        })
        walk(n.children, depth + 1)
      }
    })
  }
  walk(tree, 0)
  return out
}

export function DocsBoard({ tree, selectedDoc }: Props) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [createParent, setCreateParent] = useState<string | null>(null)
  const [, start] = useTransition()

  const parentOptions = useMemo(() => flattenForParents(tree), [tree])

  function navigateTo(id: string) {
    router.push(`/docs?id=${id}`)
  }

  async function handleSave(next: { title: string; content: string }) {
    if (!selectedDoc) return
    await updateDoc(selectedDoc.id, {
      title: next.title,
      content: next.content,
    })
    router.refresh()
  }

  function handleArchive(id: string) {
    start(async () => {
      try {
        await deleteDoc(id)
        if (selectedDoc?.id === id) {
          router.push('/docs')
        } else {
          router.refresh()
        }
      } catch (e) {
        // Toaster ya cuelga del shell — aquí solo logueamos.
        console.error('[docs] archive failed', e)
      }
    })
  }

  function handleRestore(id: string) {
    start(async () => {
      try {
        await restoreDoc(id)
        router.refresh()
      } catch (e) {
        console.error('[docs] restore failed', e)
      }
    })
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <DocsSidebar
        tree={tree}
        selectedId={selectedDoc?.id ?? null}
        onSelect={navigateTo}
        onCreate={(parentId) => {
          setCreateParent(parentId)
          setCreateOpen(true)
        }}
        onArchive={handleArchive}
        onRestore={handleRestore}
      />

      <main className="relative flex flex-1 flex-col overflow-hidden">
        {selectedDoc ? (
          <>
            <DocEditor
              key={selectedDoc.id}
              docId={selectedDoc.id}
              initialTitle={selectedDoc.title}
              initialContent={selectedDoc.content}
              onSave={handleSave}
              readOnly={selectedDoc.isArchived}
            />
            <DocVersionsHistory
              docId={selectedDoc.id}
              onRestored={() => router.refresh()}
            />
            <DocMetaBar doc={selectedDoc} />
          </>
        ) : (
          <EmptyDocPanel
            hasDocs={tree.length > 0}
            onCreate={() => {
              setCreateParent(null)
              setCreateOpen(true)
            }}
          />
        )}
      </main>

      <CreateDocDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        parentOptions={parentOptions}
        defaultParentId={createParent}
        onCreated={(id) => {
          setCreateOpen(false)
          router.push(`/docs?id=${id}`)
          router.refresh()
        }}
      />
    </div>
  )
}

function DocMetaBar({ doc }: { doc: SerializedDoc }) {
  return (
    <div
      className="border-t border-border bg-card/40 px-4 py-2 text-[10px] text-muted-foreground"
      data-testid="doc-meta-bar"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Autor: <span className="text-foreground">{doc.authorName}</span>
        </span>
        {doc.lastEditorName && (
          <span>
            Última edición: <span className="text-foreground">{doc.lastEditorName}</span>
          </span>
        )}
        {doc.projectName && (
          <span>
            Proyecto: <span className="text-foreground">{doc.projectName}</span>
          </span>
        )}
        {doc.taskTitle && (
          <span>
            Tarea: <span className="text-foreground">{doc.taskTitle}</span>
          </span>
        )}
        <span>Actualizado: {new Date(doc.updatedAt).toLocaleString()}</span>
        {doc.isArchived && (
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-500">
            Archivado
          </span>
        )}
      </div>
    </div>
  )
}

function EmptyDocPanel({
  hasDocs,
  onCreate,
}: {
  hasDocs: boolean
  onCreate: () => void
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center p-12 text-center"
      data-testid="docs-empty-panel"
    >
      <div className="mb-4 rounded-full bg-primary/10 p-4">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-primary"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      </div>
      <h3 className="mb-1 text-base font-semibold text-foreground">
        {hasDocs
          ? 'Selecciona un documento'
          : 'Aún no hay documentos'}
      </h3>
      <p className="mb-4 max-w-sm text-xs text-muted-foreground">
        {hasDocs
          ? 'Elige un doc del árbol para editarlo o crea uno nuevo.'
          : 'Crea tu primer documento para empezar a construir la wiki del equipo.'}
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Crear documento
      </button>
    </div>
  )
}
