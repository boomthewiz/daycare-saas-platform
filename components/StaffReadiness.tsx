"use client"
import { usePortal } from "@/components/PortalProvider"
import { useSetupProgress, type StaffReadiness } from "@/lib/use-setup-progress"
export function StaffReadinessLabel({ staff }: { staff?: StaffReadiness }) {
  const { terms } = usePortal()
  if (!staff) return <p className="text-sm">Invitation and readiness unavailable</p>
  return <div className="mt-2 space-y-1 text-sm">
    <p>Invitation: {staff.invitation === "accepted" ? "Accepted / email confirmed" : staff.invitation === "pending" ? "Sent · pending acceptance" : "Unknown"}{staff.invitation === "pending" && " · delivery unknown"}</p>
    <p>{!staff.frontline ? `Administrative role · does not count as frontline ${terms.frontline_plural.toLowerCase()}` : staff.ready ? `Ready for ${terms.session_plural.toLowerCase()} · assign when scheduling` : !staff.account_ready ? "Account setup still needed · accept invitation and complete PIN setup" : "Account must be active before scheduling"}</p>
    {staff.frontline && <p>Branch: {staff.branch_assigned ? "assigned" : "not assigned"} · Care: {staff.care_assigned ? "assigned" : "not assigned"} (optional for scheduling)</p>}
  </div>
}
export function useStaffReadiness() { return useSetupProgress(true) }

