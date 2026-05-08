'use server'

/**
 * Wave P11-PMI (HU-12.4) — Server actions Procurement (Vendor / Contract / PO).
 */

import { revalidatePath } from 'next/cache'
import prisma from '@/lib/prisma'
import { recordAuditEventSafe } from '@/lib/audit/events'

type ContractType = 'FFP' | 'CPFF' | 'TM' | 'CR'
type ContractStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'TERMINATED'
type POStatus =
  | 'DRAFT'
  | 'ISSUED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED'

function revalidateProcurement() {
  revalidatePath('/procurement')
  revalidatePath('/procurement/vendors')
  revalidatePath('/procurement/contracts')
  revalidatePath('/procurement/purchase-orders')
}

// ───────── Vendor ─────────

export async function listVendors(workspaceId?: string | null) {
  return prisma.vendor.findMany({
    where: workspaceId ? { workspaceId } : {},
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  })
}

export async function createVendor(input: {
  workspaceId?: string | null
  name: string
  contactPerson?: string | null
  contactEmail?: string | null
  taxId?: string | null
  notes?: string | null
}) {
  if (!input.name?.trim()) throw new Error('[INVALID_INPUT] name requerido')
  const created = await prisma.vendor.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      name: input.name.trim(),
      contactPerson: input.contactPerson?.trim() || null,
      contactEmail: input.contactEmail?.trim() || null,
      taxId: input.taxId?.trim() || null,
      notes: input.notes?.trim() || null,
    },
  })
  await recordAuditEventSafe({
    action: 'vendor.created',
    entityType: 'vendor',
    entityId: created.id,
    after: { name: created.name },
  })
  revalidateProcurement()
  return created
}

export async function deactivateVendor(id: string) {
  if (!id) throw new Error('[INVALID_INPUT] id requerido')
  await prisma.vendor.update({ where: { id }, data: { isActive: false } })
  await recordAuditEventSafe({
    action: 'vendor.deactivated',
    entityType: 'vendor',
    entityId: id,
  })
  revalidateProcurement()
  return { ok: true as const }
}

// ───────── Contract ─────────

export async function listContracts(filter?: {
  vendorId?: string
  projectId?: string
}) {
  return prisma.contract.findMany({
    where: filter ?? {},
    include: {
      vendor: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  })
}

export async function createContract(input: {
  vendorId: string
  projectId?: string | null
  title: string
  contractType?: ContractType
  totalValue?: number | null
  currency?: string
  startDate?: string | null
  endDate?: string | null
  description?: string | null
  documentUrl?: string | null
}) {
  if (!input.vendorId) throw new Error('[INVALID_INPUT] vendorId requerido')
  if (!input.title?.trim()) throw new Error('[INVALID_INPUT] title requerido')

  const created = await prisma.contract.create({
    data: {
      vendorId: input.vendorId,
      projectId: input.projectId ?? null,
      title: input.title.trim(),
      contractType: input.contractType ?? 'FFP',
      totalValue:
        input.totalValue != null ? (input.totalValue as unknown as never) : null,
      currency: input.currency ?? 'USD',
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      description: input.description?.trim() || null,
      documentUrl: input.documentUrl?.trim() || null,
      status: 'DRAFT',
    },
  })
  await recordAuditEventSafe({
    action: 'contract.created',
    entityType: 'contract',
    entityId: created.id,
    after: { title: created.title, vendorId: created.vendorId },
  })
  revalidateProcurement()
  return created
}

export async function activateContract(id: string) {
  if (!id) throw new Error('[INVALID_INPUT] id requerido')
  const updated = await prisma.contract.update({
    where: { id },
    data: { status: 'ACTIVE' as ContractStatus },
  })
  await recordAuditEventSafe({
    action: 'contract.activated',
    entityType: 'contract',
    entityId: id,
  })
  revalidateProcurement()
  return updated
}

export async function closeContract(input: {
  id: string
  status: 'COMPLETED' | 'TERMINATED'
}) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')
  const updated = await prisma.contract.update({
    where: { id: input.id },
    data: { status: input.status as ContractStatus },
  })
  await recordAuditEventSafe({
    action: input.status === 'COMPLETED' ? 'contract.completed' : 'contract.terminated',
    entityType: 'contract',
    entityId: input.id,
  })
  revalidateProcurement()
  return updated
}

// ───────── Purchase Order ─────────

export async function listPurchaseOrders(filter?: {
  vendorId?: string
  projectId?: string
  contractId?: string
}) {
  return prisma.purchaseOrder.findMany({
    where: filter ?? {},
    include: {
      vendor: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      contract: { select: { id: true, title: true } },
    },
    orderBy: [{ status: 'asc' }, { issuedAt: 'desc' }],
  })
}

export async function createPurchaseOrder(input: {
  vendorId: string
  contractId?: string | null
  projectId?: string | null
  poNumber: string
  description: string
  amount: number
  currency?: string
  expectedDeliveryAt?: string | null
  notes?: string | null
}) {
  if (!input.vendorId) throw new Error('[INVALID_INPUT] vendorId requerido')
  if (!input.poNumber?.trim()) throw new Error('[INVALID_INPUT] poNumber requerido')
  if (!input.description?.trim()) {
    throw new Error('[INVALID_INPUT] description requerido')
  }
  if (input.amount == null || input.amount < 0) {
    throw new Error('[INVALID_INPUT] amount requerido y >= 0')
  }

  const created = await prisma.purchaseOrder.create({
    data: {
      vendorId: input.vendorId,
      contractId: input.contractId ?? null,
      projectId: input.projectId ?? null,
      poNumber: input.poNumber.trim(),
      description: input.description.trim(),
      amount: input.amount as unknown as never,
      currency: input.currency ?? 'USD',
      expectedDeliveryAt: input.expectedDeliveryAt
        ? new Date(input.expectedDeliveryAt)
        : null,
      notes: input.notes?.trim() || null,
      status: 'DRAFT',
    },
  })
  await recordAuditEventSafe({
    action: 'purchase_order.created',
    entityType: 'purchase_order',
    entityId: created.id,
    after: { poNumber: created.poNumber, amount: input.amount },
  })
  revalidateProcurement()
  return created
}

export async function setPurchaseOrderStatus(input: {
  id: string
  status: POStatus
  receivedAt?: string | null
}) {
  if (!input.id) throw new Error('[INVALID_INPUT] id requerido')

  const before = await prisma.purchaseOrder.findUnique({
    where: { id: input.id },
    select: { status: true },
  })
  if (!before) throw new Error('[NOT_FOUND] PO no existe')

  const updated = await prisma.purchaseOrder.update({
    where: { id: input.id },
    data: {
      status: input.status,
      receivedAt:
        input.status === 'RECEIVED' && !input.receivedAt
          ? new Date()
          : input.receivedAt
            ? new Date(input.receivedAt)
            : undefined,
    },
  })
  await recordAuditEventSafe({
    action: 'purchase_order.status_changed',
    entityType: 'purchase_order',
    entityId: input.id,
    before: { status: before.status },
    after: { status: updated.status },
  })
  revalidateProcurement()
  return updated
}
