'use client'

/**
 * Wave P7 · Equipo P7-2 · WBS Generator — Modal "Generar WBS con IA".
 *
 * Estados del flujo:
 *   - idle        → textarea + botón "Generar".
 *   - generating  → botón deshabilitado, spinner.
 *   - preview     → muestra árbol del WBS + botones "Aplicar" / "Descartar".
 *   - applying    → botón deshabilitado mientras persiste.
 *   - done        → mensaje de éxito + link al proyecto creado.
 *
 * El componente NO importa Prisma ni Server Actions directamente fuera del
 * import top-level: las llamadas se hacen dentro de `useTransition` para
 * cumplir con React 19. Strings ES, sin emojis, sin colores hardcoded
 * fuera del sistema de diseño existente del repo.
 */

import { useState, useTransition, useId } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Sparkles, X as CloseIcon, Loader2, ChevronRight, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { generateWBSFromBrief, type GenerateWBSResult } from '@/lib/actions/wbs-generator'
import { applyGeneratedWBS } from '@/lib/actions/wbs-import'
import type { WBSTask } from '@/lib/ai/wbs/wbs-schema'

type Phase = 'idle' | 'generating' | 'preview' | 'applying' | 'done' | 'error'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Si se pasa, el WBS se aplica al proyecto existente (no crea uno nuevo). */
  targetProjectId?: string
}

