'use client'

/**
 * useTableColumnPrefs · persiste y expone las preferencias de columnas
 * de la Vista de Tabla (orden + visibilidad). Storage: localStorage.
 *
 * Diseño:
 *   - `prefs`: forma canónica `{ order, visible }`. El consumidor
 *     deriva las columnas a renderizar como
 *     `prefs.order.filter((id) => prefs.visible.includes(id))`.
 *   - `setPrefs(next)`: sobrescribe completas y persiste.
 *   - `resetPrefs()`: vuelve a defaults.
 *   - SSR-safe: el primer render usa defaults; tras hydration
 *     leemos localStorage. Esto evita un mismatch hydration error
 *     y un flash visible si el usuario tiene una config personalizada.
 *
 * Notas operativas:
 *   - Si la app cambia el shape de TableColumnPrefs (ej. nuevo campo),
 *     bumpear `TABLE_COLUMN_PREFS_KEY` a v2 e implementar la migración
 *     en `normalizeColumnPrefs` o caer a defaults limpiamente.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  TABLE_COLUMN_PREFS_KEY,
  getDefaultColumnPrefs,
  normalizeColumnPrefs,
  type TableColumnPrefs,
} from './table-columns'

export function useTableColumnPrefs() {
  const [prefs, setPrefsState] = useState<TableColumnPrefs>(() =>
    getDefaultColumnPrefs(),
  )
  const [hydrated, setHydrated] = useState(false)

  // Cargar de localStorage tras hydration. Patrón estándar para
  // evitar mismatch SSR vs cliente.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(TABLE_COLUMN_PREFS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPrefsState(normalizeColumnPrefs(parsed))
      }
    } catch {
      // localStorage corruptado o JSON inválido — caemos a defaults
      // sin alarmar al usuario.
    } finally {
      setHydrated(true)
    }
  }, [])

  const setPrefs = useCallback((next: TableColumnPrefs) => {
    const normalized = normalizeColumnPrefs(next)
    setPrefsState(normalized)
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          TABLE_COLUMN_PREFS_KEY,
          JSON.stringify(normalized),
        )
      }
    } catch {
      // localStorage puede fallar (Safari privado, cuota llena).
      // El estado en memoria sigue funcionando para esta sesión.
    }
  }, [])

  const resetPrefs = useCallback(() => {
    setPrefs(getDefaultColumnPrefs())
  }, [setPrefs])

  return { prefs, setPrefs, resetPrefs, hydrated }
}
