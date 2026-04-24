'use client';

import { useState } from 'react';
import { Pencil, X, Save } from 'lucide-react';
import { updateGerencia } from '@/lib/actions';

interface GerenciaEditModalProps {
  gerencia: {
    id: string;
    name: string;
    description: string | null;
  };
}

export default function GerenciaEditModal({ gerencia }: GerenciaEditModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 hover:bg-indigo-500/20 rounded-lg text-muted-foreground hover:text-indigo-400 transition-colors"
        title="Editar Gerencia"
      >
        <Pencil className="h-4 w-4" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-white">Editar Gerencia</h3>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              action={async (formData) => {
                await updateGerencia(formData);
                setOpen(false);
              }}
              className="space-y-4"
            >
              <input type="hidden" name="id" value={gerencia.id} />

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Nombre de la Gerencia
                </label>
                <input
                  name="name"
                  required
                  defaultValue={gerencia.name}
                  className="w-full rounded-lg border border-border bg-background py-2.5 px-4 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-ring/30 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Descripción
                </label>
                <input
                  name="description"
                  defaultValue={gerencia.description || ''}
                  placeholder="Descripción opcional..."
                  className="w-full rounded-lg border border-border bg-background py-2.5 px-4 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-ring/30 transition-all"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-foreground/90 hover:bg-secondary/80 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-all flex items-center justify-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
