"use client"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
export function useSetupAccess() {
  const { data, loading, error } = useEffectiveCapabilities()
  return { loading, error, clients: data?.clients === true, sessions: data?.sessions === true, users: data?.users === true }
}
