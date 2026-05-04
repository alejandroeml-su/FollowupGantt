'use client'

import { create } from 'zustand'
import { useEffect } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useTranslation } from '@/lib/i18n/use-translation'

type ToastKind = 'info' | 'success' | 'error'
type Toast = { id: string; kind: ToastKind; message: string }

type Store = {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

const useToastStore = create<Store>((set) => ({
  toasts: [],
  push: (t) =>
    set((s) => ({
      toasts: [...s.toasts, { ...t, id: crypto.randomUUID() }],
    })),
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

// API imperativa (fuera de React) para usar en server action callbacks.
export const toast = {
  info: (m: string) => useToastStore.getState().push({ kind: 'info', message: m }),
  success: (m: string) =>
    useToastStore.getState().push({ kind: 'success', message: m }),
  error: (m: string) =>
    useToastStore.getState().push({ kind: 'error', message: m }),
  /** Sólo para tests: limpia el store. */
  __resetForTests: () => useToastStore.setState({ toasts: [] }),
}

const KIND_STYLES: Record<ToastKind, string> = {
  info: 'border-border bg-card text-foreground',
  success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  error: 'border-red-500/40 bg-red-500/10 text-red-200',
}
const KIND_ICONS: Record<ToastKind, React.ReactNode> = {
  info: <Info className="h-4 w-4" />,
  success: <CheckCircle2 className="h-4 w-4" />,
  error: <AlertCircle className="h-4 w-4" />,
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  // Ola P4 · P4-4 — labels accesibles del Toaster ahora son i18n.
  // El `message` lo provee el caller (ej. `toast.success('...')`); para
  // mensajes genéricos pre-traducidos ver `toast` API en este módulo.
  const { t: tr } = useTranslation()

  useEffect(() => {
    const timers = toasts.map((toastItem) =>
      setTimeout(() => dismiss(toastItem.id), 5000),
    )
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismiss])

  return (
    <div
      role="region"
      aria-label={tr('toast.regionLabel')}
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((toastItem) => (
        <div
          key={toastItem.id}
          role={toastItem.kind === 'error' ? 'alert' : 'status'}
          className={clsx(
            'pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg',
            KIND_STYLES[toastItem.kind],
          )}
        >
          <span aria-hidden className="mt-0.5">
            {KIND_ICONS[toastItem.kind]}
          </span>
          <p className="flex-1 leading-snug">{toastItem.message}</p>
          <button
            type="button"
            aria-label={tr('toast.dismiss')}
            onClick={() => dismiss(toastItem.id)}
            className="mt-0.5 rounded p-0.5 text-current/60 hover:text-current"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
