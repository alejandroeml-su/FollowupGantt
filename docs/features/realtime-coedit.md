# R4-D · DocSpace + Whiteboards · Real-time co-edit

## Resumen

Esta feature habilita edición colaborativa concurrente sobre **Docs** (wiki
pages) y **Whiteboards** (mind maps) usando CRDT (Yjs) como modelo de
convergencia y Supabase Realtime channels como transport.

Es la entrega del **Equipo R4-D · DocSpace + Real-time co-edit** dentro de
la Wave R4 de Sync (FollowupGantt).

## Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│  Cliente (navegador) · usuario 1            usuario 2  ...   │
│  ┌─────────────────────────┐   ┌─────────────────────────┐   │
│  │  Tiptap Editor          │   │  WhiteboardCanvas       │   │
│  │   └─ Collaboration ext  │   │   └─ useWhiteboard…     │   │
│  │       └─ Y.Doc          │   │       └─ Y.Doc          │   │
│  └────────┬────────────────┘   └────────┬────────────────┘   │
│           │ Y.applyUpdate / encode      │                    │
│           ▼                             ▼                    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  SupabaseYjsProvider                                  │    │
│  │   · broadcast: yjs:syncStep1 / syncStep2 / update     │    │
│  │   · awareness: yjs:awareness (cursor + identity)      │    │
│  └────────┬─────────────────────────────────────────────┘    │
└───────────┼──────────────────────────────────────────────────┘
            │ wss://supabase/realtime/v1
            ▼
┌──────────────────────────────────────────────────────────────┐
│  Supabase Realtime (channel `doc:<id>` o `whiteboard:<id>`)  │
└──────────────────────────────────────────────────────────────┘
            │
            ▼ debounced 2s ó cada 10s
