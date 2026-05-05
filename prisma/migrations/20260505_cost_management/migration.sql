-- 2026-05-05 · @DBA · Ola P8 / Equipo P8-3 — Cost Management.
--
-- Crea las tablas `Expense` y `CurrencyRate` y extiende `Project`, `Phase`
-- y `Sprint` con campos de presupuesto (`budget`, `budgetCurrency`).
--
-- Aplicación (convención del repo · ver project_followupgantt_tech):
--   1. Local:    psql $DATABASE_URL -f prisma/migrations/20260505_cost_management/migration.sql
--   2. Supabase: pegar este archivo en el SQL Editor del dashboard.
--   3. Alternativa: npx prisma db push (toma TODOS los cambios del schema).
--
-- Idempotente: usa `IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`,
-- `ADD COLUMN IF NOT EXISTS` y `DO $$ ... $$` para enums. Re-ejecutar
-- es no-op.

-- ─── Enum: ExpenseStatus ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExpenseStatus') THEN
    CREATE TYPE "ExpenseStatus" AS ENUM (
      'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'REIMBURSED'
    );
  END IF;
END$$;

-- ─── Tabla: Expense ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Expense" (
  "id"             TEXT NOT NULL,
  "projectId"      TEXT NOT NULL,
  "taskId"         TEXT,
  "submittedById"  TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "amount"         DECIMAL(12, 2) NOT NULL,
  "currency"       TEXT NOT NULL,
  "amountUsd"      DECIMAL(12, 2),
  "receiptUrl"     TEXT,
  "status"         "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
  "approvedById"   TEXT,
  "approvedAt"     TIMESTAMP(3),
  "reimbursedAt"   TIMESTAMP(3),
  "rejectedReason" TEXT,
  "incurredAt"     TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Expense_projectId_status_idx"
  ON "Expense" ("projectId", "status");
CREATE INDEX IF NOT EXISTS "Expense_submittedById_createdAt_idx"
  ON "Expense" ("submittedById", "createdAt");
CREATE INDEX IF NOT EXISTS "Expense_incurredAt_idx"
  ON "Expense" ("incurredAt");

ALTER TABLE "Expense"
  DROP CONSTRAINT IF EXISTS "Expense_projectId_fkey",
  ADD CONSTRAINT "Expense_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Expense"
  DROP CONSTRAINT IF EXISTS "Expense_taskId_fkey",
  ADD CONSTRAINT "Expense_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "Task"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Expense"
  DROP CONSTRAINT IF EXISTS "Expense_submittedById_fkey",
  ADD CONSTRAINT "Expense_submittedById_fkey"
    FOREIGN KEY ("submittedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Expense"
  DROP CONSTRAINT IF EXISTS "Expense_approvedById_fkey",
  ADD CONSTRAINT "Expense_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Tabla: CurrencyRate ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CurrencyRate" (
  "id"        TEXT NOT NULL,
  "base"      TEXT NOT NULL,
  "quote"     TEXT NOT NULL,
  "rate"      DECIMAL(18, 8) NOT NULL,
  "source"    TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CurrencyRate_base_quote_fetchedAt_key"
  ON "CurrencyRate" ("base", "quote", "fetchedAt");

CREATE INDEX IF NOT EXISTS "CurrencyRate_base_quote_fetchedAt_idx"
  ON "CurrencyRate" ("base", "quote", "fetchedAt" DESC);

-- ─── Extensión: Project.budget / Project.budgetCurrency ───────────
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "budget" DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS "budgetCurrency" TEXT;

-- ─── Extensión: Phase.budget / Phase.budgetCurrency ───────────────
ALTER TABLE "Phase"
  ADD COLUMN IF NOT EXISTS "budget" DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS "budgetCurrency" TEXT;

-- ─── Extensión: Sprint.budget / Sprint.budgetCurrency ─────────────
ALTER TABLE "Sprint"
  ADD COLUMN IF NOT EXISTS "budget" DECIMAL(14, 2),
  ADD COLUMN IF NOT EXISTS "budgetCurrency" TEXT;
