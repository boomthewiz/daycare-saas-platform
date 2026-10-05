import { ownerContext, withBilling, BillingError } from "@/lib/billing-server"
import { billingResponse, billingFailure } from "@/lib/billing-http"

export const runtime = "nodejs"
export async function POST(request: Request) {
  try {
    // No browser-supplied organization, customer, price, count or redirect.
    const owner = await ownerContext(request)
    if (!owner.managed) throw new BillingError("Your existing organization has not been enrolled in subscription billing.", 409)
    const url = await withBilling(owner.organization_id, null, worker => worker.checkout())
    if (!url) throw new Error("Checkout unavailable")
    return billingResponse({ url })
  } catch (error) { return billingFailure(error) }
}
