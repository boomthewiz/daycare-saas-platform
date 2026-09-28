import { randomUUID } from "node:crypto"
import type Stripe from "stripe"
import { supabaseAdmin } from "@/lib/supabase-admin"
import { requireUnlocked } from "@/lib/device-session-server"
import { billingStripe } from "@/lib/stripe-config"
import { objectId, paidDeadline, subscriptionSeats } from "@/lib/billing-policy"

type Operation = { kind: string; key: string; created: number; args: Record<string, unknown>; id?: string }
export type BillingState = {
  managed?: boolean; organization_id: string; lease: string; customer_id: string | null
  subscription_id: string | null; checkout_id: string | null; schedule_id: string | null
  scheduled_seats: number | null; status: string; seats: number; provider_count: number
  desired_revision: number; synced_revision: number; trial_ends_at: string; paid_through: string | null
  cancel_at: string | null; operation: Operation | null
}
export class BillingError extends Error {
  constructor(message: string, public status: number) { super(message) }
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseAdmin.rpc(name, args)
  if (error) {
    if (error.code === "42501") throw new BillingError("Only an unlocked organization owner can manage billing.", 403)
    if (error.code === "55P03") throw new BillingError("Billing is being updated. Please try again shortly.", 409)
    throw new Error("Billing storage unavailable")
  }
  return data as T
}
export async function ownerContext(request: Request) {
  const identity = await requireUnlocked(request)
  if (!identity) throw new BillingError("Sign in and unlock your session.", 401)
  return rpc<BillingState>("billing_owner_context", { p_user: identity.user.id, p_session: identity.sessionId })
}

export async function withBilling<T>(org: string | null, customer: string | null,
  action: (worker: BillingWorker) => Promise<T>) {
  const connection = await billingStripe()
  const state = await rpc<BillingState | null>("billing_lock", { p_org: org, p_customer: customer })
  if (!state) return null
  const worker = new BillingWorker(state, connection)
  try {
    await worker.resume()
    return await action(worker)
  } finally {
    await rpc("billing_save", { p_org: state.organization_id, p_lease: state.lease, p_patch: {}, p_release: true })
  }
}

