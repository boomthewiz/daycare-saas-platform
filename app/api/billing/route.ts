import { ownerContext, withBilling, BillingError } from "@/lib/billing-server"
import { billingResponse, billingFailure } from "@/lib/billing-http"
import { billingConfig } from "@/lib/stripe-config"
import { monthlyQuoteCents } from "@/lib/subscription-plan"

export const runtime = "nodejs"
export async function GET(request: Request) {
  try {
    const state = await ownerContext(request)
    if (!state.managed) return billingResponse({ managed: false })
    let enabled = false
    try { billingConfig(); enabled = true } catch { /* Stored billing status remains readable. */ }
    return billingResponse({ managed: true, enabled, testMode: true, status: state.status,
      providers: state.provider_count, monthlyAmount: monthlyQuoteCents(state.provider_count),
      billedSeats: state.seats, scheduledSeats: state.scheduled_seats,
      trialEndsAt: state.trial_ends_at, paidThrough: state.paid_through, cancelAt: state.cancel_at,
      subscribed: Boolean(state.subscription_id), needsAttention: Boolean(state.operation),
    })
  } catch (error) { return billingFailure(error) }
}
export async function POST(request: Request) {
  try {
    const owner = await ownerContext(request)
    if (!owner.managed) throw new BillingError("Your existing organization is not enrolled in subscription billing.", 409)
    const body = await request.json()
    if (!["portal", "cancel", "refresh"].includes(body?.action)) throw new BillingError("Invalid billing action.", 400)
    const result = await withBilling(owner.organization_id, null, async worker => {
      if (body.action === "portal") return { url: await worker.portal() }
      if (body.action === "cancel") await worker.cancel()
      else await worker.synchronizeSeats()
      return { success: true }
    })
    if (!result) throw new Error("Billing unavailable")
    return billingResponse(result)
  } catch (error) { return billingFailure(error) }
}
