import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase-admin"
export const dynamic = "force-dynamic"
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.rpc("device_policy_enabled")
    if (error || typeof data !== "boolean") throw new Error("Unavailable")
    return NextResponse.json({ enabled: data }, { headers: { "Cache-Control": "no-store" } })
  } catch { return NextResponse.json({ error: "Unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}

