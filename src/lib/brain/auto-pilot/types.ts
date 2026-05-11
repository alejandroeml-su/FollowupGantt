/**
 * Wave P20-C · Brain Auto-Pilot — Tipos compartidos.
 *
 * El Auto-Pilot detecta oportunidades de optimización cross-project y las
 * expresa como `AutoPilotProposal` — un objeto autocontenido con preview
 * del antes/después + operaciones declarativas que el adapter ejecuta en
 * una transacción Prisma.
 *
 * Decisión D-P20C-1: ops declarativas (JSON) en lugar de callbacks/closures.
 *   - Permiten persistir el snapshot completo en `AutoPilotRun.proposalSnapshot`
 *     y replicarlo en QA / staging sin perder fidelidad.
 *   - Generan automaticamente las ops inversas para rollback sin que cada
 *     detector tenga que implementar su propio "undo".
 *   - Sacrifican tipado fino por trazabilidad — los tests del adapter
 *     cubren el set válido de `type`.
 *
 * Decisión D-P20C-2: confidence ∈ [0,1]. La UI filtra >= 0.6 por default.
 *   Los detectores asignan confidence en función de la fuerza de la señal
 *   (e.g. gap de carga proporcional, velocity histórica disponible, etc.).
 */

export type AutoPilotKind =
  | 'SPRINT_REBALANCE'
  | 'ASSIGNEE_REBALANCE'
  | 'SPRINT_EXTENSION'
  | 'LESSON_PROMOTION'

export type AutoPilotSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

/**
 * Operaciones declarativas que el adapter puede ejecutar. Cada op describe
 * un cambio mínimo. `targetId` siempre identifica la fila afectada en la
 * BD. Los campos extra dependen del `type`.
 */
export type AutoPilotOp =
  | {
      type: 'task.update'
      targetId: string
      patch: {
        sprintId?: string | null
        assigneeId?: string | null
      }
    }
  | {
      type: 'sprint.update'
      targetId: string
      patch: {
        endDate?: string
      }
    }
  | {
      type: 'workspace.upsert_global_template'
      /// uuid pre-calculado para la fila destino — permite que rollback
      /// dispare el delete contra ese id sin re-buscar.
      targetId: string
      workspaceId: string
      payload: {
        name: string
        /// Subconjunto de `GlobalTemplateKind` que el Auto-Pilot puede emitir.
        /// Solo categorías "documentales" (no estructurales) para evitar que
        /// un proposal cree templates que muten la jerarquía del workspace.
        kind: 'PROJECT' | 'DOR_DOD' | 'COMM_PLAN' | 'WBS'
        body: Record<string, unknown>
      }
    }

/**
 * Resumen del estado relevante antes/después del apply. Lo usa la UI
 * para renderizar las dos columnas de la card y validar que el cambio
 * coincide con la expectativa del proposal.
 */
export interface AutoPilotPreview {
  before: Record<string, string | number | null>
  after: Record<string, string | number | null>
}

export interface AutoPilotProposal {
  id: string
  kind: AutoPilotKind
  severity: AutoPilotSeverity
  summary: string
  rationale: string
  preview: AutoPilotPreview
  applyOps: AutoPilotOp[]
  confidence: number
}

// ─── Inputs sintéticos para los detectores ─────────────────────────

export interface AutoPilotSprintInput {
  id: string
  name: string
  projectId: string
  projectName: string
  endDate: string
  capacity: number | null
  /// Velocity histórica (P50) del proyecto al cierre del último sprint.
  /// Si null, no se puede proponer extensión basada en histórico.
  velocityP50: number | null
}

export interface AutoPilotTaskInput {
  id: string
  title: string
  projectId: string
  sprintId: string | null
  assigneeId: string | null
  storyPoints: number | null
  status: string
}

export interface AutoPilotUserSkillInput {
  userId: string
  userName: string
  skillIds: string[]
  /// Carga actual (story points abiertos sumados de todos los proyectos).
  currentLoad: number
}

export interface AutoPilotLessonInput {
  id: string
  projectId: string
  projectName: string
  workspaceId: string
  category: string
  title: string
  recommendation: string
  capturedAt: string
}

export interface AutoPilotDetectorInput {
  sprints: AutoPilotSprintInput[]
  tasks: AutoPilotTaskInput[]
  users: AutoPilotUserSkillInput[]
  lessons: AutoPilotLessonInput[]
  workspaceId: string | null
}

// ─── Snapshot persistido en AutoPilotRun ───────────────────────────

export interface AutoPilotRunRow {
  id: string
  workspaceId: string
  kind: AutoPilotKind
  summary: string
  proposalSnapshot: AutoPilotProposal
  appliedById: string | null
  appliedByName: string | null
  appliedAt: string
  rolledBackAt: string | null
  rollbackOps: AutoPilotOp[] | null
}
