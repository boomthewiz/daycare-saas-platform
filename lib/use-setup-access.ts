"use client"
import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
export function useSetupAccess() {
  const [access, setAccess] = useState({ loading: true, clients: false, sessions: false, users: false, error: "" })
  useEffect(() => {
    let live = true
    void Promise.all([supabase.rpc("can_manage_clients"), supabase.rpc("can_manage_sessions"), supabase.rpc("can_manage_users")]).then(results => {
      if (!live) return
      const error = results.find(result => result.error)?.error
      setAccess({ loading: false, clients: !error && results[0].data === true, sessions: !error && results[1].data === true, users: !error && results[2].data === true, error: error ? "Unable to verify Setup access. Reload to try again." : "" })
    }).catch(() => { if (live) setAccess({ loading: false, clients: false, sessions: false, users: false, error: "Unable to verify Setup access. Reload to try again." }) })
    return () => { live = false }
  }, [])
  return access
}
