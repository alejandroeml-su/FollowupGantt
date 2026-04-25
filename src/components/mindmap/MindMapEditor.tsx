'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, FileText } from 'lucide-react'
import {
  createMindMapNode,
  updateMindMapNode,
  deleteMindMapNode,
  createMindMapEdge,
  deleteMindMapEdge,
  syncNodePositions,
} from '@/lib/actions/mindmap'
import { toast } from '@/components/interactions/Toaster'
import { MindMapNodeCard, type MindMapNodeData } from './MindMapNodeCard'
import { NotePanel } from './NotePanel'
import { useMindMapShortcuts } from './use-mindmap-shortcuts'

type InitialNode = {
  id: string
  label: string
  note: string | null
  x: number
  y: number
  color: string | null
  isRoot: boolean
  taskId: string | null
  task: { id: string; mnemonic: string | null; title: string } | null
}

type InitialEdge = {
  id: string
  sourceId: string
  targetId: string
  label: string | null
}

export type AvailableTask = {
  id: string
  mnemonic: string | null
  title: string
  projectName: string | null
}

type Props = {
  initial: {
    id: string
    title: string
    description: string | null
    project: { id: string; name: string } | null
    owner: { id: string; name: string } | null
    nodes: InitialNode[]
    edges: InitialEdge[]
  }
  availableTasks: AvailableTask[]
}

const nodeTypes: NodeTypes = {
  mindmap: MindMapNodeCard,
}

function toFlowNode(n: InitialNode): Node<MindMapNodeData> {
  return {
    id: n.id,
    type: 'mindmap',
    position: { x: n.x, y: n.y },
    data: {
      label: n.label,
      note: n.note,
      color: n.color,
      isRoot: n.isRoot,
      taskId: n.taskId,
      task: n.task,
    },
  }
}

function toFlowEdge(e: InitialEdge): Edge {
  return {
    id: e.id,
    source: e.sourceId,
    target: e.targetId,
    label: e.label ?? undefined,
    animated: false,
  }
}

