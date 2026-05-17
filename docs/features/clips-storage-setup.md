# US-7.3 · Clips de video — Storage setup (Supabase)

> **Wave R4 · US-7.3 · `feat/us-7-3-clips-video`**
> Setup operacional del bucket Supabase dedicado a clips de video grabados
> in-browser desde el TaskDrawer y el composer de comentarios.

## Contexto

El feature **Clips de video** permite grabar pantalla + audio (mic opcional)
con la **Screen Capture API** (`navigator.mediaDevices.getDisplayMedia()`)
+ `MediaRecorder` directamente desde el navegador. El blob resultante se sube a
Supabase Storage y se adjunta al `Task` o al `Comment` correspondiente.

A diferencia de los `Attachment` regulares (bucket `attachments`, whitelist
`image/*`, `application/pdf`, `text/*`, `application/zip`, cap 25 MB), los
clips:

- Son siempre `video/webm` (vp9/vp8 + opus).
- Pesan más (cap 100 MB configurable via `CLIP_MAX_SIZE_MB`).
- Tienen un thumbnail JPEG generado en cliente (primer frame).
- Pueden estar asociados a una `Task` **o** a un `Comment` (XOR).

Por eso usamos un **bucket dedicado `clips`** con sus propias políticas.

## 1. Crear el bucket

> NO ejecutar este paso automáticamente desde código. Edwin debe aplicarlo
> manualmente desde el dashboard de Supabase o vía MCP previa autorización.

### Desde el dashboard

1. Ir a **Storage** → **Create a new bucket**.
2. Nombre: `clips`.
3. **Public bucket**: marcar **sí** (lectura pública). Los thumbnails y los
   propios clips se sirven directamente vía URL pública para no consumir
   ancho de banda firmando cada `<video>`.
4. **File size limit**: `100 MB` (alineado con `CLIP_MAX_SIZE_MB` por
   default).
5. **Allowed MIME types**: `video/webm, video/mp4, image/jpeg, image/png`.
6. Click **Create bucket**.

### Vía CLI / SQL (opcional)

```sql
-- Crear bucket (idempotente).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clips',
  'clips',
  true,
  104857600, -- 100 MB
  array['video/webm', 'video/mp4', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;
```

## 2. Políticas RLS sobre `storage.objects`

Bucket público para lectura, pero la **escritura/borrado** queda restringida
a usuarios autenticados sobre su propio folder (`{userId}/...`).

```sql
-- ────────── SELECT (lectura pública) ──────────
-- Permitir GET anónimo. El bucket está marcado como public así que el
-- dashboard también crea esta policy por defecto; la dejamos explícita para
-- documentar la intención.
create policy "clips · public read"
on storage.objects
for select
to public
using (bucket_id = 'clips');

-- ────────── INSERT (sólo authenticated en su folder) ──────────
create policy "clips · authenticated upload own folder"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'clips'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ────────── DELETE (sólo authenticated en su folder) ──────────
create policy "clips · authenticated delete own folder"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'clips'
  and (storage.foldername(name))[1] = auth.uid()::text
);
```

> **Nota sobre auth.uid()** — la app usa auth propio (cookies firmadas), no
> Supabase Auth. En el server action `createClip` subimos con
> `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS), pero las políticas siguen
> protegiendo accesos directos desde clientes anónimos o tokens leakeados.

## 3. Variables de entorno

| Variable                       | Default  | Uso |
|--------------------------------|----------|-----|
| `CLIP_MAX_SIZE_MB`             | `100`    | Tope de tamaño del blob clip (en MB). Si excede → `[FILE_TOO_LARGE]`. |
| `CLIP_MAX_DURATION_SEC`        | `300`    | Duración recomendada (UI muestra warning, no bloquea). |
| `NEXT_PUBLIC_SUPABASE_URL`     | —        | Ya configurada para `attachments`. Se reutiliza. |
| `SUPABASE_SERVICE_ROLE_KEY`    | —        | Idem. Necesaria para subir desde el server action. |

Si `SUPABASE_SERVICE_ROLE_KEY` no está set, la acción lanza
`[STORAGE_NOT_CONFIGURED]` y la UI muestra error legible.

## 4. Estructura del path

```
clips/
  {userId}/
    {clipId}/
      video.webm        # blob principal
      thumb.jpg         # primer frame, 320×180 aprox
```

- `{userId}` como primer segmento → la policy `storage.foldername(name)[1]`
  valida ownership en accesos directos.
- `{clipId}` (uuid) agrupa el video con su thumbnail.
- Los nombres internos son fijos para que `regenerateThumbnail` pueda
  sobreescribir `thumb.jpg` sin renombrar.

## 5. Limitaciones de browser conocidas

| Browser            | Screen Capture API | MediaRecorder webm/vp9 | Notas |
|--------------------|--------------------|------------------------|-------|
| Chrome ≥ 96 desktop | sí                | sí                     | Funcionamiento de referencia. |
| Edge ≥ 96 desktop  | sí                 | sí                     | Idem. |
| Firefox ≥ 90       | sí                 | sí (vp9) / vp8 fallback | El audio del sistema no se captura en Linux. |
| Safari macOS ≥ 13  | sí (desde 13)      | parcial                | `video/webm` no soportado nativo → fallback a `video/mp4` si está disponible; si no, ClipRecorder muestra mensaje "Tu navegador no soporta clips webm". |
| **Safari iOS / iPadOS** | **NO**       | n/a                    | `getDisplayMedia` no existe. UI oculta el botón "Grabar clip" y muestra hint "Disponible solo en desktop". |
| Chrome Android     | NO                 | n/a                    | Idem. |

El componente `ClipRecorder` hace feature detection con
`typeof navigator.mediaDevices?.getDisplayMedia === 'function'` y degrada
silenciosamente; el botón no aparece en navegadores sin soporte.

## 6. Limpieza / retention

- Borrar un `Clip` desde la UI invoca `deleteClip` que elimina del bucket
  (best-effort, idempotente sobre 404) y la fila de DB.
- Pendiente operativo (deuda registrada): cron mensual que recorra
  `storage.objects` del bucket `clips` y borre los huérfanos cuyo `clipId`
  no exista ya en `prisma.clip`. No bloqueante para la entrega.

## 7. Verificación post-creación

```sql
-- Confirmar bucket creado
select id, name, public, file_size_limit
from storage.buckets
where id = 'clips';

-- Confirmar policies aplicadas
select policyname, cmd, qual
from pg_policies
where tablename = 'objects'
  and schemaname = 'storage'
  and policyname like 'clips%';
```

Tras crear el bucket + policies, ejecutar un upload de prueba desde
`/list` → cualquier task → botón "🎥 Grabar clip". Si funciona, el feature
queda operacional.
