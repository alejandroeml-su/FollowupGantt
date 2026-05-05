# Supabase Storage · bucket `attachments`

Wave P8 · Equipo P8-4. Setup operativo para activar uploads reales de
archivos adjuntos a tareas.

## 1. Crear el bucket

1. Supabase Dashboard → **Storage** → **New bucket**.
2. Nombre: `attachments` (exacto, case-sensitive).
3. **Public access: OFF**. Todos los reads se hacen via signed URL con
   expiración 1h generada por el server action `getSignedUrl`.
4. File size limit: 25 MB (alineado con `MAX_FILE_BYTES` en
   `src/lib/storage/upload-attachment.ts`).
5. Allowed mime types (opcional, refuerza la whitelist server):
   `image/*, application/pdf, text/*, application/zip`.

## 2. Aplicar la RLS policy de `storage.objects`

Pegar en SQL Editor del Dashboard (o `mcp__supabase__execute_sql`):

```sql
-- Permitir INSERT a usuarios autenticados, restringido al folder propio
-- ({userId}/...). El upload server usa service role y bypassa esto, pero
-- la policy protege accesos directos via API pública.
CREATE POLICY "attachment_authenticated_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Permitir SELECT a authenticated solo de archivos del folder propio.
-- (Las signed URLs no requieren esto, pero permite acceso directo si
-- el cliente integra el SDK con session de Supabase auth en futuro.)
CREATE POLICY "attachment_authenticated_read_own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Permitir DELETE a authenticated solo del folder propio.
CREATE POLICY "attachment_authenticated_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
```

## 3. Configurar variables de entorno

En Vercel (Production + Preview) y `.env.local`:

| Variable                          | Origen                                           | Notas |
|-----------------------------------|--------------------------------------------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL`        | Dashboard → Project Settings → API               | Pública. Ya configurada para Realtime. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Dashboard → Project Settings → API               | Pública. Ya configurada. |
| `SUPABASE_SERVICE_ROLE_KEY`       | Dashboard → Project Settings → API → Service role | **NUNCA exponer al cliente**. Sólo server. Usado por el upload server-side (bypassa RLS). |

## 4. Aplicar la migración SQL

Ejecutar (idempotente):

- Local: `psql $DATABASE_URL -f prisma/migrations/20260505_attachment_storage/migration.sql`
- Supabase: pegar el archivo en SQL Editor o vía MCP `apply_migration`.

## 5. Verificación post-setup

1. En la app, abrir un TaskDrawer y desplegar la sección **Adjuntos**.
2. Subir un PNG → debe aparecer en la lista con el tamaño humanizado.
3. Click en preview → modal con `<img>` cargado por signed URL.
4. Subir un PDF → preview en `<iframe>`.
5. Subir un `.txt` o `.zip` → fallback con botón Descargar.
6. Eliminar → fila desaparece y, en el bucket, el objeto también.

## Limitaciones conocidas

- **Sin chunked upload**: archivos cercanos a 25 MB pueden tardar y, en
  redes lentas, agotar el timeout del server action. Ruta futura:
  pre-signed upload directo desde el navegador.
- **Sin antivirus**: la whitelist mime se basa en el header `file.type`
  enviado por el browser y puede ser spoofeable. Para entornos sensibles
  añadir un escaneo downstream (ClamAV, Cloudmersive, etc.).
- **Cleanup de huérfanos**: si `deleteAttachment` falla en bucket pero
  borra la fila, el objeto queda como basura. Cron offline pendiente.