export function WBSGeneratorDialog({
  open,
  onOpenChange,
  targetProjectId,
}: Props): React.JSX.Element {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [phase, setPhase] = useState<Phase>('idle')
  const [brief, setBrief] = useState('')
  const [projectName, setProjectName] = useState('')
  const [teamSize, setTeamSize] = useState<number | ''>('')
  const [result, setResult] = useState<GenerateWBSResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)
  const briefId = useId()
  const nameId = useId()
  const teamId = useId()

  function reset(): void {
    setPhase('idle')
    setBrief('')
    setProjectName('')
    setTeamSize('')
    setResult(null)
    setError(null)
    setCreatedProjectId(null)
  }

  function handleClose(): void {
    if (pending) return
    reset()
    onOpenChange(false)
  }

  function handleGenerate(): void {
    if (brief.trim().length < 10) {
      setError('El brief debe tener al menos 10 caracteres.')
      return
    }
    setError(null)
    setPhase('generating')
    startTransition(async () => {
      try {
        const res = await generateWBSFromBrief({
          brief,
          projectName: projectName.trim() || undefined,
          teamSize: typeof teamSize === 'number' ? teamSize : undefined,
        })
        setResult(res)
        setPhase('preview')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error inesperado'
        setError(msg)
        setPhase('error')
      }
    })
  }

  function handleApply(): void {
    if (!result) return
    setError(null)
    setPhase('applying')
    startTransition(async () => {
      try {
        const applied = await applyGeneratedWBS({
          wbs: result.wbs,
          projectId: targetProjectId,
        })
        setCreatedProjectId(applied.projectId)
        setPhase('done')
        router.refresh()
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error inesperado'
        setError(msg)
        setPhase('error')
      }
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : handleClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-40" />
        <Dialog.Content
          data-testid="wbs-generator-dialog"
          className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(720px,92vw)] max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-2xl"
        >
          <div className="flex items-start justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-indigo-500" aria-hidden />
              Generar WBS con IA
            </Dialog.Title>
            <Dialog.Close
              className="text-muted-foreground hover:text-foreground"
              aria-label="Cerrar"
            >
              <CloseIcon className="h-5 w-5" />
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-muted-foreground mb-4">
            Describe el proyecto en 1-2 párrafos. La IA generará una estructura
            jerárquica de fases, tareas, dependencias y estimaciones que podrás
            revisar antes de aplicar.
          </Dialog.Description>

          {(phase === 'idle' || phase === 'error') && (
            <div className="space-y-4">
              <div>
                <label htmlFor={nameId} className="block text-xs font-medium text-muted-foreground mb-1">
                  Nombre del proyecto (opcional)
                </label>
                <input
                  id={nameId}
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Ej. Implementación de CRM"
                  maxLength={100}
                  className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor={teamId} className="block text-xs font-medium text-muted-foreground mb-1">
                  Tamaño del equipo (opcional)
                </label>
                <input
                  id={teamId}
                  type="number"
                  min={1}
                  max={500}
                  value={teamSize}
                  onChange={(e) => setTeamSize(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="5"
                  className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor={briefId} className="block text-xs font-medium text-muted-foreground mb-1">
                  Brief del proyecto <span className="text-red-500">*</span>
                </label>
                <textarea
                  id={briefId}
                  rows={10}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  maxLength={2000}
                  placeholder="Necesito implementar un nuevo CRM con módulos de ventas, marketing y soporte. Deadline: 3 meses, equipo de 5 personas..."
                  className="w-full rounded-md border border-border bg-background py-2 px-3 text-sm text-foreground focus:border-indigo-500 focus:outline-none resize-y"
                />
                <p className="mt-1 text-[11px] text-muted-foreground text-right">
                  {brief.length} / 2000
                </p>
              </div>

              {error && (
                <p role="alert" className="text-xs text-red-500">{error}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-subtle"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={pending || brief.trim().length < 10}
                  className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Generar
                </button>
              </div>
            </div>
          )}

          {phase === 'generating' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3" role="status">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" aria-hidden />
              <p className="text-sm text-muted-foreground">Generando WBS… esto puede tomar unos segundos.</p>
            </div>
          )}

          {phase === 'preview' && result && (
            <WBSPreview
              result={result}
              onApply={handleApply}
              onDiscard={() => {
                setResult(null)
                setPhase('idle')
              }}
              applying={false}
            />
          )}

          {phase === 'applying' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3" role="status">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" aria-hidden />
              <p className="text-sm text-muted-foreground">Aplicando al proyecto…</p>
            </div>
          )}

          {phase === 'done' && (
            <div className="space-y-4">
              <p className="text-sm text-foreground">WBS aplicado exitosamente.</p>
              {createdProjectId && !targetProjectId && (
                <p className="text-xs text-muted-foreground">
                  Se creó un nuevo proyecto. Recarga la lista para verlo.
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─────────────────────────── Preview tree ─────────────────────────────

interface PreviewProps {
  result: GenerateWBSResult
  onApply: () => void
  onDiscard: () => void
  applying: boolean
}

function WBSPreview({ result, onApply, onDiscard, applying }: PreviewProps): React.JSX.Element {
  const { wbs, source, warnings, llmError, templateId } = result
  return (
    <div className="space-y-4" data-testid="wbs-preview">
      <div className="rounded-md border border-border bg-subtle/40 px-3 py-2 text-xs text-foreground space-y-1">
        <div>
          <span className="font-medium">Fuente:</span>{' '}
          {source === 'llm' ? 'LLM (modelo de IA)' : `Heurística (${templateId ?? 'default'})`}
        </div>
        <div>
          <span className="font-medium">Proyecto:</span> {wbs.projectName}
        </div>
        <div>
          <span className="font-medium">Duración estimada:</span>{' '}
          {wbs.estimatedDurationDays} días
        </div>
        {llmError && (
          <p className="text-amber-500">LLM falló, se usó fallback: {llmError}</p>
        )}
        {warnings.length > 0 && (
          <details>
            <summary className="cursor-pointer text-amber-500">
              {warnings.length} advertencia(s)
            </summary>
            <ul className="ml-4 list-disc">
              {warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border p-3">
        {wbs.phases.map((phase, pIdx) => (
          <div key={pIdx} className="mb-3">
            <h4 className="text-sm font-semibold text-indigo-400">
              {phase.order + 1}. {phase.name}
            </h4>
            <ul className="mt-1 ml-2 space-y-0.5">
              {phase.tasks.map((task, tIdx) => (
                <PreviewTaskNode key={tIdx} task={task} depth={0} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={applying}
          className="rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-subtle disabled:opacity-50"
        >
          Descartar
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={applying}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Aplicar a proyecto
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────── Trigger button ──────────────────────────

/**
 * Botón "Generar WBS con IA" + montaje del dialog. Pensado para incluirse
 * desde un Server Component (la página `/projects`) sin tener que crear
 * otro componente cliente extra.
 */
export function WBSGeneratorTrigger(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        data-testid="wbs-generator-trigger"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Generar WBS con IA
      </button>
      <WBSGeneratorDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

interface NodeProps {
  task: WBSTask
  depth: number
}

function PreviewTaskNode({ task, depth }: NodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = !!task.children?.length
  return (
    <li>
      <div
        className="flex items-start gap-1 text-xs text-foreground"
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground mt-0.5"
            aria-label={expanded ? 'Contraer' : 'Expandir'}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="inline-block w-3.5" aria-hidden />
        )}
        <span className="font-medium">{task.title}</span>
        <span className="text-muted-foreground">
          · {task.estimatedDays}d · {task.priority}
        </span>
        {task.dependsOn?.length ? (
          <span className="text-amber-500">⇽ {task.dependsOn.join(', ')}</span>
        ) : null}
      </div>
      {hasChildren && expanded && (
        <ul className="mt-0.5 space-y-0.5">
          {task.children?.map((c, idx) => (
            <PreviewTaskNode key={idx} task={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
