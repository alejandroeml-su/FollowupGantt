'use client'

/**
 * Wave P11-PMI (HU-12.4) — Procurement dashboard MVP.
 * Tabs: Vendors / Contracts / Purchase Orders. Forms inline simples.
 */

import { useState, useTransition } from 'react'
import {
  Briefcase,
  Plus,
  X as CloseIcon,
  FileText,
  Receipt,
  Building2,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { clsx } from 'clsx'
import {
  createVendor,
  createContract,
  createPurchaseOrder,
  activateContract,
  closeContract,
  setPurchaseOrderStatus,
  deactivateVendor,
} from '@/lib/actions/procurement'
import { toast } from '@/components/interactions/Toaster'

type Vendor = {
  id: string
  name: string
  contactPerson: string | null
  contactEmail: string | null
  taxId: string | null
  isActive: boolean
}

type Contract = {
  id: string
  vendor: { id: string; name: string }
  project: { id: string; name: string } | null
  title: string
  contractType: string
  totalValue: unknown
  currency: string
  startDate: Date | null
  endDate: Date | null
  status: string
}

type PurchaseOrder = {
  id: string
  vendor: { id: string; name: string }
  contract: { id: string; title: string } | null
  project: { id: string; name: string } | null
  poNumber: string
  description: string
  amount: unknown
  currency: string
  issuedAt: Date
  expectedDeliveryAt: Date | null
  receivedAt: Date | null
  status: string
}

type Project = { id: string; name: string }

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-500/15 text-slate-300',
  ACTIVE: 'bg-indigo-500/15 text-indigo-300',
  ISSUED: 'bg-indigo-500/15 text-indigo-300',
  PARTIALLY_RECEIVED: 'bg-amber-500/15 text-amber-300',
  RECEIVED: 'bg-emerald-500/15 text-emerald-300',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300',
  TERMINATED: 'bg-rose-500/15 text-rose-300',
  CANCELLED: 'bg-rose-500/15 text-rose-300',
}

type Props = {
  vendors: Vendor[]
  contracts: Contract[]
  purchaseOrders: PurchaseOrder[]
  projects: Project[]
}

type Tab = 'vendors' | 'contracts' | 'pos'

export function ProcurementClient({
  vendors,
  contracts,
  purchaseOrders,
  projects,
}: Props) {
  const [tab, setTab] = useState<Tab>('vendors')
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header KPIs */}
      <header className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <Briefcase className="h-6 w-6 text-emerald-400" />
          <div className="flex-1">
            <h2 className="text-base font-bold text-foreground">Procurement</h2>
            <p className="text-xs text-muted-foreground">
              PMBOK Procurement Management · Vendors, Contracts y Purchase
              Orders cross-project
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <KPI count={vendors.filter((v) => v.isActive).length} label="Vendors activos" />
          <KPI
            count={contracts.filter((c) => c.status === 'ACTIVE').length}
            label="Contratos activos"
          />
          <KPI
            count={
              purchaseOrders.filter((p) =>
                ['ISSUED', 'PARTIALLY_RECEIVED'].includes(p.status),
              ).length
            }
            label="POs en curso"
          />
        </div>
      </header>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5">
        <TabButton
          active={tab === 'vendors'}
          icon={<Building2 className="h-3 w-3" />}
          label={`Vendors · ${vendors.length}`}
          onClick={() => {
            setTab('vendors')
            setShowForm(false)
          }}
        />
        <TabButton
          active={tab === 'contracts'}
          icon={<FileText className="h-3 w-3" />}
          label={`Contracts · ${contracts.length}`}
          onClick={() => {
            setTab('contracts')
            setShowForm(false)
          }}
        />
        <TabButton
          active={tab === 'pos'}
          icon={<Receipt className="h-3 w-3" />}
          label={`Purchase Orders · ${purchaseOrders.length}`}
          onClick={() => {
            setTab('pos')
            setShowForm(false)
          }}
        />
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          <Plus className="h-3 w-3" /> Nuevo
        </button>
      </div>

      {/* Form per tab */}
      {showForm && tab === 'vendors' && (
        <VendorForm onDone={() => setShowForm(false)} />
      )}
      {showForm && tab === 'contracts' && (
        <ContractForm
          vendors={vendors}
          projects={projects}
          onDone={() => setShowForm(false)}
        />
      )}
      {showForm && tab === 'pos' && (
        <POForm
          vendors={vendors}
          contracts={contracts}
          projects={projects}
          onDone={() => setShowForm(false)}
        />
      )}

      {/* Lists per tab */}
      {tab === 'vendors' && <VendorsList items={vendors} />}
      {tab === 'contracts' && <ContractsList items={contracts} />}
      {tab === 'pos' && <POList items={purchaseOrders} />}
    </div>
  )
}

