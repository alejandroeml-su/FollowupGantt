-- ─────────────────────────────────────────────────────────────────────
-- US-9.2 · Wave R5 — Gap Analysis (AS-IS vs TO-BE)
--
-- Migración SQL pendiente · NO aplicada todavía.
--
-- Aplicar a Supabase prod vía MCP (`mcp__claude_ai_Supabase__apply_migration`)
-- una vez Edwin autorice. Project ID: bpiugqsjnlwqfhbnkirh.
--
-- Modelos agregados:
--   - GapAnalysis        (análisis por proyecto · DRAFT/IN_PROGRESS/COMPLETED)
--   - GapDimension       (dimensión AUTO/MANUAL con AS-IS / TO-BE)
--   - GapDimensionAction (plan de acción · task o texto libre)
--
-- Tablas/enums tocadas: 3 nuevas tablas + 3 nuevos enums.
-- Tablas existentes referenciadas (FK): Project, User, Task.
-- ─────────────────────────────────────────────────────────────────────

-- ──────────────── Enums ────────────────

CREATE TYPE "GapAnalysisStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED');

CREATE TYPE "GapDimensionKind" AS ENUM ('AUTO', 'MANUAL');

CREATE TYPE "GapDimensionActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');

-- ──────────────── GapAnalysis ────────────────

CREATE TABLE "GapAnalysis" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetDate" TIMESTAMP(3),
    "status" "GapAnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GapAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GapAnalysis_projectId_status_idx" ON "GapAnalysis"("projectId", "status");

CREATE INDEX "GapAnalysis_createdById_idx" ON "GapAnalysis"("createdById");

ALTER TABLE "GapAnalysis"
    ADD CONSTRAINT "GapAnalysis_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GapAnalysis"
    ADD CONSTRAINT "GapAnalysis_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────── GapDimension ────────────────

CREATE TABLE "GapDimension" (
    "id" TEXT NOT NULL,
    "gapAnalysisId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "kind" "GapDimensionKind" NOT NULL DEFAULT 'MANUAL',
    "metricKey" TEXT,
    "asIsValue" DOUBLE PRECISION,
    "toBeValue" DOUBLE PRECISION,
    "unit" TEXT,
    "weight" INTEGER,
    "notes" TEXT,
    "metricMetadata" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GapDimension_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GapDimension_gapAnalysisId_position_idx" ON "GapDimension"("gapAnalysisId", "position");

CREATE INDEX "GapDimension_kind_metricKey_idx" ON "GapDimension"("kind", "metricKey");

ALTER TABLE "GapDimension"
    ADD CONSTRAINT "GapDimension_gapAnalysisId_fkey"
    FOREIGN KEY ("gapAnalysisId") REFERENCES "GapAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────── GapDimensionAction ────────────────

CREATE TABLE "GapDimensionAction" (
    "id" TEXT NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "taskId" TEXT,
    "freeText" TEXT,
    "status" "GapDimensionActionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GapDimensionAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GapDimensionAction_dimensionId_status_idx" ON "GapDimensionAction"("dimensionId", "status");

CREATE INDEX "GapDimensionAction_taskId_idx" ON "GapDimensionAction"("taskId");

ALTER TABLE "GapDimensionAction"
    ADD CONSTRAINT "GapDimensionAction_dimensionId_fkey"
    FOREIGN KEY ("dimensionId") REFERENCES "GapDimension"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GapDimensionAction"
    ADD CONSTRAINT "GapDimensionAction_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────── RLS (deuda registrada · activar luego) ────────────────
--
-- A pesar de tener RLS hardening 100% en R4 (PR #208), las tablas de
-- Gap Analysis NO se incluyen en este patch para mantener este migration
-- atómico. Activar policies en una segunda fase replicando el patrón de
-- Risk y QualityInspection: visibilidad transitiva vía `Project`.
--
--   ALTER TABLE "GapAnalysis" ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE "GapDimension" ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE "GapDimensionAction" ENABLE ROW LEVEL SECURITY;
--
-- En el meantime las server actions enforce RBAC vía
-- `requireProjectAccess(projectId)` y `getProjectAccessFilter`.
