import { NextResponse } from "next/server"
import { privateHeaders as headers } from "@/lib/device-session-server"
import { BillingError } from "@/lib/billing-server"

export const billingResponse = (data: unknown) => NextResponse.json(data, { headers })
export function billingFailure(error: unknown) {
  return NextResponse.json({ error: error instanceof BillingError ? error.message : "Billing is unavailable. Please try again later." },
    { status: error instanceof BillingError ? error.status : 503, headers })
}