function KPI({ count, label }: { count: number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-input/30 p-3">
      <p className="text-2xl font-bold text-foreground">{count}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  )
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        active
          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
          : 'border border-border bg-input/40 text-muted-foreground hover:bg-input',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ───────── Vendor form + list ─────────

function VendorForm({ onDone }: { onDone: () => void }) {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '',
    contactPerson: '',
    contactEmail: '',
    taxId: '',
  })
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    if (!form.name.trim()) {
      toast.error('Name requerido')
      return
    }
    startTransition(async () => {
      try {
        await createVendor({
          name: form.name.trim(),
          contactPerson: form.contactPerson || null,
          contactEmail: form.contactEmail || null,
          taxId: form.taxId || null,
        })
        toast.success('Vendor agregado')
        router.refresh()
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  return (
    <FormShell title="Nuevo Vendor" onClose={onDone}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nombre *">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
        <Field label="Persona contacto">
          <input
            type="text"
            value={form.contactPerson}
            onChange={(e) => setForm({ ...form, contactPerson: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={form.contactEmail}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
        <Field label="Tax ID / RFC">
          <input
            type="text"
            value={form.taxId}
            onChange={(e) => setForm({ ...form, taxId: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
      </div>
      <FormActions onCancel={onDone} onSubmit={submit} pending={isPending} />
    </FormShell>
  )
}

function VendorsList({ items }: { items: Vendor[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (items.length === 0) {
    return <EmptyMsg label="Sin vendors registrados" />
  }
  return (
    <ul className="space-y-1.5">
      {items.map((v) => (
        <li
          key={v.id}
          className={clsx(
            'flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs',
            v.isActive ? 'border-border' : 'border-border/40 opacity-60',
          )}
        >
          <span className="font-semibold text-foreground">{v.name}</span>
          {v.contactPerson && (
            <span className="text-muted-foreground">· {v.contactPerson}</span>
          )}
          {v.contactEmail && (
            <span className="text-muted-foreground">{v.contactEmail}</span>
          )}
          {v.taxId && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {v.taxId}
            </span>
          )}
          <span
            className={clsx(
              'ml-auto rounded-full px-1.5 py-0.5 text-[10px]',
              v.isActive
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-slate-500/15 text-slate-300',
            )}
          >
            {v.isActive ? 'ACTIVE' : 'INACTIVE'}
          </span>
          {v.isActive && (
            <button
              type="button"
              onClick={() =>
                startTransition(async () => {
                  await deactivateVendor(v.id)
                  router.refresh()
                })
              }
              disabled={isPending}
              className="rounded p-1 text-muted-foreground hover:text-rose-400"
            >
              Desactivar
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

// ───────── Contract form + list ─────────

function ContractForm({
  vendors,
  projects,
  onDone,
}: {
  vendors: Vendor[]
  projects: Project[]
  onDone: () => void
}) {
  const router = useRouter()
  const activeVendors = vendors.filter((v) => v.isActive)
  const [form, setForm] = useState({
    vendorId: activeVendors[0]?.id ?? '',
    projectId: '',
    title: '',
    contractType: 'FFP' as 'FFP' | 'CPFF' | 'TM' | 'CR',
    totalValue: '',
    currency: 'USD',
    startDate: '',
    endDate: '',
    description: '',
  })
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    if (!form.vendorId) {
      toast.error('Selecciona un vendor')
      return
    }
    if (!form.title.trim()) {
      toast.error('Title requerido')
      return
    }
    startTransition(async () => {
      try {
        await createContract({
          vendorId: form.vendorId,
          projectId: form.projectId || null,
          title: form.title.trim(),
          contractType: form.contractType,
          totalValue: form.totalValue ? Number(form.totalValue) : null,
          currency: form.currency,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          description: form.description || null,
        })
        toast.success('Contrato creado en DRAFT')
        router.refresh()
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  if (activeVendors.length === 0) {
    return (
      <FormShell title="Nuevo Contract" onClose={onDone}>
        <p className="text-sm text-amber-300">
          Necesitas al menos un Vendor activo. Cambia al tab Vendors y crea uno.
        </p>
      </FormShell>
    )
  }

  return (
    <FormShell title="Nuevo Contract" onClose={onDone}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor *">
          <select
            value={form.vendorId}
            onChange={(e) => setForm({ ...form, vendorId: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          >
            {activeVendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo *">
          <select
            value={form.contractType}
            onChange={(e) =>
              setForm({ ...form, contractType: e.target.value as 'FFP' | 'CPFF' | 'TM' | 'CR' })
            }
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          >
            <option value="FFP">FFP · Firm Fixed Price</option>
            <option value="CPFF">CPFF · Cost Plus Fixed Fee</option>
            <option value="TM">T&M · Time and Materials</option>
            <option value="CR">CR · Cost Reimbursable</option>
          </select>
        </Field>
      </div>
      <Field label="Título *">
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Valor total">
          <input
            type="number"
            value={form.totalValue}
            onChange={(e) => setForm({ ...form, totalValue: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
        <Field label="Moneda">
          <input
            type="text"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
            maxLength={3}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
        <Field label="Proyecto">
          <select
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          >
            <option value="">— Ninguno —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Inicio">
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
        <Field label="Fin">
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
      </div>
      <FormActions onCancel={onDone} onSubmit={submit} pending={isPending} />
    </FormShell>
  )
}

function ContractsList({ items }: { items: Contract[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (items.length === 0) return <EmptyMsg label="Sin contratos registrados" />

  return (
    <ul className="space-y-1.5">
      {items.map((c) => (
        <li
          key={c.id}
          className="rounded-md border border-border bg-card px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-foreground">{c.title}</span>
            <span className="rounded-full bg-input/60 px-1.5 py-0.5 text-[10px]">
              {c.contractType}
            </span>
            <span className="text-muted-foreground">→ {c.vendor.name}</span>
            {c.project && (
              <span className="text-muted-foreground">· {c.project.name}</span>
            )}
            {c.totalValue != null && (
              <span className="font-mono text-[10px]">
                {c.currency} {String(c.totalValue)}
              </span>
            )}
            <span
              className={clsx(
                'ml-auto rounded-full px-1.5 py-0.5 text-[10px]',
                STATUS_TONE[c.status],
              )}
            >
              {c.status}
            </span>
          </div>
          {c.status === 'DRAFT' && (
            <div className="mt-2 flex gap-1.5 border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await activateContract(c.id)
                    router.refresh()
                  })
                }
                disabled={isPending}
                className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
              >
                Activar
              </button>
            </div>
          )}
          {c.status === 'ACTIVE' && (
            <div className="mt-2 flex gap-1.5 border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await closeContract({ id: c.id, status: 'COMPLETED' })
                    router.refresh()
                  })
                }
                disabled={isPending}
                className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 hover:bg-emerald-500/20"
              >
                Completar
              </button>
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await closeContract({ id: c.id, status: 'TERMINATED' })
                    router.refresh()
                  })
                }
                disabled={isPending}
                className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/20"
              >
                Terminar
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

// ───────── PO form + list ─────────

function POForm({
  vendors,
  contracts,
  projects,
  onDone,
}: {
  vendors: Vendor[]
  contracts: Contract[]
  projects: Project[]
  onDone: () => void
}) {
  const router = useRouter()
  const activeVendors = vendors.filter((v) => v.isActive)
  const [form, setForm] = useState({
    vendorId: activeVendors[0]?.id ?? '',
    contractId: '',
    projectId: '',
    poNumber: '',
    description: '',
    amount: '',
    currency: 'USD',
    expectedDeliveryAt: '',
  })
  const [isPending, startTransition] = useTransition()

  const submit = () => {
    if (!form.vendorId || !form.poNumber.trim() || !form.description.trim() || !form.amount) {
      toast.error('Vendor + PO Number + Description + Amount requeridos')
      return
    }
    startTransition(async () => {
      try {
        await createPurchaseOrder({
          vendorId: form.vendorId,
          contractId: form.contractId || null,
          projectId: form.projectId || null,
          poNumber: form.poNumber.trim(),
          description: form.description.trim(),
          amount: Number(form.amount),
          currency: form.currency,
          expectedDeliveryAt: form.expectedDeliveryAt || null,
        })
        toast.success('Purchase Order creada en DRAFT')
        router.refresh()
        onDone()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error')
      }
    })
  }

  if (activeVendors.length === 0) {
    return (
      <FormShell title="Nueva Purchase Order" onClose={onDone}>
        <p className="text-sm text-amber-300">
          Necesitas al menos un Vendor activo.
        </p>
      </FormShell>
    )
  }

  const filteredContracts = contracts.filter(
    (c) => c.vendor.id === form.vendorId && c.status === 'ACTIVE',
  )

  return (
    <FormShell title="Nueva Purchase Order" onClose={onDone}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vendor *">
          <select
            value={form.vendorId}
            onChange={(e) =>
              setForm({ ...form, vendorId: e.target.value, contractId: '' })
            }
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          >
            {activeVendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Contrato (opcional)">
          <select
            value={form.contractId}
            onChange={(e) => setForm({ ...form, contractId: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          >
            <option value="">— Sin contrato paraguas —</option>
            {filteredContracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="PO Number *">
          <input
            type="text"
            value={form.poNumber}
            onChange={(e) => setForm({ ...form, poNumber: e.target.value })}
            placeholder="PO-2026-001"
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
        <Field label="Proyecto">
          <select
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          >
            <option value="">— Ninguno —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Descripción *">
        <textarea
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          className="w-full resize-none rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Monto *">
          <input
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
        <Field label="Moneda">
          <input
            type="text"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
            maxLength={3}
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
        <Field label="Entrega esperada">
          <input
            type="date"
            value={form.expectedDeliveryAt}
            onChange={(e) =>
              setForm({ ...form, expectedDeliveryAt: e.target.value })
            }
            className="w-full rounded-md border border-border bg-input px-3 py-1.5 text-sm text-input-foreground"
          />
        </Field>
      </div>
      <FormActions onCancel={onDone} onSubmit={submit} pending={isPending} />
    </FormShell>
  )
}

function POList({ items }: { items: PurchaseOrder[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (items.length === 0) return <EmptyMsg label="Sin purchase orders" />
  return (
    <ul className="space-y-1.5">
      {items.map((p) => (
        <li
          key={p.id}
          className="rounded-md border border-border bg-card px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-foreground">
              {p.poNumber}
            </span>
            <span className="text-muted-foreground">{p.description}</span>
            <span className="font-mono text-[10px] text-foreground">
              {p.currency} {String(p.amount)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              → {p.vendor.name}
            </span>
            {p.project && (
              <span className="text-[10px] text-muted-foreground">
                · {p.project.name}
              </span>
            )}
            <span
              className={clsx(
                'ml-auto rounded-full px-1.5 py-0.5 text-[10px]',
                STATUS_TONE[p.status],
              )}
            >
              {p.status}
            </span>
          </div>
          <div className="mt-2 flex gap-1.5 border-t border-border/60 pt-2">
            {p.status === 'DRAFT' && (
              <StatusBtn
                onClick={() =>
                  startTransition(async () => {
                    await setPurchaseOrderStatus({ id: p.id, status: 'ISSUED' })
                    router.refresh()
                  })
                }
                disabled={isPending}
                tone="indigo"
              >
                Emitir
              </StatusBtn>
            )}
            {(p.status === 'ISSUED' || p.status === 'PARTIALLY_RECEIVED') && (
              <>
                <StatusBtn
                  onClick={() =>
                    startTransition(async () => {
                      await setPurchaseOrderStatus({
                        id: p.id,
                        status: 'PARTIALLY_RECEIVED',
                      })
                      router.refresh()
                    })
                  }
                  disabled={isPending}
                  tone="amber"
                >
                  Parcial
                </StatusBtn>
                <StatusBtn
                  onClick={() =>
                    startTransition(async () => {
                      await setPurchaseOrderStatus({ id: p.id, status: 'RECEIVED' })
                      router.refresh()
                    })
                  }
                  disabled={isPending}
                  tone="emerald"
                >
                  Recibido
                </StatusBtn>
                <StatusBtn
                  onClick={() =>
                    startTransition(async () => {
                      await setPurchaseOrderStatus({ id: p.id, status: 'CANCELLED' })
                      router.refresh()
                    })
                  }
                  disabled={isPending}
                  tone="rose"
                >
                  Cancelar
                </StatusBtn>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

// ───────── Helpers ─────────

function FormShell({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="rounded p-1 text-muted-foreground hover:bg-secondary"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      {children}
    </section>
  )
}

function FormActions({
  onCancel,
  onSubmit,
  pending,
}: {
  onCancel: () => void
  onSubmit: () => void
  pending: boolean
}) {
  return (
    <div className="flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-md border border-border bg-secondary px-3 py-1.5 text-xs"
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {pending ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}

function EmptyMsg({ label }: { label: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
      {label}
    </p>
  )
}

function StatusBtn({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone: 'indigo' | 'amber' | 'emerald' | 'rose'
}) {
  const TONE: Record<string, string> = {
    indigo: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20',
    emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
    rose: 'border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'rounded border px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50',
        TONE[tone],
      )}
    >
      {children}
    </button>
  )
}
