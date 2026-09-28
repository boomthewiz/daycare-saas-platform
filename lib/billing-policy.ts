import type Stripe from "stripe"

export const objectId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id || null

export function subscriptionSeats(subscription: Stripe.Subscription, base: string, provider: string) {
  const items = subscription.items.data
  const included = items.filter(item => item.price.id === base)
  const extra = items.filter(item => item.price.id === provider)
  if (subscription.livemode || items.length !== included.length + extra.length
    || included.length !== 1 || included[0].quantity !== 1 || extra.length > 1
    || items.some(item => item.price.currency !== "usd")) throw new Error("Unexpected subscription items")
  return 1 + (extra[0]?.quantity || 0)
}

// An active subscription alone is not proof of payment. Only settled recurring
// base-plan invoice lines can extend access; seat prorations cannot renew it.
export function paidDeadline(invoice: Stripe.Invoice, subscriptionId: string, customerId: string, basePrice: string) {
  if (invoice.livemode || invoice.status !== "paid" || invoice.amount_remaining !== 0
    || invoice.currency !== "usd" || objectId(invoice.customer) !== customerId
    || objectId(invoice.parent?.subscription_details?.subscription) !== subscriptionId
    || !["subscription_create", "subscription_cycle"].includes(invoice.billing_reason || "")) return null
  if (invoice.lines.has_more) throw new Error("Invoice lines require pagination")
  const lines = invoice.lines.data.filter(line =>
    line.pricing?.price_details?.price === basePrice && line.quantity === 1
    && line.parent?.type === "subscription_item_details"
    && !line.parent.subscription_item_details?.proration
    && objectId(line.parent.subscription_item_details?.subscription) === subscriptionId)
  if (lines.length !== 1 || lines[0].amount < 7900) return null
  return new Date(lines[0].period.end * 1000).toISOString()
}
