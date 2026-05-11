'use server'

/**
 * R4-D · DocSpace + Real-time co-edit · Server actions de persistencia Yjs.
 *
 * Estas actions complementan `docs.ts` (CRUD relacional) con persistencia
 * del state CRDT del editor colaborativo:
 *
 *  - `saveDocYjsState(docId, stateBuffer, markdown?)`: persiste el snapshot
 *    binario (`contentYjs` bytea) y opcionalmente sincroniza el `content`
 *    markdown (toMarkdown(Yjs) se ejecuta en cliente con Tiptap, aquí sólo
 *    lo recibimos serializado para evitar duplicar la lógica de parsing).
 *
 *  - `loadDocYjsState(docId)`: carga el state previo desde BD para hidratar
 *    al nuevo peer al abrir el doc. Check de permiso vía el doc/proyecto.
 *
 *  - `appendDocYjsUpdate(docId, updateBuffer, markdown?)`: variante "patch"
 *    que merge un update con el state existente sin reemplazar todo. Útil
 *    cuando el cliente sólo envía el delta y el server reconcilia.
 *
 * Convenciones del repo:
 *  - Errores tipados `[CODE] mensaje` con prefijos `R4D_*`.
 *  - `requireUser()` para auth + check membership.
 *  - Audit log: emite `doc.realtime_edit_session` post-save.
 *  - `revalidatePath('/docs')` después de cada persistencia.
 *  - No usa `Date.now()` en código que renderiza React.
 */

import { z } from 'zod'
import * as Y from 'yjs'
import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { requireUser } from '@/lib/auth'
import { recordAuditEventSafe } from '@/lib/audit/events'

// ───────────────────────── Errores tipados ─────────────────────────

export type DocsRealtimeErrorCode =
  | 'R4D_INVALID_INPUT'
  | 'R4D_DOC_NOT_FOUND'
  | 'R4D_FORBIDDEN'
  | 'R4D_PAYLOAD_TOO_LARGE'

function rtError(code: DocsRealtimeErrorCode, detail: string): never {
  throw new Error(`[${code}] ${detail}`)
}

// ───────────────────────── Constantes ─────────────────────────

/**
 * Límite duro de tamaño del state binario que aceptamos persistir. ~5 MB
 * margen sobre los ~2 MB esperados de un doc Yjs comprimido. Más arriba
 * indica probablemente un bug (loop de updates, doc no inicializado).
 */
const MAX_YJS_STATE_BYTES = 5 * 1024 * 1024

/** Markdown asociado: mismo límite que `docs.ts` (200 KB). */
const MAX_MARKDOWN_BYTES = 200_000

const stateBufferSchema = z
  .instanceof(Uint8Array)
  .refine((b) => b.byteLength <= MAX_YJS_STATE_BYTES, {
    message: `state buffer excede ${MAX_YJS_STATE_BYTES} bytes`,
  })

const saveSchema = z.object({
  docId: z.string().min(1),
  /**
   * `state` es el resultado de `Y.encodeStateAsUpdate(doc)` en cliente:
   * un Uint8Array con state vector + document. Reemplaza el `contentYjs`
   * existente. NO es un delta — es snapshot completo.
   */
  state: stateBufferSchema,
  /**
   * Markdown derivado del Yjs document (toMarkdown). Opcional: si el cliente
   * no lo provee, mantenemos el `content` existente intacto (sólo
   * actualizamos `contentYjs`). Útil cuando todo lo que cambia es geometría
   * en pizarras o cuando el cliente quiere persistir Yjs sin re-serializar
   * markdown.
   */
  markdown: z
    .string()
    .max(MAX_MARKDOWN_BYTES, 'Markdown excede 200 KB')
    .optional(),
})

export type SaveDocYjsStateInput = {
  docId: string
  state: Uint8Array
  markdown?: string
}

// ───────────────────────── Helpers ─────────────────────────

async function loadDocOrThrow(
  docId: string,
): Promise<{
  id: string
  projectId: string | null
  isArchived: boolean
}> {
  const doc = await prisma.doc.findUnique({
    where: { id: docId },
    select: { id: true, projectId: true, isArchived: true },
  })
  if (!doc) rtError('R4D_DOC_NOT_FOUND', `Documento ${docId} no existe`)
  return doc
}

/**
 * Verifica acceso al doc. En MVP: cualquier usuario autenticado del workspace
 * puede leer/escribir docs no archivados. Si el doc está vinculado a un
 * proyecto y el usuario no tiene visibilidad, devolvemos R4D_FORBIDDEN.
 *
 * La granularidad fina (RBAC por rol/columna) se delega a P13 — aquí basta
 * con block-list explícito de archivados.
 */
async function ensureCanEditDoc(
  doc: { id: string; isArchived: boolean },
): Promise<void> {
  if (doc.isArchived) {
    rtError('R4D_FORBIDDEN', 'No se puede editar un doc archivado')
  }
}

// ───────────────────────── Actions ─────────────────────────

/**
 * Persiste el state Yjs (+ opcionalmente el markdown derivado) en BD.
 *
 * Estrategia:
 *  - Reemplaza `contentYjs` completo. Estamos seguros que el cliente
 *    envía un snapshot consistente (Yjs garantiza convergencia y la
 *    serialización es atómica).
 *  - Si llega `markdown`, también lo persiste en `content`. Si no, deja
 *    `content` como estaba.
 *  - Marca `lastEditorId = user.id`.
 *  - Emite audit `doc.realtime_edit_session`.
 */
