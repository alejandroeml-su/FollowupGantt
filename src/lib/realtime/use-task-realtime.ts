'use client'

/**
 * useTaskRealtimeRefresh · Refresca la vista actual cuando cualquier
 * tarea cambia en Supabase (Postgres CDC vía Realtime).
 *
 * Diseño:
 *   - Suscribe a `postgres_changes` sobre la tabla pública `Task`,
 *     evento `*` (INSERT/UPDATE/DELETE).
 *   - Cuando llega un evento, llama `router.refresh()` para que el
 *     RSC se vuelva a fetchar y los componentes server re-rendericen.
 *     El cliente ve el nuevo snapshot sin recargar la página.
 *   - Si Supabase Realtime no está configurado (env vars públicas
 *     ausentes) o la tabla `Task` no está en la publication, el hook
 *     queda en no-op silencioso. La UX degrada al modelo previo:
 *     refresh manual / `revalidatePath` del actor que mutó.
 *
 * Pre-requisito operativo (configuración de Supabase Studio):
 *   1. Database → Replication → asegurar que `Task` esté en
 *      `supabase_realtime` (Edwin).
 *   2. Database → Replication → habilitar el publication para esa
 *      tabla con events INSERT, UPDATE, DELETE.
 *   3. Si la tabla tiene RLS, permitir SELECT al rol `anon` para que
 *      el WebSocket entregue payloads (o usar `authenticated` si la
 *      sesión usa Supabase auth — en este proyecto la sesión es propia
 *      con cookies HTTP-only, así que `anon` con políticas RLS por
 *      tenancy es lo más práctico).
 *
 * Bug mitigado (request Edwin 2026-05-06): el avance/progreso no se
 * recalculaba en tiempo real. Antes el revalidatePath sólo refrescaba
 * la pestaña que mutó; ahora todas las pestañas que estén viendo
 * cualquiera de las 4 vistas (List, Kanban, Table, Gantt) reaccionan
 * a cambios de cualquier usuario y recalculan rollups derivados.
 */
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getBrowserClient } from './supabase-client'

type Options = {
  /** Suprime las suscripciones (útil para storybook / tests). */
  enabled?: boolean
  /** Throttle entre refreshes para evitar tormentas en bulk updates.
   *  Valor por defecto: 250ms. */
  throttleMs?: number
}

export function useTaskRealtimeRefresh(options?: Options) {
  const router = useRouter()
  const enabled = options?.enabled ?? true
  const throttleMs = options?.throttleMs ?? 250

  useEffect(() => {
    if (!enabled) return
    const client = getBrowserClient()
    if (!client) return

    let lastRefresh = 0
    let pending: ReturnType<typeof setTimeout> | null = null

    const triggerRefresh = () => {
      const now = Date.now()
      const elapsed = now - lastRefresh
      if (elapsed >= throttleMs) {
        lastRefresh = now
        router.refresh()
      } else if (!pending) {
        pending = setTimeout(() => {
          pending = null
          lastRefresh = Date.now()
          router.refresh()
        }, throttleMs - elapsed)
      }
    }

    const channel = client
      .channel('task-row-changes')
      .on(
        // El SDK tipa esta firma con genéricos complejos; el contrato real
        // del payload no nos importa porque sólo usamos el evento como
        // señal de "algo cambió".
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: '*', schema: 'public', table: 'Task' },
        triggerRefresh,
      )
      .subscribe()

    return () => {
      if (pending) clearTimeout(pending)
      void client.removeChannel(channel)
    }
  }, [router, enabled, throttleMs])
}
