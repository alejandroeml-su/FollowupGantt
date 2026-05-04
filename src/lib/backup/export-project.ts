import 'server-only'

/**
 * P3-3 · Backup full de proyecto a ZIP.
 *
 * Recopila TODA la data del proyecto de la BD y la empaqueta como ZIP
 * con un único archivo `manifest.json` (schemaVersion=1). Diseñado para
 * ser idempotente: dos exports consecutivos del mismo proyecto producen
 * manifests equivalentes salvo `exportedAt`.
 *
 * Se mantiene desacoplado del server action (`backup-restore.ts`) para
 * que sea fácilmente testeable: la función recibe `prismaLike` por
 * inyección y devuelve el ZIP como Buffer.
 *
 * Convenciones:
 *   - Strings ASCII-safe en el filename (slug del proyecto + fecha).
 *   - Errores tipados `[NOT_FOUND] proyecto inexistente`.
 *   - No se incluye contenido de attachments (solo metadata `url`); el
 *     binario vive en almacenamiento externo y la URL es self-contained.
 */

import JSZip from 'jszip'
import {
  CURRENT_SCHEMA_VERSION,
  MANIFEST_FILENAME,
  type Manifest,
  type ManifestAttachment,
  type ManifestBaseline,
  type ManifestBoardColumn,
  type ManifestComment,
  type ManifestCustomFieldDef,
  type ManifestCustomFieldValue,
  type ManifestDependency,
  type ManifestMindMap,
  type ManifestPhase,
  type ManifestProject,
  type ManifestSprint,
  type ManifestTask,
} from './manifest-schema'

// ───────────────────────── Tipos del prisma-like ─────────────────────────

/**
 * Subset mínimo del PrismaClient consumido por el export. Permite
 * inyectar mocks en tests sin requerir la transacción real ni los
 * adapters de pg.
 */
export interface PrismaLikeForExport {
  project: {
    findUnique: (args: {
      where: { id: string }
      select?: unknown
      include?: unknown
    }) => Promise<unknown>
  }
  phase: { findMany: (args: unknown) => Promise<unknown[]> }
  sprint: { findMany: (args: unknown) => Promise<unknown[]> }
  boardColumn: { findMany: (args: unknown) => Promise<unknown[]> }
  task: { findMany: (args: unknown) => Promise<unknown[]> }
  taskDependency: { findMany: (args: unknown) => Promise<unknown[]> }
  baseline: { findMany: (args: unknown) => Promise<unknown[]> }
  comment: { findMany: (args: unknown) => Promise<unknown[]> }
  attachment: { findMany: (args: unknown) => Promise<unknown[]> }
  customFieldDef: { findMany: (args: unknown) => Promise<unknown[]> }
  customFieldValue: { findMany: (args: unknown) => Promise<unknown[]> }
  mindMap: { findMany: (args: unknown) => Promise<unknown[]> }
}

