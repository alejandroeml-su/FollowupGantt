# SaaS Billing (Stripe) · Wave R4-E

Integración Stripe para comercializar Sync como SaaS externo. Incluye
pricing tiers FREE/PRO/ENTERPRISE, plan enforcement, checkout/portal y
webhook idempotente.

## 1. Pricing tiers

| Tier        | $USD/user/mes | Users | Proyectos | Storage | Brain calls | Features clave |
|-------------|---------------|-------|-----------|---------|-------------|----------------|
| FREE        | 0             | 3     | 1         | 1 GB    | 50          | gantt, kanban, basic_brain |
| PRO         | 10            | 25    | 10        | 25 GB   | 1,000       | + evm, risks, monte_carlo, auto_pilot, realtime, mobile |
| ENTERPRISE  | 25            | ∞     | ∞         | 500 GB  | 10,000      | * (wildcard) + sso, siem, retention, powerbi_directquery |

Catálogo canónico en `src/lib/billing/pricing.ts` (`PRICING_TIERS`). La UI
y el enforcement consumen este módulo — no hay duplicación.

## 2. Setup Stripe Dashboard

### 2.1 Crear Products + Prices

1. En el Dashboard de Stripe (Test mode primero), crear 2 productos:
   - **Sync Pro** — Recurring subscription, monthly.
   - **Sync Enterprise** — Recurring subscription, monthly.
2. Crear los Prices recurrentes (USD, mensual):
   - Pro: $10.00 USD / month / user (per-seat).
   - Enterprise: $25.00 USD / month / user.
3. Copiar los `price_id` (`price_xxx`) — los pegaremos en env vars.

### 2.2 Activar el Customer Portal

1. Settings → Billing → Customer portal → Activate.
2. Habilitar:
   - "Customers can update their payment method" ✅
   - "Customers can cancel subscriptions" ✅ (at end of billing period)
   - "Customers can switch plans" ✅ (entre Pro y Enterprise)

## 3. Variables de entorno requeridas

Agregar a `.env.local` (dev) y a Vercel (Production + Preview):

```bash
# ── Stripe API ──────────────────────────────
STRIPE_SECRET_KEY=sk_test_xxx                  # server-only
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxx # bundle público

# Webhook secret (uno por entorno; lo da `stripe listen` o el dashboard)
STRIPE_WEBHOOK_SECRET=whsec_xxx

# Stripe Price IDs (de los products creados en 2.1)
STRIPE_PRICE_PRO_MONTHLY=price_xxx_pro
STRIPE_PRICE_ENT_MONTHLY=price_xxx_ent
```

Sin estas vars el módulo degrada a "Billing disabled" — la app no rompe
pero los endpoints devuelven `503 STRIPE_NOT_CONFIGURED`.

## 4. Webhook endpoint

URL pública: `https://<tu-dominio>/api/billing/webhook`

Eventos a suscribir (Stripe Dashboard → Webhooks → Add endpoint):

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_succeeded` (alias de paid)
- `invoice.payment_failed`

El handler valida la firma `Stripe-Signature` contra `STRIPE_WEBHOOK_SECRET`
y es **idempotente** (`BillingInvoice.stripeInvoiceId` es @unique y los
upserts de subscription son idempotent by-design).

### 4.1 Testing local con Stripe CLI

```bash
# Instalar Stripe CLI: https://stripe.com/docs/stripe-cli
stripe login

# Reenviar eventos al servidor local (genera un whsec_xxx temporal)
stripe listen --forward-to localhost:3000/api/billing/webhook

# En otra terminal, disparar un evento de prueba
stripe trigger customer.subscription.created
stripe trigger invoice.paid
```

Pegar el `whsec_xxx` que imprime `stripe listen` en `STRIPE_WEBHOOK_SECRET`.

## 5. Flujo upgrade/downgrade

1. **Upgrade FREE → PRO**: usuario click "Probar Pro" en `/settings/billing`
   → `POST /api/billing/checkout` → redirect a Stripe Checkout
   (hosted) → success_url → Stripe envía `customer.subscription.created`
   al webhook → `BillingSubscription.tier = 'PRO'`, `status = 'active'`.
2. **Cambio de plan PRO → ENTERPRISE**: usuario abre Billing Portal (botón
   "Gestionar suscripción") → cambia plan en el portal Stripe-hosted →
   `customer.subscription.updated` actualiza el tier.
3. **Cancelación**: usuario abre Billing Portal → "Cancel subscription"
   → Stripe agenda cancel_at_period_end → recibe
   `customer.subscription.updated` con `cancel_at` poblado → al final
   del periodo, `customer.subscription.deleted` demota a FREE.

## 6. Plan enforcement

Helpers en `src/lib/billing/enforce.ts`:

```ts
await requireFeature(workspaceId, 'monte_carlo')       // throws [FEATURE_NOT_AVAILABLE]
await requireCapacity(workspaceId, 'users', current)   // throws [CAPACITY_EXCEEDED]
await requireProjectCapacity(workspaceId)              // alias
await requireMemberCapacity(workspaceId)               // alias (sums invites)
await requireBrainCapacity(workspaceId)                // alias
```

Wiring actual en server actions:

- `inviteMember` → `requireMemberCapacity` (FREE bloquea al 3er miembro).
- `createProject` → `requireProjectCapacity` (sólo si `workspaceId` viene
  en el form; legacy sin tenant no aplica enforce).
- Brain AI calls → callers deben invocar `requireBrainCapacity` antes y
  `incrementBrainCalls` después. MVP no instrumenta `lib/ai/llm/*` para
  no acoplar el adapter LLM al billing — la primera lectura/escritura
  futura del feature debe agregar el wiring.

## 7. Política de cancelación

- **End-of-period** (default): el usuario conserva acceso paid hasta
  `currentPeriodEnd`. La UI muestra "Cancelación programada para X".
- **Immediate** (vía API `cancelSubscription({ immediate: true })`): baja
  inmediata con prorrateo. No expuesta en UI MVP — sólo via soporte.

## 8. Setup pendiente operativo

| # | Tarea | Prioridad | Responsable |
|---|-------|-----------|-------------|
| 1 | Crear Stripe account + activar billing | P0 | Edwin / Finance |
| 2 | Crear products + prices (Pro, Enterprise) | P0 | Edwin |
| 3 | Setear env vars en Vercel (Production + Preview) | P0 | SRE |
| 4 | Registrar webhook endpoint en Stripe Dashboard | P0 | SRE |
| 5 | Aplicar migración `20260511_r4e_billing_subscriptions` via MCP Supabase | P0 | DBA |
| 6 | Cron mensual `resetMonthlyBrainCounters()` (día 1) | P1 | SRE |
| 7 | Activar Customer Portal en Stripe Dashboard | P1 | Edwin |
| 8 | Setear "Tax behavior" en prices si aplica IVA | P2 | Finance |

## 9. Patrones del repo respetados

- `'use server'` purity: server actions sólo exportan async functions.
- Errores tipados `[CODE] detalle` (ver `BillingErrorCode`).
- `revalidatePath` tras mutaciones críticas.
- Audit log centralizado (`recordAuditEventSafe`) — eventos `billing.*`
  agregados al catálogo `KNOWN_AUDIT_ACTIONS`.
- Migración SQL idempotente con `IF NOT EXISTS` (Edwin push-sin-baseline).
