# Realtime · Arquitectura (Wave P6 · Equipo A1)

Capa base sobre **Supabase Realtime** (`@supabase/supabase-js` v2.x). Provee
hooks de React reutilizables por los equipos A2-A5 de la Ola P6 para
implementar cursores en vivo, chat, whiteboard colaborativo y notificaciones
push.

## 1 · Convención de nombres de canal

Mantener un único namespace por entidad evita colisiones cuando varios
features escuchan el mismo recurso. Patrón canónico:

| Topic                | Cuándo se usa                                 | Equipo dueño |
| -------------------- | --------------------------------------------- | ------------ |
| `project:{id}`       | Presence en vista de proyecto, cursores       | A1, A2       |
| `task:{id}`          | "está escribiendo", focus, comentarios live   | A2, A3       |
| `whiteboard:{id}`    | Strokes/cursors en pizarra colaborativa       | A4           |
| `workspace:{id}`     | Notificaciones por workspace                  | A5           |
| `user:{id}`          | Notificaciones personales (1:1)               | A5           |

El tipo TypeScript `ChannelTopic` en `src/lib/realtime/types.ts` documenta
esta lista; añadir nuevos prefijos requiere PR explícito que actualice tanto
el tipo como esta tabla.

## 2 · Hooks expuestos

Todos viven en `src/lib/realtime/` y son `'use client'`. Si las env vars
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` no están
configuradas, los hooks degradan a no-op silencioso (la app no rompe).

### `useChannel(name, options?)`

Hook base. Suscribe al channel y devuelve `{ channel, isReady, isConnected, error }`.
No conoce de presence ni broadcast — es la primitiva que usan los otros dos.

### `usePresence(name, identity)`

Wrapper sobre `track`/`untrack`. Devuelve `{ users, me, isOnline }`. Detalles:

- Llama `track(identity)` al recibir status `SUBSCRIBED`.
- Mantiene `users` actualizado con eventos `presence:sync|join|leave`.
- Heartbeat cada **30s** (`PRESENCE_HEARTBEAT_MS`): re-track con `lastSeen`
  fresco para detectar tabs zombie y mantener viva la sesión.
- En unmount, `untrack()` propaga el `leave` antes de remover el channel.

### `useBroadcast<T>(name, event)`

Suscribe a un `event` específico. Devuelve `{ messages, send }`. Detalles:

- Buffer FIFO en memoria de **50** mensajes (`BROADCAST_BUFFER_SIZE`).
- `self: false` por defecto (no recibimos eco de nuestros propios envíos).
- `ack: true` para que `send()` resuelva con confirmación del server.

## 3 · Flujo de eventos de Presence

```
mount
  └─> useChannel(...).subscribe(SUBSCRIBED)
        └─> channel.track({ userId, name, ..., lastSeen: ISO })
              └─> server emite presence:sync a todos los suscriptores
                    └─> hooks consumen y llaman setState

cada 30s
  └─> heartbeat: channel.track({ ...latestIdentity, lastSeen: ISO })
        └─> server emite presence:sync (lastSeen actualizado)

unmount
  └─> channel.untrack()
        └─> server emite presence:leave
              └─> client.removeChannel(channel)  // teardown WebSocket binding
```

## 4 · Catálogo de eventos broadcast

Los tipos viven en `BroadcastEventType` (`src/lib/realtime/types.ts`). Lista
inicial — los equipos pueden añadir más, pero registrar el nombre aquí evita
colisiones:

| Evento               | Payload (ejemplo)                              | Frecuencia    |
| -------------------- | ---------------------------------------------- | ------------- |
| `cursor:move`        | `{ x, y, userId }`                             | ~60 Hz (throttle) |
| `cursor:click`       | `{ x, y, userId, target }`                     | esporádico    |
| `task:typing`        | `{ taskId, userId, isTyping }`                 | inicio/fin    |
| `task:focus`         | `{ taskId, userId }`                           | esporádico    |
| `whiteboard:stroke`  | `{ id, points[], color, userId }`              | alta carga    |
| `chat:message`       | `{ messageId, text, userId, ts }`              | baja          |
| `notification:push`  | `{ id, kind, title, body, severity }`          | baja          |

## 5 · Configuración operacional

### 5.1 · Habilitar Realtime en Supabase

1. Dashboard → tu proyecto → **Settings → API → Realtime**.
2. Verificar `Realtime: Enabled`. (Por defecto sí, pero en proyectos
   antiguos puede estar apagado.)
3. **Settings → API → Project URL** y **anon / public key** se copian a las
   env vars `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` en
   `.env.local` (dev) y en Vercel → Environment Variables (prod/preview).

### 5.2 · Postgres Changes (futuro)

Esta Ola NO usa `postgres_changes`. Si en el futuro algún equipo lo necesita,
debe habilitar replication en **Database → Publications → supabase_realtime**
y añadir la tabla. Ojo: requiere RLS si se quiere filtrar por usuario.

### 5.3 · Cliente singleton

`getBrowserClient()` cachea la instancia para evitar abrir múltiples
WebSockets por pestaña. Llamar el factory en cada hook es seguro: la primera
llamada crea, las siguientes devuelven la misma referencia.

`auth.persistSession=false` y `autoRefreshToken=false` porque la auth
propia (Ola P1) usa cookies HTTP-only y no depende de Supabase Auth.

## 6 · Limitaciones y seguridad

- **NO hay auth check en Realtime** en esta versión. Cualquier cliente con
  la `anon_key` y el nombre del channel puede suscribirse. Datos sensibles
  (precios, datos PII no destinados a colaboración) **NO deben enviarse por
  broadcast/presence**. Para canales privados, evaluar `private: true` +
  RLS en Supabase Dashboard como mejora P7.
- El `anon_key` es público por diseño (va en el bundle del navegador). La
  seguridad real para queries vive en RLS, no aquí.
- El buffer de 50 mensajes es local: si el usuario abre la pestaña después
  de un evento, no lo recibe. Para historial, usar Postgres + paginación.
- Sin reconexión exponencial custom: confiamos en el SDK de Supabase, que
  reintenta con backoff. En tabs muy largos (varias horas) puede haber
  pérdidas; los consumidores que necesiten exactly-once deben tener una
  fuente de verdad en BD.

## 7 · Test strategy

Mock del SDK con `vi.mock('@supabase/supabase-js', ...)` exponiendo un
`createClient` que retorna un cliente fake con `channel()` instrumentado.
Cubierto en `tests/unit/use-channel.test.ts` y `tests/unit/use-presence.test.ts`
(ver casos de env-vars-ausentes, subscribe/unsubscribe, presence join/leave,
componente PresenceAvatars con 0/1/3/6 usuarios).

E2E en navegador real queda fuera de unit; se cubrirá en P6-final con
Playwright + dos contextos paralelos (smoke "dos tabs ven al otro").