class BillingWorker {
  constructor(public state: BillingState, private connection: Awaited<ReturnType<typeof billingStripe>>) {}
  get stripe() { return this.connection.stripe }
  get config() { return this.connection.config }
  async save(patch: Record<string, unknown>) {
    await rpc("billing_save", { p_org: this.state.organization_id, p_lease: this.state.lease, p_patch: patch })
    Object.assign(this.state, patch)
  }
  // Exact request and idempotency key are durable BEFORE sending to Stripe.
  // Ambiguous operations older than Stripe's retention window fail closed for
  // operator reconciliation instead of risking a duplicate charge/subscription.
  async mutate(kind: string, args: Record<string, unknown>, id?: string) {
    if (this.state.operation) throw new Error("Unfinished Stripe operation")
    await this.save({ operation: { kind, args, id, key: randomUUID(), created: Date.now() } })
    return this.resume()
  }
  async resume() {
    const op = this.state.operation
    if (!op) return
    if (Date.now() - op.created > 23 * 3600 * 1000) throw new Error("Stripe operation requires manual reconciliation")
    const options = { idempotencyKey: op.key }
    let patch: Record<string, unknown> = {}
    switch (op.kind) {
      case "customer": {
        const result = await this.stripe.customers.create(op.args as Stripe.CustomerCreateParams, options)
        patch = { customer_id: result.id }; break
      }
      case "checkout": {
        const result = await this.stripe.checkout.sessions.create(op.args as Stripe.Checkout.SessionCreateParams, options)
        patch = { checkout_id: result.id }; break
      }
      case "expire": await this.stripe.checkout.sessions.expire(op.id!, {}, options); patch = { checkout_id: null }; break
      case "subscribe": {
        const result = await this.stripe.subscriptions.create(op.args as unknown as Stripe.SubscriptionCreateParams, options)
        patch = { subscription_id: result.id }; break
      }
      case "update": await this.stripe.subscriptions.update(op.id!, op.args as Stripe.SubscriptionUpdateParams, options); break
      case "schedule": {
        const result = await this.stripe.subscriptionSchedules.create(op.args as Stripe.SubscriptionScheduleCreateParams, options)
        patch = { schedule_id: result.id }; break
      }
      case "schedule-update": await this.stripe.subscriptionSchedules.update(op.id!, op.args as Stripe.SubscriptionScheduleUpdateParams, options); break
      case "release": await this.stripe.subscriptionSchedules.release(op.id!, {}, options); patch = { schedule_id: null, scheduled_seats: null }; break
      default: throw new Error("Unknown Stripe operation")
    }
    await this.save({ ...patch, operation: null })
  }
  lineItems(seats: number) {
    return [{ price: this.config.base, quantity: 1 },
      ...(seats > 1 ? [{ price: this.config.provider, quantity: seats - 1 }] : [])]
  }
  async currentSubscription() {
    if (!this.state.customer_id) return null
    // A dedicated customer belongs to one organization. Listing also recovers
    // a successful Checkout whose webhook has not arrived yet.
    const list = await this.stripe.subscriptions.list({ customer: this.state.customer_id, status: "all", limit: 100 })
    if (list.has_more) throw new Error("Subscription history requires operator review")
    const open = list.data.filter(sub => !["canceled", "incomplete_expired"].includes(sub.status))
    if (open.length > 1) throw new Error("Multiple subscriptions require operator review")
    const sub = open[0] || list.data.find(sub => sub.id === this.state.subscription_id) || null
    if (sub) {
      subscriptionSeats(sub, this.config.base, this.config.provider)
      if (objectId(sub.customer) !== this.state.customer_id) throw new Error("Customer mismatch")
    }
    return sub
  }
  async completeSetup() {
    if (!this.state.checkout_id || !this.state.customer_id) return
    const checkout = await this.stripe.checkout.sessions.retrieve(this.state.checkout_id)
    if (checkout.livemode || objectId(checkout.customer) !== this.state.customer_id) throw new Error("Checkout mismatch")
    if (checkout.mode !== "setup" || checkout.status !== "complete") return
    const existing = await this.currentSubscription()
    if (existing && !["canceled", "incomplete_expired"].includes(existing.status)) {
      // Also clear after recovery from a subscription-create checkpoint failure;
      // this setup session must never recreate a later-canceled subscription.
      await this.save({ checkout_id: null })
      return
    }
    const setupId = objectId(checkout.setup_intent)
    if (!setupId) throw new Error("Missing setup intent")
    const setup = await this.stripe.setupIntents.retrieve(setupId)
    if (setup.livemode || setup.status !== "succeeded" || objectId(setup.customer) !== this.state.customer_id) throw new Error("Setup not complete")
    const end = Math.floor(Date.parse(this.state.trial_ends_at) / 1000)
    const paymentMethod = objectId(setup.payment_method)
    if (!paymentMethod) throw new Error("Missing payment method")
    await this.mutate("subscribe", { customer: this.state.customer_id, items: this.lineItems(Math.max(1, this.state.provider_count)),
      default_payment_method: paymentMethod, billing_mode: { type: "flexible" }, payment_behavior: "default_incomplete",
      ...(end > Date.now() / 1000 ? { trial_end: end } : {}) })
    await this.save({ checkout_id: null })
  }
  async refresh() {
    await this.completeSetup()
    const sub = await this.currentSubscription()
    if (!sub) return null
    const seats = subscriptionSeats(sub, this.config.base, this.config.provider)
    const invoices = await this.stripe.invoices.list({ customer: this.state.customer_id!, subscription: sub.id, status: "paid", limit: 100 })
    let paidThrough = this.state.paid_through
    for (const invoice of invoices.data) {
      const deadline = paidDeadline(invoice, sub.id, this.state.customer_id!, this.config.base)
      if (deadline && (!paidThrough || Date.parse(deadline) > Date.parse(paidThrough))) paidThrough = deadline
    }
    await this.save({ subscription_id: sub.id, status: sub.status, seats,
      cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
      paid_through: paidThrough })
    return sub
  }
  async checkout() {
    const sub = await this.refresh()
    if (sub && !["canceled", "incomplete_expired"].includes(sub.status)) {
      throw new BillingError("Your organization already has a subscription. Use Manage subscription.", 409)
    }
    if (!this.state.customer_id) await this.mutate("customer", { description: "ReJoyce organization subscription" })
    if (this.state.checkout_id) {
      const existing = await this.stripe.checkout.sessions.retrieve(this.state.checkout_id)
      if (existing.status === "open") return existing.url
      if (existing.status === "complete" && existing.mode === "subscription" && !sub) {
        throw new BillingError("Your payment is still being processed. Please refresh shortly.", 409)
      }
      await this.save({ checkout_id: null })
    }
    const end = Math.floor(Date.parse(this.state.trial_ends_at) / 1000)
    const remaining = end - Date.now() / 1000
    const common = { customer: this.state.customer_id!, success_url: `${this.config.origin}/billing?checkout=returned`,
      cancel_url: `${this.config.origin}/billing`, expires_at: Math.floor(Date.now() / 1000) + 1800,
      integration_identifier: "rejoyce_billing_qjvntkpa" }
    // Checkout subscription trials require >=48h. Setup Checkout collects the
    // card for a server-created subscription during the final two trial days.
    await this.mutate("checkout", remaining > 0 && remaining < 48 * 3600 + 60
      ? { ...common, mode: "setup", currency: "usd", custom_text: { submit: { message:
          "Save your payment method for ReJoyce. Billing begins when your existing trial ends: $79/month including one provider, plus $29 per additional active provider." } } }
      : { ...common, mode: "subscription", line_items: this.lineItems(Math.max(1, this.state.provider_count)),
          subscription_data: { billing_mode: { type: "flexible" }, ...(remaining > 0 ? { trial_end: end } : {}) } })
    const checkout = await this.stripe.checkout.sessions.retrieve(this.state.checkout_id!)
    return checkout.url
  }
  async synchronizeSeats() {
    let sub = await this.refresh()
    if (!sub || !["active", "trialing"].includes(sub.status) || sub.pending_update) return
    const desired = Math.max(1, this.state.provider_count)
    const actual = subscriptionSeats(sub, this.config.base, this.config.provider)
    if (sub.cancel_at || sub.cancel_at_period_end) return
    // Release our reduction schedule before replacing it or adding seats.
    if (sub.schedule) {
      const schedule = await this.stripe.subscriptionSchedules.retrieve(objectId(sub.schedule)!)
      if (schedule.metadata?.rejoyce !== this.state.organization_id) {
        // A freshly created schedule can be resumed before metadata is saved.
        if (this.state.schedule_id !== schedule.id || schedule.phases.length !== 1) throw new Error("Unmanaged schedule")
      }
      if (this.state.scheduled_seats === desired && desired < actual) return
      await this.mutate("release", {}, schedule.id)
      sub = await this.stripe.subscriptions.retrieve(sub.id)
    }
    if (desired > actual || (sub.status === "trialing" && desired !== actual)) {
      const extra = sub.items.data.find(item => item.price.id === this.config.provider)
      const items = desired > 1
        ? [{ ...(extra ? { id: extra.id } : { price: this.config.provider }), quantity: desired - 1 }]
        : extra ? [{ id: extra.id, deleted: true }] : []
      await this.mutate("update", { items, proration_behavior: sub.status === "trialing" ? "none" : "always_invoice",
        payment_behavior: "pending_if_incomplete" }, sub.id)
    } else if (desired < actual) {
      await this.mutate("schedule", { from_subscription: sub.id })
      const schedule = await this.stripe.subscriptionSchedules.retrieve(this.state.schedule_id!)
      const start = schedule.current_phase?.start_date
      const end = Math.min(...sub.items.data.map(item => item.current_period_end))
      if (!start || end <= Date.now() / 1000) throw new Error("Invalid schedule dates")
      await this.mutate("schedule-update", { end_behavior: "release", proration_behavior: "none",
        metadata: { rejoyce: this.state.organization_id }, phases: [
          { start_date: start, end_date: end, items: this.lineItems(actual), proration_behavior: "none" },
          { start_date: end, duration: { interval: "month", interval_count: 1 }, items: this.lineItems(desired), proration_behavior: "none" },
        ] }, schedule.id)
      await this.save({ scheduled_seats: desired })
    }
    await this.save({ synced_revision: this.state.desired_revision })
    await this.refresh()
  }
  async portal() {
    await this.refresh()
    if (!this.state.customer_id || !this.state.subscription_id) throw new BillingError("Subscribe first.", 409)
    const config = await this.stripe.billingPortal.configurations.retrieve(this.config.portal)
    if (config.livemode || !config.active || config.features.subscription_update.enabled
      || config.features.subscription_cancel.enabled || !config.features.payment_method_update.enabled) {
      throw new Error("Portal must allow payment updates only; cancellation is handled in the app")
    }
    const session = await this.stripe.billingPortal.sessions.create({ customer: this.state.customer_id,
      configuration: this.config.portal, return_url: `${this.config.origin}/billing` })
    return session.url
  }
  async cancel() {
    const sub = await this.refresh()
    if (!sub || ["canceled", "incomplete_expired"].includes(sub.status)) return
    if (sub.schedule) await this.mutate("release", {}, objectId(sub.schedule)!)
    await this.mutate("update", { cancel_at_period_end: true }, sub.id)
    await this.refresh()
  }
}

export async function pendingOrganizations() { return rpc<string[]>("billing_work", {}) }
