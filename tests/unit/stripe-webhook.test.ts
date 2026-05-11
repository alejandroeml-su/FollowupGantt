import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Wave R4-E · Tests del webhook handler `/api/billing/webhook`.
 *
 * Mockeamos el SDK Stripe + el módulo de subscription para asserting
 * sobre los upserts que dispara cada tipo de evento. No tocamos
 * BD ni Stripe reales.
 */

// ───────────── Mocks ─────────────
const verifyMock = vi.fn()
const upsertMock = vi.fn()
const auditMock = vi.fn()
const invoiceUpsertMock = vi.fn()
const billingFindFirstMock = vi.fn()

vi.mock('@/lib/billing/stripe-client', () => ({
  verifyWebhookSignature: (...args: unknown[]) => verifyMock(...args),
}))

vi.mock('@/lib/billing/subscription', () => ({
  upsertSubscriptionFromStripe: (...args: unknown[]) => upsertMock(...args),
}))

vi.mock('@/lib/audit/events', () => ({
  recordAuditEventSafe: (...args: unknown[]) => auditMock(...args),
}))

vi.mock('@/lib/prisma', () => ({
  default: {
    billingInvoice: {
      upsert: (...args: unknown[]) => invoiceUpsertMock(...args),
    },
    billingSubscription: {
      findFirst: (...args: unknown[]) => billingFindFirstMock(...args),
    },
  },
}))

beforeEach(() => {
  verifyMock.mockReset()
  upsertMock.mockReset()
  auditMock.mockReset()
  invoiceUpsertMock.mockReset()
  billingFindFirstMock.mockReset()
  upsertMock.mockResolvedValue(undefined)
  invoiceUpsertMock.mockResolvedValue(undefined)
})

function makeRequest(body: string, signature: string | null) {
  const headers = new Map<string, string>()
  if (signature !== null) headers.set('stripe-signature', signature)
  return {
    text: async () => body,
    headers: {
      get: (k: string) => headers.get(k.toLowerCase()) ?? null,
    },
  } as unknown as import('next/server').NextRequest
}

// ───────────── Tests ─────────────

