'use client'

import { LogOut } from 'lucide-react'

/**
 * Botón cliente que envía el form padre. Se separa del UserMenu (server)
 * para mantener el dropdown del usuario como server component sin
 * arrastrar lucide-react al server bundle innecesariamente.
 */
export default function LogoutButton() {
  return (
    <button
      type="submit"
      data-testid="logout-button"
      title="Cerrar sesión"
      aria-label="Cerrar sesión"
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <LogOut className="h-4 w-4" />
    </button>
  )
}
