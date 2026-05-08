-- Wave P11-PMI · PMBOK 6/7 compliance modules.
-- Aplicar via: npx prisma migrate deploy · o Supabase MCP apply_migration.

-- Project Charter (HU-12.1) — Json field
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "charter" JSONB;
COMMENT ON COLUMN "Project"."charter" IS
  'Wave P11-PMI (HU-12.1) Project Charter. Shape: { vision, businessJustification, successCriteria[], milestones[], approvedAt, approvedBy, version }';

-- ── Stakeholder Register (HU-12.2) ──────────────────────────
DO $$ BEGIN
  CREATE TYPE "StakeholderLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "StakeholderInfluence" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "Stakeholder" (
  "id"                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "projectId"          TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "name"               TEXT NOT NULL,
  "organization"       TEXT,
  "email"              TEXT,
  "role"               TEXT NOT NULL,
  "power"              "StakeholderLevel" NOT NULL DEFAULT 'MEDIUM',
  "interest"           "StakeholderLevel" NOT NULL DEFAULT 'MEDIUM',
  "influence"          "StakeholderInfluence" NOT NULL DEFAULT 'NEUTRAL',
  "expectations"       TEXT,
  "engagementStrategy" TEXT,
  "notes"              TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Stakeholder_projectId_idx" ON "Stakeholder"("projectId");
CREATE INDEX IF NOT EXISTS "Stakeholder_projectId_power_interest_idx"
  ON "Stakeholder"("projectId", "power", "interest");
ALTER TABLE "Stakeholder" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "stakeholder_all" ON "Stakeholder";
CREATE POLICY "stakeholder_all" ON "Stakeholder" FOR ALL USING (true) WITH CHECK (true);

-- ── Change Request workflow / CCB (HU-12.3) ─────────────────
DO $$ BEGIN
  CREATE TYPE "ChangeRequestStatus" AS ENUM
    ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED', 'IMPLEMENTED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ChangeImpactLevel" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ChangeRequest" (
  "id"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "projectId"        TEXT NOT NULL REFERENCES "Project"("id") ON DELETE CASCADE,
  "title"            TEXT NOT NULL,
  "description"      TEXT NOT NULL,
  "rationale"        TEXT,
  "requestedById"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "impactScope"      "ChangeImpactLevel" NOT NULL DEFAULT 'NONE',
  "impactSchedule"   "ChangeImpactLevel" NOT NULL DEFAULT 'NONE',
  "impactCost"       "ChangeImpactLevel" NOT NULL DEFAULT 'NONE',
  "impactQuality"    "ChangeImpactLevel" NOT NULL DEFAULT 'NONE',
  "estimatedCostDelta"         DECIMAL(14, 2),
  "estimatedScheduleDeltaDays" INTEGER,
  "status"           "ChangeRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
  "decidedAt"        TIMESTAMP(3),
  "decidedById"      TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "decisionNotes"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "ChangeRequest_projectId_status_idx"
  ON "ChangeRequest"("projectId", "status");
CREATE INDEX IF NOT EXISTS "ChangeRequest_requestedById_idx"
  ON "ChangeRequest"("requestedById");
ALTER TABLE "ChangeRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "change_request_all" ON "ChangeRequest";
CREATE POLICY "change_request_all" ON "ChangeRequest" FOR ALL USING (true) WITH CHECK (true);

-- ── Procurement (HU-12.4) ───────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ContractType" AS ENUM ('FFP', 'CPFF', 'TM', 'CR');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'TERMINATED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "POStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "Vendor" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "workspaceId"   TEXT REFERENCES "Workspace"("id") ON DELETE SET NULL,
  "name"          TEXT NOT NULL,
  "contactPerson" TEXT,
  "contactEmail"  TEXT,
  "taxId"         TEXT,
  "notes"         TEXT,
  "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Vendor_workspaceId_isActive_idx"
  ON "Vendor"("workspaceId", "isActive");
ALTER TABLE "Vendor" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "vendor_all" ON "Vendor";
CREATE POLICY "vendor_all" ON "Vendor" FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "Contract" (
  "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "vendorId"     TEXT NOT NULL REFERENCES "Vendor"("id") ON DELETE RESTRICT,
  "projectId"    TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
  "title"        TEXT NOT NULL,
  "contractType" "ContractType" NOT NULL DEFAULT 'FFP',
  "totalValue"   DECIMAL(14, 2),
  "currency"     TEXT NOT NULL DEFAULT 'USD',
  "startDate"    TIMESTAMP(3),
  "endDate"      TIMESTAMP(3),
  "status"       "ContractStatus" NOT NULL DEFAULT 'DRAFT',
  "description"  TEXT,
  "documentUrl"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Contract_vendorId_status_idx" ON "Contract"("vendorId", "status");
CREATE INDEX IF NOT EXISTS "Contract_projectId_idx" ON "Contract"("projectId");
ALTER TABLE "Contract" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "contract_all" ON "Contract";
CREATE POLICY "contract_all" ON "Contract" FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
  "id"                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  "vendorId"            TEXT NOT NULL REFERENCES "Vendor"("id") ON DELETE RESTRICT,
  "contractId"          TEXT REFERENCES "Contract"("id") ON DELETE SET NULL,
  "projectId"           TEXT REFERENCES "Project"("id") ON DELETE SET NULL,
  "poNumber"            TEXT NOT NULL UNIQUE,
  "description"         TEXT NOT NULL,
  "amount"              DECIMAL(14, 2) NOT NULL,
  "currency"            TEXT NOT NULL DEFAULT 'USD',
  "issuedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expectedDeliveryAt"  TIMESTAMP(3),
  "receivedAt"          TIMESTAMP(3),
  "status"              "POStatus" NOT NULL DEFAULT 'DRAFT',
  "notes"               TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PurchaseOrder_vendorId_status_idx" ON "PurchaseOrder"("vendorId", "status");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_projectId_idx" ON "PurchaseOrder"("projectId");
CREATE INDEX IF NOT EXISTS "PurchaseOrder_contractId_idx" ON "PurchaseOrder"("contractId");
ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "po_all" ON "PurchaseOrder";
CREATE POLICY "po_all" ON "PurchaseOrder" FOR ALL USING (true) WITH CHECK (true);
