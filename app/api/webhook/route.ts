import Stripe from "stripe"
import { billingConfig } from "@/lib/stripe-config"
import { withBilling } from "@/lib/billing-server"
import { objectId } from "@/lib/billing-policy"

export const runtime = "nodejs"
export async function POST(request: Request) {
  let event: Stripe.Event
  try {
    const config = billingConfig()
    const stripe = new Stripe(config.key)
    event = stripe.webhooks.constructEvent(await request.text(), request.headers.get("stripe-signature") || "", config.webhook)
  } catch { return new Response("Invalid or unavailable webhook", { status: 400 }) }
  if (event.livemode || event.account) return new Response("Wrong Stripe environment", { status: 400 })
  const supported = event.type.startsWith("customer.subscription.") ||
    ["invoice.paid", "invoice.payment_failed", "invoice.payment_action_required", "invoice.created",
      "checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"].includes(event.type)
  if (!supported) return new Response("Ignored", { status: 200 })
  const resource = event.data.object as Stripe.Subscription | Stripe.Invoice | Stripe.Checkout.Session
  const customer = objectId(resource.customer)
  if (!customer) return new Response("Missing customer", { status: 400 })
  try {
    // Tenant lookup uses a stored customer ID, never metadata or a return URL.
    // Stripe is re-read inside the lease, independent of event delivery order.
    await withBilling(null, customer, worker => worker.synchronizeSeats())
    return new Response("Received", { status: 200 })
  } catch { return new Response("Retry billing reconciliation", { status: 503 }) }
}
