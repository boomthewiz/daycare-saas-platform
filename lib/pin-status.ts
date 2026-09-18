import { supabase } from "@/lib/supabase"

export async function getPinStatus(): Promise<{ hasPin: boolean; resetRequired: boolean } | null> {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw new Error("Unable to check your login. Please try again.")
  if (!session) return null

  const response = await fetch("/api/pin-status", {
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  })
  if (response.status === 401) return null
  const result = await response.json()
  if (!response.ok) {
    throw new Error(result.error || "Unable to check your account. Please try again.")
  }
  if (typeof result.hasPin !== "boolean" || typeof result.resetRequired !== "boolean") {
    throw new Error("Unable to check your account. Please try again.")
  }
  return { hasPin: result.hasPin, resetRequired: result.resetRequired }
}
