'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Network, Plus, Trash2, Edit2, Clock, FolderOpen, User } from 'lucide-react'
import { createMindMap, renameMindMap, deleteMindMap } from '@/lib/actions/mindmap'
import { toast } from '@/components/interactions/Toaster'

type MindMapSummary = {
  id: string
  title: string
  description: string | null
  project: { id: string; name: string } | null
  owner: { id: string; name: string } | null
  nodeCount: number
  edgeCount: number
  updatedAt: string
}

type Props = {
  mindMaps: MindMapSummary[]
  projects: { id: string; name: string }[]
  users: { id: string; name: string }[]
  showEmpty?: boolean
}

export function MindMapListClient({ mindMaps, projects, users, showEmpty = true }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', description: '', projectId: '', ownerId: '' })

  const openCreate = () => {
    setForm({ title: '', description: '', projectId: '', ownerId: users[0]?.id ?? '' })
    setCreating(true)
  }

  const submitCreate = () => {
    if (!form.title.trim()) {
      toast.error('El título es requerido')
      return
    }
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('title', form.title)
        fd.set('description', form.description)
        if (form.projectId) fd.set('projectId', form.projectId)
        if (form.ownerId) fd.set('ownerId', form.ownerId)
        const created = await createMindMap(fd)
        toast.success('Mapa mental creado')
        setCreating(false)
        router.push(`/mindmaps/${created.id}`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al crear mapa mental')
      }
    })
  }

  const submitRename = (id: string, title: string) => {
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('id', id)
        fd.set('title', title)
        await renameMindMap(fd)
        toast.success('Renombrado')
        setEditingId(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al renombrar')
      }
    })
  }

  const confirmDelete = (id: string, title: string) => {
    if (!window.confirm(`¿Eliminar el mapa "${title}"? Esta acción no se puede deshacer.`)) return
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.set('id', id)
        await deleteMindMap(fd)
        toast.success('Mapa eliminado')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al eliminar')
      }
    })
  }

  return (
    <>
      <div className="flex justify-end">
        <button
          onClick={openCreate}
          disabled={isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition-all shadow-md disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Nuevo Mapa
        </button>
      </div>

      {showEmpty && mindMaps.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mindMaps.map((m) => (
            <article
              key={m.id}
              className="group relative bg-card border border-border rounded-xl p-5 hover:border-primary/50 hover:shadow-lg transition-all"
            >
              <Link
                href={`/mindmaps/${m.id}`}
                className="absolute inset-0 rounded-xl"
                aria-label={`Abrir ${m.title}`}
              />
              <div className="relative flex items-start justify-between gap-3 mb-3">
                <Network className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                {editingId === m.id ? (
                  <input
                    autoFocus
                    defaultValue={m.title}
                    onBlur={(e) => submitRename(m.id, e.target.value.trim() || m.title)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                    className="relative flex-1 bg-input border border-border rounded px-2 py-1 text-sm text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <h2 className="flex-1 text-base font-bold text-foreground truncate">{m.title}</h2>
                )}
                <div className="relative flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      setEditingId(m.id)
                    }}
                    className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
                    aria-label="Renombrar"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      confirmDelete(m.id, m.title)
                    }}
                    className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {m.description && (
                <p className="relative text-xs text-muted-foreground line-clamp-2 mb-3">{m.description}</p>
              )}

              <div className="relative flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="font-bold text-foreground">{m.nodeCount}</span> nodos
                </span>
                <span className="flex items-center gap-1">
                  <span className="font-bold text-foreground">{m.edgeCount}</span> conexiones
                </span>
              </div>

              <div className="relative flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-border/50 text-[11px] text-muted-foreground">
                {m.project && (
                  <span className="flex items-center gap-1">
                    <FolderOpen className="h-3 w-3" />
                    {m.project.name}
                  </span>
                )}
                {m.owner && (
                  <span className="flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {m.owner.name}
                  </span>
                )}
                <span className="flex items-center gap-1 ml-auto">
                  <Clock className="h-3 w-3" />
                  {new Date(m.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {creating && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setCreating(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" />
              Nuevo Mapa Mental
            </h2>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-muted-foreground uppercase font-bold tracking-wider block mb-1">Título</label>
                <input
                  autoFocus
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && submitCreate()}
                  placeholder="Mi mapa mental..."
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground uppercase font-bold tracking-wider block mb-1">Descripción (opcional)</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-input-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground uppercase font-bold tracking-wider block mb-1">Proyecto</label>
                  <select
                    value={form.projectId}
                    onChange={(e) => setForm({ ...form, projectId: e.target.value })}
                    className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Ninguno</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground uppercase font-bold tracking-wider block mb-1">Propietario</label>
                  <select
                    value={form.ownerId}
                    onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
                    className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-input-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Sin asignar</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setCreating(false)}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={submitCreate}
                disabled={isPending || !form.title.trim()}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-all"
              >
                <Plus className="h-4 w-4" />
                Crear
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