function EditorInner({ initial, availableTasks }: Props) {
  const [nodes, setNodes, onNodesChangeDefault] = useNodesState<Node<MindMapNodeData>>(
    initial.nodes.map(toFlowNode),
  )
  const [edges, setEdges, onEdgesChangeDefault] = useEdgesState<Edge>(initial.edges.map(toFlowEdge))
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const { screenToFlowPosition } = useReactFlow()
  const positionSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPositions = useRef<Map<string, { x: number; y: number }>>(new Map())

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  )

  // Debounced sync de posiciones al servidor tras drag
  const flushPositions = useCallback(() => {
    if (pendingPositions.current.size === 0) return
    const batch = Array.from(pendingPositions.current.entries()).map(([id, pos]) => ({
      id,
      x: pos.x,
      y: pos.y,
    }))
    pendingPositions.current.clear()
    startTransition(async () => {
      try {
        await syncNodePositions(initial.id, batch)
      } catch {
        toast.error('No se pudieron guardar las posiciones')
      }
    })
  }, [initial.id])

  const onNodesChange: OnNodesChange<Node<MindMapNodeData>> = useCallback(
    (changes) => {
      onNodesChangeDefault(changes)
      for (const c of changes) {
        if (c.type === 'position' && c.position && !c.dragging) {
          pendingPositions.current.set(c.id, { x: c.position.x, y: c.position.y })
        }
        if (c.type === 'select') {
          setSelectedNodeId(c.selected ? c.id : (prev) => (prev === c.id ? null : prev))
        }
      }
      if (positionSyncTimer.current) clearTimeout(positionSyncTimer.current)
      positionSyncTimer.current = setTimeout(flushPositions, 500)
    },
    [onNodesChangeDefault, flushPositions],
  )

  const onEdgesChange: OnEdgesChange<Edge> = useCallback(
    (changes) => {
      onEdgesChangeDefault(changes)
      for (const c of changes) {
        if (c.type === 'remove') {
          startTransition(async () => {
            try {
              const fd = new FormData()
              fd.set('id', c.id)
              await deleteMindMapEdge(fd)
            } catch {
              toast.error('No se pudo eliminar la conexión')
            }
          })
        }
      }
    },
    [onEdgesChangeDefault],
  )

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return
      if (params.source === params.target) return
      startTransition(async () => {
        try {
          const edge = await createMindMapEdge({
            mindMapId: initial.id,
            sourceId: params.source!,
            targetId: params.target!,
          })
          setEdges((eds) => addEdge({ ...params, id: edge.id }, eds))
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'No se pudo crear la conexión')
        }
      })
    },
    [initial.id, setEdges],
  )

  // Clic doble en canvas vacío → crear nodo en esa posición
  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      startTransition(async () => {
        try {
          const node = await createMindMapNode({
            mindMapId: initial.id,
            x: pos.x,
            y: pos.y,
            label: 'Nuevo nodo',
          })
          setNodes((ns) => [
            ...ns,
            toFlowNode({
              id: node.id,
              label: node.label,
              note: null,
              x: node.x,
              y: node.y,
              color: null,
              isRoot: false,
              taskId: null,
              task: null,
            }),
          ])
          setSelectedNodeId(node.id)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'No se pudo crear el nodo')
        }
      })
    },
    [initial.id, screenToFlowPosition, setNodes],
  )

  const deleteNodeById = useCallback(
    (id: string) => {
      const target = nodes.find((n) => n.id === id)
      if (!target || target.data.isRoot) {
        if (target?.data.isRoot) toast.error('No se puede eliminar el nodo raíz')
        return
      }
      startTransition(async () => {
        try {
          const fd = new FormData()
          fd.set('id', id)
          await deleteMindMapNode(fd)
          setNodes((ns) => ns.filter((n) => n.id !== id))
          setEdges((es) => es.filter((e) => e.source !== id && e.target !== id))
          if (selectedNodeId === id) setSelectedNodeId(null)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'No se pudo eliminar el nodo')
        }
      })
    },
    [nodes, selectedNodeId, setNodes, setEdges],
  )

  const updateLabel = useCallback(
    (id: string, label: string) => {
      // Optimistic local
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n)))
      startTransition(async () => {
        try {
          await updateMindMapNode({ id, label })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'No se pudo actualizar el nodo')
        }
      })
    },
    [setNodes],
  )

  const updateNote = useCallback(
    (id: string, note: string | null) => {
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, note } } : n)))
      startTransition(async () => {
        try {
          await updateMindMapNode({ id, note })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'No se pudo guardar la nota')
        }
      })
    },
    [setNodes],
  )

  const updateLinkedTask = useCallback(
    (id: string, taskId: string | null) => {
      const task = taskId ? availableTasks.find((t) => t.id === taskId) ?? null : null
      setNodes((ns) =>
        ns.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  taskId,
                  task: task ? { id: task.id, mnemonic: task.mnemonic, title: task.title } : null,
                },
              }
            : n,
        ),
      )
      startTransition(async () => {
        try {
          await updateMindMapNode({ id, taskId })
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'No se pudo enlazar la tarea')
        }
      })
    },
    [availableTasks, setNodes],
  )

  // Tab = crear hijo; Enter = crear hermano; Delete = eliminar; Escape = deselect
  const addChildFrom = useCallback(
    (parentId: string) => {
      const parent = nodes.find((n) => n.id === parentId)
      if (!parent) return
      const x = parent.position.x + 220
      const y = parent.position.y + 40
      startTransition(async () => {
        try {
          const node = await createMindMapNode({
            mindMapId: initial.id,
            x,
            y,
            label: 'Nuevo nodo',
            parentId,
          })
          setNodes((ns) => [
            ...ns,
            toFlowNode({
              id: node.id,
              label: node.label,
              note: null,
              x: node.x,
              y: node.y,
              color: null,
              isRoot: false,
              taskId: null,
              task: null,
            }),
          ])
          setEdges((es) => [
            ...es,
            { id: `${parentId}-${node.id}`, source: parentId, target: node.id },
          ])
          setSelectedNodeId(node.id)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'No se pudo crear el nodo hijo')
        }
      })
    },
    [initial.id, nodes, setNodes, setEdges],
  )

  const addSiblingFrom = useCallback(
    (nodeId: string) => {
      const incoming = edges.find((e) => e.target === nodeId)
      if (!incoming) {
        toast.error('Este nodo no tiene padre — usa Tab para crear un hijo en su lugar')
        return
      }
      addChildFrom(incoming.source)
    },
    [edges, addChildFrom],
  )

  useMindMapShortcuts({
    selectedNodeId,
    onDelete: deleteNodeById,
    onAddChild: addChildFrom,
    onAddSibling: addSiblingFrom,
    onDeselect: () => setSelectedNodeId(null),
  })

  useEffect(() => {
    return () => {
      if (positionSyncTimer.current) clearTimeout(positionSyncTimer.current)
      flushPositions()
    }
  }, [flushPositions])

  // Escucha el evento emitido por MindMapNodeCard al terminar edición inline
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, label } = (e as CustomEvent<{ id: string; label: string }>).detail
      if (id && typeof label === 'string') updateLabel(id, label)
    }
    window.addEventListener('mindmap:update-label', handler)
    return () => window.removeEventListener('mindmap:update-label', handler)
  }, [updateLabel])

  return (
    <div className="relative flex flex-col h-[calc(100vh-0px)]">
      <header className="shrink-0 border-b border-border bg-card/80 backdrop-blur-sm px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/mindmaps"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Mapas
          </Link>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-base font-bold text-foreground truncate">{initial.title}</h1>
          {initial.project && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-secondary border border-border px-2 py-0.5 rounded">
              {initial.project.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="hidden sm:inline">{nodes.length} nodos · {edges.length} conexiones</span>
          <span className="hidden md:inline-flex items-center gap-1">
            <FileText className="h-3 w-3" /> Doble-clic en canvas para crear · Tab = hijo · Enter = hermano · Delete = eliminar
          </span>
        </div>
      </header>

      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onPaneClick={() => setSelectedNodeId(null)}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneContextMenu={(e) => e.preventDefault()}
          onDoubleClick={(e) => {
            const target = e.target as HTMLElement
            if (target.closest('.react-flow__pane')) onPaneDoubleClick(e)
          }}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          className="!bg-background"
        >
          <Background gap={24} size={1.5} color="var(--color-border)" />
          <Controls className="!bg-card !border !border-border [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground hover:[&>button]:!text-foreground" />
          <MiniMap
            pannable
            zoomable
            className="!bg-card !border !border-border"
            maskColor="color-mix(in srgb, var(--color-background) 80%, transparent)"
            nodeColor={(n) => ((n.data as MindMapNodeData)?.isRoot ? 'var(--color-primary)' : 'var(--color-muted-foreground)')}
          />
        </ReactFlow>

        {selectedNode && (
          <NotePanel
            node={{
              id: selectedNode.id,
              label: selectedNode.data.label,
              note: selectedNode.data.note,
              taskId: selectedNode.data.taskId,
              task: selectedNode.data.task,
              isRoot: selectedNode.data.isRoot,
            }}
            availableTasks={availableTasks}
            onLabelChange={(label) => updateLabel(selectedNode.id, label)}
            onNoteChange={(note) => updateNote(selectedNode.id, note)}
            onTaskChange={(taskId) => updateLinkedTask(selectedNode.id, taskId)}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>
    </div>
  )
}

export function MindMapEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  )
}
