'use client';

import { useState } from 'react';

interface AreaFormClientProps {
  gerencias: { id: string; name: string; areas: { id: string; name: string }[] }[];
}

/**
 * Client component that provides a Gerencia selector and dependent Area selector
 * for use in the project creation form.
 */
export default function AreaFormClient({ gerencias }: AreaFormClientProps) {
  const [selectedGerenciaId, setSelectedGerenciaId] = useState('');

  const areasForGerencia = gerencias.find(g => g.id === selectedGerenciaId)?.areas || [];

  return (
    <>
      {/* Selector de Gerencia */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">Gerencia</label>
        <select
          value={selectedGerenciaId}
          onChange={(e) => setSelectedGerenciaId(e.target.value)}
          className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none"
        >
          <option value="">Seleccionar Gerencia...</option>
          {gerencias.map(g => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </div>

      {/* Selector de Área (dependiente de Gerencia) */}
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Área {!selectedGerenciaId && <span className="text-muted-foreground">(selecciona gerencia primero)</span>}
        </label>
        <select
          name="areaId"
          disabled={!selectedGerenciaId}
          className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-white focus:border-indigo-500 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <option value="">
            {selectedGerenciaId
              ? areasForGerencia.length > 0
                ? 'Seleccionar Área...'
                : 'No hay áreas en esta gerencia'
              : 'Selecciona una gerencia primero'}
          </option>
          {areasForGerencia.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
    </>
  );
}
