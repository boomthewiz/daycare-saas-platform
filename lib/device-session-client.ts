import { supabase } from "@/lib/supabase"
import type { DeviceState } from "@/lib/device-session-server"

export async function sessionRequest(action = "status", pin?: string): Promise<DeviceState> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session) return { state: "full_login" }
  const response = await fetch("/api/device-session", {
    method: action === "status" ? "GET" : "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: action === "status" ? undefined : JSON.stringify({ action, pin }),
  })
  const result = await response.json()
  if (result.state === "full_login" || result.state === "inactive") return result
  if (!response.ok) throw new Error(result.error || "Unable to check your session.")
  if (!["locked", "unlocked", "setup"].includes(result.state)) throw new Error("Unable to check your session.")
  return result
}