┌──────────────────────────────────────────────────────────────┐
│  Server Action `saveDocYjsState` / `saveWhiteboardYjsState`  │
│   · Postgres `Doc.contentYjs bytea` / `Whiteboard.stateYjs`  │
│   · `recordAuditEventSafe('doc.realtime_edit_session', …)`   │
└──────────────────────────────────────────────────────────────┘
```

### Protocolo de sincronización

Tres tipos de mensaje viajan en cada channel:

| Evento              | Contenido                                  | Cuándo                    |
| ------------------- | ------------------------------------------ | ------------------------- |
| `yjs:syncStep1`     | State vector (base64) del nuevo peer       | Al conectar               |
| `yjs:syncStep2`     | Diff update calculado con `encodeStateAsUpdate(doc, remoteSv)` | Respondiendo a un syncStep1 |
| `yjs:update`        | Update incremental (base64)                | Después de cada edición   |
| `yjs:awareness`     | `{ userId, name, color, cursor, … }`       | Al cambiar cursor / mount |

Los `Uint8Array` que produce Yjs se serializan a **base64** para viajar en
`broadcast.payload` (que es JSON). Overhead ~33%, aceptable para los
~1-10 KB de los updates incrementales.

### Persistencia

- **`Doc.contentYjs` bytea** — snapshot completo (`Y.encodeStateAsUpdate`).
- **`Doc.content` text** — markdown derivado por `editor.getText()` antes
  de cada save. Se mantiene sincronizado para que consumidores legacy
  (`searchDocs`, `getDocVersions`, exporters) sigan funcionando sin Yjs.
- **`Whiteboard.stateYjs` bytea** — snapshot completo del ymap de
  elementos.
- **`WhiteboardElement` (tabla relacional)** — sigue siendo la fuente de
  verdad para queries server-side. La reconciliación con el ymap se
  programa para R4-D2 / P21 (out of scope MVP).

Save trigger:
- **Debounce 2s** después de que el usuario deja de teclear (idle).
- **Forzado cada 10s** si sigue habiendo cambios sin guardar.

## Lazy init (backward compat)

Rows existentes con `Doc.content` (markdown) pero sin `contentYjs`
siguen funcionando: al primer co-edit, `CollaborativeDocEditor` carga
el markdown como `content` inicial de Tiptap, que automáticamente
construye el `Y.Doc` desde ese seed. El primer save crea el `contentYjs`.

Equivalente para `Whiteboard.stateYjs`: si está null, el hook
`useWhiteboardYjsCoEdit` hace seed del `Y.Map` desde la lista de
`WhiteboardElement` cargada server-side.

## Limitaciones documentadas

1. **Offline parcial**: Yjs maneja edición offline (los updates se
   acumulan en el `Y.Doc` local y se aplican al reconectar), pero el
   provider actual NO persiste localmente (IndexedDB). Si el navegador
   cierra antes del próximo save (2s), los cambios desde el último save
   se pierden. Mitigación: `setInterval` forzando save cada 10s mientras
   `dirtyRef` esté activo.

2. **Max document size ~10 MB**: Supabase Realtime payload limit por
   broadcast es ~10 MB. El servidor de R4-D acepta state buffers de hasta
   **5 MB** como margen. Documentos Yjs comprimidos típicamente quedan
   <2 MB (incluso para wikis grandes). Si un doc excede, considerar
   garbage collection de updates antiguos (`Y.cleanupStateAsUpdate` —
   no implementado en MVP).

3. **No hay garbage collection de updates Yjs**: el snapshot crece
   monótonamente con cada edit hasta que se hace un re-serialize completo
   (que sí hacemos en cada save). En la práctica esto está controlado
   porque el server siempre persiste `encodeStateAsUpdate(doc)` completo
   (que sí aplica GC interno).

4. **Awareness no enriquecido**: usamos un adapter mínimo (no
   `y-protocols/awareness`). El cursor remoto en Tiptap se actualiza por
   polling cada 250 ms — suficiente para colaboración humana, no para
   typing experience de 60 fps.

5. **Sin authentication a nivel channel**: Supabase Realtime acepta a
   cualquier cliente con la anon key. La autorización fina (¿puede este
   user editar este doc?) ocurre en las server actions. Un atacante con
   anon key podría suscribirse al channel y ver ediciones en vivo sin
   poder persistirlas — mitigación adicional con RLS sobre canales
   queda para R4-D2.

6. **No CRDT para tablas relacionales adyacentes**: cambios concurrentes
   en `Doc.title` o `Whiteboard.title` (que NO viven en el `Y.Doc`) se
   resuelven con el SoftLock existente de Wave P6 · B3 (`useDocEditLock`).

## Costo operativo

Cada usuario online en un doc abre **1 connection** a Supabase Realtime.

- **Plan Free**: 200 connections simultáneas → ~200 usuarios co-editando
  simultáneamente.
- **Plan Pro**: 500 connections → ~500 usuarios.
- **Pay-as-you-go**: $10 / millón de mensajes.

Tasa de mensajes esperada:
- **Editing activo**: ~5 updates/s por usuario × N peers en sala.
- **Cursor (awareness)**: throttled a 1 msg / 50 ms = 20 msg/s.
- **Idle**: 0 (excepto heartbeat de presence cada 30s del módulo Wave P6).

Para 10 personas co-editando 8 horas continuas: ~10 × 25 msg/s × 28,800s
= 7.2 M msgs/día. Bajo plan Pro (5M msgs/mes incluidos) consumiría toda
la cuota en 1 día — recomendación: monitorear el quota dashboard y
considerar agregar **batching** de updates en el provider si se observa.

## Audit log

Cada persistencia emite:

```ts
{
  action: 'doc.realtime_edit_session' | 'whiteboard.realtime_edit_session',
  entityType: 'doc' | 'whiteboard',
  entityId: <id>,
  metadata: {
    projectId,
    sizeBytes,    // tamaño del snapshot Yjs
    hasMarkdown,  // (sólo docs) si llegó el markdown serializado
    mode?,        // 'append' si fue patch incremental
  }
}
```

Esto permite reconstruir sesiones de co-edit en el panel `/audit-log`
sin loguear el contenido (sólo metadata).

## Trade-offs aceptados

| Decisión              | Alternativa                  | Razón                                                                 |
| --------------------- | ---------------------------- | --------------------------------------------------------------------- |
| Yjs (CRDT)            | OT custom server-mediated    | OT requiere servidor central serializador; Yjs es peer-to-peer.       |
| Supabase Realtime     | WebSocket server propio      | Reusa infra Wave P6, sin operar nuevos pods.                          |
| Persist snapshot full | Persist log de updates       | Simplicidad. Snapshot < 2 MB típico, escribirlo cada 2s no es costoso. |
| Base64 sobre JSON     | Binary frames Supabase       | Supabase Realtime broadcast no soporta payload binario nativo.        |
| Polling awareness     | y-protocols/awareness oficial| Adapter ligero; futura migración planificada.                         |

## Setup pendiente

- [ ] Aplicar `prisma/migrations/20260511_r4d_doc_whiteboard_yjs/migration.sql`
      en Supabase prod (MCP `apply_migration`).
- [ ] Verificar quota actual del proyecto Supabase (`Settings → Usage →
      Realtime concurrent connections` y `Realtime messages`).
- [ ] Considerar plan Pro upgrade si superamos 200 connections simultáneas.
- [ ] Tour del editor colaborativo en Wave P16-B (Onboarding Kit) — fuera
      de scope R4-D.

## Archivos clave

- `src/lib/realtime/yjs-provider.ts` — Provider Yjs + Supabase Realtime.
- `src/lib/actions/docs-realtime.ts` — `saveDocYjsState`, `loadDocYjsState`, `appendDocYjsUpdate`.
- `src/lib/actions/whiteboards-realtime.ts` — `saveWhiteboardYjsState`, `loadWhiteboardYjsState`.
- `src/components/docs/CollaborativeDocEditor.tsx` — Editor Tiptap + Yjs.
- `src/components/whiteboards/useWhiteboardYjsCoEdit.ts` — Hook co-edit pizarras.
- `prisma/migrations/20260511_r4d_doc_whiteboard_yjs/migration.sql` — Schema delta.
- `tests/unit/yjs-provider.test.ts` — 14 unit tests (base64, apply, persist, convergence, awareness).

## Dependencias agregadas

| Package                                      | Versión   | Motivo                                  |
| -------------------------------------------- | --------- | --------------------------------------- |
| `yjs`                                        | ^13.6.21  | Core CRDT.                              |
| `y-prosemirror`                              | ^1.2.15   | Binding ProseMirror ⇄ Yjs (Tiptap base).|
| `@tiptap/react`                              | ^2.10.4   | Editor React.                           |
| `@tiptap/pm`                                 | ^2.10.4   | ProseMirror runtime.                    |
| `@tiptap/starter-kit`                        | ^2.10.4   | Extensions base (paragraph, bold, …).   |
| `@tiptap/extension-collaboration`            | ^2.10.4   | Binding oficial Tiptap ⇄ Y.Doc.         |
| `@tiptap/extension-collaboration-cursor`     | ^2.10.4   | Cursores remotos en el editor.          |
