-- Wave R4-E · Monetización SaaS externa (Stripe).
-- Migración idempotente: usa IF NOT EXISTS / IF EXISTS para tolerar reaplicación.

-- 1. Campos adicionales sobre Workspace (Brain quota + onboarding flag).
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "brainCallsThisMonth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "brainCallsResetAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

-- 2. BillingSubscription (1-1 con Workspace).
CREATE TABLE IF NOT EXISTS "BillingSubscription" (
    "id"                   TEXT NOT NULL,
    "workspaceId"          TEXT NOT NULL,
    "stripeCustomerId"     TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId"        TEXT,
    "tier"                 TEXT NOT NULL DEFAULT 'FREE',
    "status"               TEXT NOT NULL DEFAULT 'active',
    "currentPeriodEnd"     TIMESTAMP(3),
    "cancelAt"             TIMESTAMP(3),
    "trialEndsAt"          TIMESTAMP(3),
    "seats"                INTEGER NOT NULL DEFAULT 1,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingSubscription_workspaceId_key"
    ON "BillingSubscription"("workspaceId");

CREATE UNIQUE INDEX IF NOT EXISTS "BillingSubscription_stripeSubscriptionId_key"
    ON "BillingSubscription"("stripeSubscriptionId");

CREATE INDEX IF NOT EXISTS "BillingSubscription_stripeCustomerId_idx"
    ON "BillingSubscription"("stripeCustomerId");

CREATE INDEX IF NOT EXISTS "BillingSubscription_status_idx"
    ON "BillingSubscription"("status");

-- FK con cascade (idempotente vía bloque DO).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BillingSubscription_workspaceId_fkey'
    ) THEN
        ALTER TABLE "BillingSubscription"
            ADD CONSTRAINT "BillingSubscription_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. BillingInvoice (histórico de facturas Stripe).
CREATE TABLE IF NOT EXISTS "BillingInvoice" (
    "id"              TEXT NOT NULL,
    "workspaceId"     TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amountCents"     INTEGER NOT NULL,
    "currency"        TEXT NOT NULL DEFAULT 'usd',
    "status"          TEXT NOT NULL,
    "invoicePdfUrl"   TEXT,
    "periodStart"     TIMESTAMP(3) NOT NULL,
    "periodEnd"       TIMESTAMP(3) NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingInvoice_stripeInvoiceId_key"
    ON "BillingInvoice"("stripeInvoiceId");

CREATE INDEX IF NOT EXISTS "BillingInvoice_workspaceId_createdAt_idx"
    ON "BillingInvoice"("workspaceId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "BillingInvoice_status_idx"
    ON "BillingInvoice"("status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BillingInvoice_workspaceId_fkey'
    ) THEN
        ALTER TABLE "BillingInvoice"
            ADD CONSTRAINT "BillingInvoice_workspaceId_fkey"
            FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