describe('POST /api/billing/webhook', () => {
  it('rechaza si falta header stripe-signature (400)', async () => {
    const { POST } = await import('@/app/api/billing/webhook/route')
    const res = await POST(makeRequest('{}', null))
    const json = (await res.json()) as { error: { code: string } }
    expect(res.status).toBe(400)
    expect(json.error.code).toBe('MISSING_SIGNATURE')
  })

  it('rechaza si la firma no valida (400 INVALID_SIGNATURE)', async () => {
    verifyMock.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature')
    })
    const { POST } = await import('@/app/api/billing/webhook/route')
    const res = await POST(makeRequest('{}', 'sig_fake'))
    const json = (await res.json()) as { error: { code: string } }
    expect(res.status).toBe(400)
    expect(json.error.code).toBe('INVALID_SIGNATURE')
  })

  it('customer.subscription.created → upsert + audit log', async () => {
    verifyMock.mockReturnValue({
      id: 'evt_1',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          metadata: { workspaceId: 'ws-1', tier: 'PRO' },
          items: { data: [{ price: { id: 'price_pro' }, quantity: 5 }] },
          cancel_at: null,
          trial_end: null,
          current_period_end: 1735000000,
        },
      },
    })
    const { POST } = await import('@/app/api/billing/webhook/route')
    const res = await POST(makeRequest('{}', 'sig_valid'))
    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const [arg] = upsertMock.mock.calls[0] as [Record<string, unknown>]
    expect(arg.workspaceId).toBe('ws-1')
    expect(arg.tier).toBe('PRO')
    expect(arg.stripeSubscriptionId).toBe('sub_123')
    expect(arg.seats).toBe(5)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.subscription_created' }),
    )
  })

  it('customer.subscription.updated dispara audit subscription_updated', async () => {
    verifyMock.mockReturnValue({
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_456',
          customer: 'cus_456',
          status: 'past_due',
          metadata: { workspaceId: 'ws-2', tier: 'PRO' },
          items: { data: [{ price: { id: 'price_pro' }, quantity: 1 }] },
          cancel_at: null,
          trial_end: null,
          current_period_end: 1735000000,
        },
      },
    })
    const { POST } = await import('@/app/api/billing/webhook/route')
    await POST(makeRequest('{}', 'sig_valid'))
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.subscription_updated' }),
    )
  })

  it('customer.subscription.deleted demota a FREE', async () => {
    verifyMock.mockReturnValue({
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_789',
          customer: 'cus_789',
          status: 'canceled',
          metadata: { workspaceId: 'ws-3' },
          items: { data: [] },
        },
      },
    })
    const { POST } = await import('@/app/api/billing/webhook/route')
    await POST(makeRequest('{}', 'sig_valid'))
    const [arg] = upsertMock.mock.calls[0] as [Record<string, unknown>]
    expect(arg.tier).toBe('FREE')
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.subscription_canceled' }),
    )
  })

  it('invoice.paid persiste BillingInvoice + audit invoice_paid', async () => {
    verifyMock.mockReturnValue({
      id: 'evt_4',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_111',
          customer: 'cus_111',
          metadata: { workspaceId: 'ws-4' },
          amount_paid: 1000,
          amount_due: 1000,
          currency: 'usd',
          status: 'paid',
          invoice_pdf: 'https://stripe.com/inv_pdf',
          period_start: 1730000000,
          period_end: 1732000000,
        },
      },
    })
    const { POST } = await import('@/app/api/billing/webhook/route')
    await POST(makeRequest('{}', 'sig_valid'))
    expect(invoiceUpsertMock).toHaveBeenCalled()
    const args = invoiceUpsertMock.mock.calls[0][0] as {
      create: Record<string, unknown>
    }
    expect(args.create.workspaceId).toBe('ws-4')
    expect(args.create.amountCents).toBe(1000)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.invoice_paid' }),
    )
  })

  it('invoice.payment_failed dispara audit invoice_failed', async () => {
    verifyMock.mockReturnValue({
      id: 'evt_5',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_222',
          customer: 'cus_222',
          metadata: { workspaceId: 'ws-5' },
          amount_due: 2500,
          currency: 'usd',
          status: 'open',
          period_start: 1730000000,
          period_end: 1732000000,
        },
      },
    })
    const { POST } = await import('@/app/api/billing/webhook/route')
    await POST(makeRequest('{}', 'sig_valid'))
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.invoice_failed' }),
    )
  })

  it('eventos no manejados devuelven 200 ignored', async () => {
    verifyMock.mockReturnValue({
      id: 'evt_6',
      type: 'product.created',
      data: { object: {} },
    })
    const { POST } = await import('@/app/api/billing/webhook/route')
    const res = await POST(makeRequest('{}', 'sig_valid'))
    expect(res.status).toBe(200)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('subscription event sin metadata.workspaceId no rompe — solo skipea', async () => {
    verifyMock.mockReturnValue({
      id: 'evt_7',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_orphan',
          customer: 'cus_orphan',
          status: 'active',
          metadata: {},
          items: { data: [{ price: { id: 'price_pro' }, quantity: 1 }] },
        },
      },
    })
    const { POST } = await import('@/app/api/billing/webhook/route')
    const res = await POST(makeRequest('{}', 'sig_valid'))
    expect(res.status).toBe(200)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('invoice.payment_succeeded (alias paid) también dispara invoice_paid', async () => {
    verifyMock.mockReturnValue({
      id: 'evt_8',
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_333',
          customer: 'cus_333',
          metadata: { workspaceId: 'ws-6' },
          amount_paid: 500,
          amount_due: 500,
          currency: 'usd',
          status: 'paid',
          period_start: 1730000000,
          period_end: 1732000000,
        },
      },
    })
    const { POST } = await import('@/app/api/billing/webhook/route')
    await POST(makeRequest('{}', 'sig_valid'))
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.invoice_paid' }),
    )
  })
})
