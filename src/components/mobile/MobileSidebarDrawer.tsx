'use client'

import Sidebar from '@/components/Sidebar'
import type { ReactNode } from 'react'

/**
 * Wrapper que monta el `<Sidebar/>` dentro del árbol mobile. El Sidebar
 * ya tiene su propia lógica de drawer (translate-x-full / mobileOpen),
 * lo único que queremos es asegurar que en desktop NO se renderice por
 * duplicado: en `layout.tsx` el Sidebar "real" se monta dentro de un
 * contenedor `hidden lg:flex`, y este drawer wrapper lo monta dentro de
 * `lg:hidden` para que el drawer overlay solo exista en mobile.
 */
export function MobileSidebarDrawer({ userSlot }: { userSlot?: ReactNode }) {
  return (
    <div className="lg:hidden">
      <Sidebar userSlot={userSlot} />
    </div>
  )
}