// ───────────────────────── Helpers ─────────────────────────

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function todayIsoDate(): string {
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ───────────────────────── Builder principal ─────────────────────────

export interface ExportFullResult {
  filename: string
  mimeType: string
  payloadBase64: string
  /** Tamaño en bytes del ZIP generado (útil para tests/telemetría). */
  byteLength: number
}

/**
 * Recopila el manifest a partir de la BD. No genera el ZIP: separar el
 * paso facilita testear el shape del manifest sin el costo de comprimir.
 */
export async function buildManifestFromDb(
  prismaLike: PrismaLikeForExport,
  projectId: string,
): Promise<Manifest> {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('[INVALID_INPUT] projectId requerido')
  }

  const project = (await prismaLike.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      cpi: true,
      spi: true,
    },
  })) as ManifestProject | null

  if (!project) {
    throw new Error('[NOT_FOUND] El proyecto no existe')
  }

  // Las queries son independientes — paralelizamos para minimizar latencia.
  const [
    phases,
    sprints,
    columns,
    tasks,
    baselines,
    customFieldDefs,
    mindMaps,
  ] = await Promise.all([
    prismaLike.phase.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, order: true },
    }) as Promise<ManifestPhase[]>,
    prismaLike.sprint.findMany({
      where: { projectId },
      orderBy: { startDate: 'asc' },
      select: {
        id: true,
        name: true,
        goal: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    }) as Promise<ManifestSprint[]>,
    prismaLike.boardColumn.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
      select: { id: true, name: true, order: true, wipLimit: true },
    }) as Promise<ManifestBoardColumn[]>,
    prismaLike.task.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        mnemonic: true,
        title: true,
        description: true,
        type: true,
        status: true,
        priority: true,
        parentId: true,
        phaseId: true,
        sprintId: true,
        columnId: true,
        startDate: true,
        endDate: true,
        progress: true,
        isMilestone: true,
        slaResponseLimit: true,
        slaResolutionLimit: true,
        isEscalated: true,
        plannedValue: true,
        actualCost: true,
        earnedValue: true,
        position: true,
        archivedAt: true,
        tags: true,
        referenceUrl: true,
        assignee: { select: { email: true } },
      },
    }) as Promise<
      Array<
        Omit<ManifestTask, 'assigneeEmail'> & {
          assignee?: { email: string } | null
        }
      >
    >,
    prismaLike.baseline.findMany({
      where: { projectId },
      orderBy: { version: 'asc' },
      select: {
        id: true,
        version: true,
        label: true,
        snapshotData: true,
        createdAt: true,
      },
    }) as Promise<ManifestBaseline[]>,
    prismaLike.customFieldDef.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        key: true,
        label: true,
        type: true,
        required: true,
        defaultValue: true,
        options: true,
        position: true,
      },
    }) as Promise<ManifestCustomFieldDef[]>,
    prismaLike.mindMap.findMany({
      where: { projectId },
      include: {
        owner: { select: { email: true } },
        nodes: {
          select: {
            id: true,
            label: true,
            note: true,
            x: true,
            y: true,
            color: true,
            isRoot: true,
            taskId: true,
          },
        },
        edges: {
          select: {
            id: true,
            sourceId: true,
            targetId: true,
            label: true,
          },
        },
      },
    }) as Promise<
      Array<{
        id: string
        title: string
        description: string | null
        owner?: { email: string } | null
        nodes: ManifestMindMap['nodes']
        edges: ManifestMindMap['edges']
      }>
    >,
  ])

  // Una vez tenemos las tareas, podemos disparar las queries que dependen
  // de su lista de IDs. En paralelo para minimizar el round-trip total.
  const taskIds = tasks.map((t) => t.id)
  const [dependencies, comments, attachments, customFieldValues] =
    taskIds.length === 0
      ? [
          [] as ManifestDependency[],
          [] as ManifestComment[],
          [] as ManifestAttachment[],
          [] as ManifestCustomFieldValue[],
        ]
      : await Promise.all([
          prismaLike.taskDependency.findMany({
            where: {
              AND: [
                { predecessorId: { in: taskIds } },
                { successorId: { in: taskIds } },
              ],
            },
            select: {
              id: true,
              predecessorId: true,
              successorId: true,
              type: true,
              lagDays: true,
            },
          }) as Promise<ManifestDependency[]>,
          prismaLike.comment.findMany({
            where: { taskId: { in: taskIds } },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              taskId: true,
              content: true,
              isInternal: true,
              author: { select: { email: true } },
              createdAt: true,
            },
          }) as Promise<
            Array<
              Omit<ManifestComment, 'authorEmail'> & {
                author?: { email: string } | null
              }
            >
          >,
          prismaLike.attachment.findMany({
            where: { taskId: { in: taskIds } },
            select: {
              id: true,
              taskId: true,
              filename: true,
              url: true,
              size: true,
              mimetype: true,
              user: { select: { email: true } },
              createdAt: true,
            },
          }) as Promise<
            Array<
              Omit<ManifestAttachment, 'uploaderEmail'> & {
                user?: { email: string } | null
              }
            >
          >,
          prismaLike.customFieldValue.findMany({
            where: { taskId: { in: taskIds } },
            select: {
              id: true,
              fieldId: true,
              taskId: true,
              value: true,
            },
          }) as Promise<ManifestCustomFieldValue[]>,
        ])

  // Normalizar shape (extraer email anidado).
  // Casteamos a `any` localmente: el shape efectivo del select Prisma incluye
  // los includes anidados, pero tipar la unión exacta cruza el límite de lo
  // que ergonómicamente vale la pena para un módulo de backup.
  const tasksOut: ManifestTask[] = tasks.map((t) => {
    const raw = t as unknown as ManifestTask & { assignee?: { email: string } | null }
    const { assignee, ...rest } = raw
    return { ...rest, assigneeEmail: assignee?.email ?? null }
  })

  const commentsOut: ManifestComment[] = comments.map((c) => {
    const raw = c as unknown as ManifestComment & { author?: { email: string } | null }
    const { author, ...rest } = raw
    return { ...rest, authorEmail: author?.email ?? null }
  })

  const attachmentsOut: ManifestAttachment[] = attachments.map((a) => {
    const raw = a as unknown as ManifestAttachment & { user?: { email: string } | null }
    const { user, ...rest } = raw
    return { ...rest, uploaderEmail: user?.email ?? null }
  })

  const mindMapsOut: ManifestMindMap[] = mindMaps.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description ?? null,
    ownerEmail: m.owner?.email ?? null,
    nodes: m.nodes,
    edges: m.edges,
  }))

  const manifest: Manifest = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date(),
    source: { app: 'FollowupGantt', exporterVersion: '1.0.0' },
    project,
    phases,
    sprints,
    columns,
    tasks: tasksOut,
    dependencies,
    baselines,
    comments: commentsOut,
    attachments: attachmentsOut,
    customFieldDefs,
    customFieldValues,
    mindMaps: mindMapsOut,
    // P3-3 nota: TimeEntry no existe aún en el schema. Emitimos arreglo
    // vacío para mantener forward-compat (el shape ya está validado por
    // zod y consumible por imports futuros).
    timeEntries: [],
  }

  return manifest
}

/**
 * Build del ZIP completo a partir del proyecto. Internamente serializa
 * el manifest a JSON, lo añade al ZIP y devuelve el payload listo para
 * cliente.
 */
export async function exportProjectFullToZip(
  prismaLike: PrismaLikeForExport,
  projectId: string,
): Promise<ExportFullResult> {
  const manifest = await buildManifestFromDb(prismaLike, projectId)

  const zip = new JSZip()
  // JSON.stringify default: Date → ISO string. Forzamos indent 2 para
  // que el archivo sea diff-friendly (importante para QA y soporte).
  zip.file(MANIFEST_FILENAME, JSON.stringify(manifest, null, 2))

  // DEFLATE level 6 = balance estándar (ratio decente, CPU bajo).
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })

  const filename = `${slug(manifest.project.name) || 'proyecto'}-backup-${todayIsoDate()}.zip`

  return {
    filename,
    mimeType: 'application/zip',
    payloadBase64: buffer.toString('base64'),
    byteLength: buffer.byteLength,
  }
}