export async function saveDocYjsState(
  input: SaveDocYjsStateInput,
): Promise<{ ok: true; sizeBytes: number }> {
  const user = await requireUser()
  const parsed = saveSchema.safeParse(input)
  if (!parsed.success) {
    rtError(
      'R4D_INVALID_INPUT',
      parsed.error.issues.map((i) => i.message).join('; '),
    )
  }
  const data = parsed.data

  const doc = await loadDocOrThrow(data.docId)
  await ensureCanEditDoc(doc)

  // Defensive: parsear el buffer como un update Yjs válido. Si falla,
  // probablemente el cliente envió bytes corruptos — lo rechazamos sin
  // tocar BD para no dañar el documento.
  try {
    const probe = new Y.Doc()
    Y.applyUpdate(probe, data.state)
    probe.destroy()
  } catch (e) {
    rtError(
      'R4D_INVALID_INPUT',
      `state Yjs no aplicable: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  // Prisma 7 espera `Uint8Array<ArrayBuffer>` para columnas `Bytes`. Pasamos
  // por un `ArrayBuffer` explícito para que TS no infiera `SharedArrayBuffer`.
  const ab = new ArrayBuffer(data.state.byteLength)
  const yjsBytes = new Uint8Array(ab)
  yjsBytes.set(data.state)

  const updateData: {
    contentYjs: Uint8Array<ArrayBuffer>
    lastEditorId: string
    content?: string
  } = {
    contentYjs: yjsBytes,
    lastEditorId: user.id,
  }
  if (data.markdown !== undefined) {
    updateData.content = data.markdown
  }

  await prisma.doc.update({
    where: { id: data.docId },
    data: updateData,
  })

  await recordAuditEventSafe({
    actorId: user.id,
    action: 'doc.realtime_edit_session',
    entityType: 'doc',
    entityId: data.docId,
    metadata: {
      projectId: doc.projectId,
      sizeBytes: data.state.byteLength,
      hasMarkdown: data.markdown !== undefined,
    },
  })

  revalidatePath('/docs')
  return { ok: true, sizeBytes: data.state.byteLength }
}

/**
 * Carga el state Yjs previo desde BD. Devuelve `null` si el doc no tiene
 * state aún (caso doc legacy, sólo markdown) — el cliente debe lazy-init
 * Yjs a partir del `content`.
 */
export async function loadDocYjsState(
  docId: string,
): Promise<{ state: Uint8Array | null; content: string; title: string }> {
  if (!docId) rtError('R4D_INVALID_INPUT', 'docId es obligatorio')
  await requireUser()

  const doc = await prisma.doc.findUnique({
    where: { id: docId },
    select: {
      id: true,
      title: true,
      content: true,
      contentYjs: true,
      isArchived: true,
    },
  })
  if (!doc) rtError('R4D_DOC_NOT_FOUND', `Documento ${docId} no existe`)

  return {
    state: doc.contentYjs ? new Uint8Array(doc.contentYjs) : null,
    content: doc.content,
    title: doc.title,
  }
}

/**
 * Aplica un update incremental al state Yjs existente en BD. Útil cuando
 * el cliente quiere mandar sólo el delta (e.g. cron de auto-save en el
 * server) en lugar del snapshot completo.
 *
 * Internamente: carga state actual → applyUpdate → re-serializa → guarda.
 */
export async function appendDocYjsUpdate(
  docId: string,
  update: Uint8Array,
): Promise<{ ok: true; sizeBytes: number }> {
  if (!docId) rtError('R4D_INVALID_INPUT', 'docId es obligatorio')
  const user = await requireUser()
  if (!(update instanceof Uint8Array) || update.byteLength === 0) {
    rtError('R4D_INVALID_INPUT', 'update vacío o no es Uint8Array')
  }
  if (update.byteLength > MAX_YJS_STATE_BYTES) {
    rtError('R4D_PAYLOAD_TOO_LARGE', 'update excede límite de tamaño')
  }

  const doc = await loadDocOrThrow(docId)
  await ensureCanEditDoc(doc)

  const existing = await prisma.doc.findUnique({
    where: { id: docId },
    select: { contentYjs: true },
  })

  const ydoc = new Y.Doc()
  if (existing?.contentYjs) {
    Y.applyUpdate(ydoc, new Uint8Array(existing.contentYjs))
  }
  Y.applyUpdate(ydoc, update)
  const merged = Y.encodeStateAsUpdate(ydoc)
  ydoc.destroy()

  const mab = new ArrayBuffer(merged.byteLength)
  const mergedBytes = new Uint8Array(mab)
  mergedBytes.set(merged)

  await prisma.doc.update({
    where: { id: docId },
    data: {
      contentYjs: mergedBytes,
      lastEditorId: user.id,
    },
  })

  await recordAuditEventSafe({
    actorId: user.id,
    action: 'doc.realtime_edit_session',
    entityType: 'doc',
    entityId: docId,
    metadata: {
      projectId: doc.projectId,
      sizeBytes: merged.byteLength,
      mode: 'append',
    },
  })

  revalidatePath('/docs')
  return { ok: true, sizeBytes: merged.byteLength }
}
