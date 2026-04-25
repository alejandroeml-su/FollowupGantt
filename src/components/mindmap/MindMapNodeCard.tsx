'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText, Hash, Star } from 'lucide-react'

export type MindMapNodeData = {
  label: string
  note: string | null
  color: string | null
  isRoot: boolean
  taskId: string | null
  task: { id: string; mnemonic: string | null; title: string } | null
}

function MindMapNodeCardInner({ id, data, selected }: NodeProps) {
  const nodeData = data as MindMapNodeData
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(nodeData.label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  /* eslint-disable react-hooks/set-state-in-effect */
  // Sincroniza el draft con el label real cuando el nodo se actualiza desde fuera
  // (condicionado al flag `editing` — no es derivación pura de props).
  useEffect(() => {
    if (!editing) setDraft(nodeData.label)
  }, [nodeData.label, editing])
  /* eslint-enable react-hooks/set-state-in-effect */

  const commit = () => {
    const next = draft.trim() || 'Nuevo nodo'
    if (next !== nodeData.label) {
      // Propaga a través de window event (el editor escucha y hace el update)
      window.dispatchEvent(
        new CustomEvent('mindmap:update-label', { detail: { id, label: next } }),
      )
    }
    setEditing(false)
  }

  return (
    <div
      className={[
        'group relative min-w-[140px] max-w-[260px] rounded-xl border px-4 py-2.5 shadow-lg transition-all',
        nodeData.isRoot
          ? 'bg-primary/15 border-primary/50 text-foreground'
          : 'bg-card border-border text-foreground',
        selected ? 'ring-2 ring-ring shadow-2xl' : 'hover:border-primary/40',
      ].join(' ')}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!editing) setEditing(true)
      }}
    >
      {/* Handles: top, right, bottom, left */}
      <Handle type="target" position={Position.Top} className="!bg-primary !border-0 !w-2 !h-2" />
      <Handle type="source" position={Position.Bottom} className="!bg-primary !border-0 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-primary !border-0 !w-2 !h-2" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-primary !border-0 !w-2 !h-2" />

      <div className="flex items-start gap-2">
        {nodeData.isRoot && <Star className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" aria-label="Nodo raíz" />}

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setDraft(nodeData.label)
                setEditing(false)
              }
            }}
            className="flex-1 bg-input border border-border rounded px-1.5 py-0.5 text-sm text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <span className="flex-1 text-sm font-semibold leading-snug break-words">{nodeData.label}</span>
        )}
      </div>

      {(nodeData.note || nodeData.task) && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50 text-[10px]">
          {nodeData.note && (
            <span className="flex items-center gap-1 text-amber-300" title="Tiene nota">
              <FileText className="h-3 w-3" />
              <span className="font-semibold">Nota</span>
            </span>
          )}
          {nodeData.task && (
            <span
              className="flex items-center gap-1 text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-1.5 py-0.5 rounded"
              title={nodeData.task.title}
            >
              <Hash className="h-2.5 w-2.5" />
              {nodeData.task.mnemonic || nodeData.task.id.substring(0, 6)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export const MindMapNodeCard = memo(MindMapNodeCardInner)
