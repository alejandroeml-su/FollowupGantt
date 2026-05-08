'use client'

import { Menu } from 'lucide-react'
import { useUIStore } from '@/lib/stores/ui'

export function MobileHeader() {
  const setMobileOpen = useUIStore((s) => s.setMobileSidebarOpen)

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 lg:hidden sticky top-0 z-30 transition-colors duration-300">
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-sync.svg" alt="Sync" className="h-6 w-6" />
        <span className="text-base font-black text-foreground tracking-tight">Sync</span>
      </div>
      <button 
        onClick={() => setMobileOpen(true)}
        className="p-2 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>
    </header>
  )
}
