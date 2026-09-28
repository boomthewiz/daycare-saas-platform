import { timingSafeEqual } from "node:crypto"
import { pendingOrganizations, withBilling } from "@/lib/billing-server"
import { billingConfig } from "@/lib/stripe-config"

export const runtime = "nodejs"
export async function POST(request: Request) {
  const expected = process.env.BILLING_WORKER_SECRET
  const supplied = request.headers.get("authorization") || ""
  if (!expected || expected.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(`Bearer ${expected}`)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${expected}`))) {
    return new Response("Unauthorized", { status: 401 })
  }
  try {
    billingConfig()
    let failed = 0
    for (const org of await pendingOrganizations()) {
      try { await withBilling(org, null, worker => worker.synchronizeSeats()) }
      catch { failed++ }
    }
    return Response.json({ success: failed === 0, failed }, { status: failed ? 503 : 200 })
  } catch { return new Response("Reconciliation unavailable", { status: 503 }) }
}
