"use client"
import PageGuide from "@/components/PageGuide"
import { useEffect, useState } from "react"
import Link from "next/link"
import { supabase } from "@/lib/supabase"
import { permissionDefinitions } from "@/lib/permissions"
import { useSetupAccess } from "@/lib/use-setup-access"
export default function RolesPage() {
  const access = useSetupAccess()
  const [members, setMembers] = useState<{ id: string; full_name: string; role: string }[]>([])
  const [error, setError] = useState("")
  useEffect(() => {
    let live = true
    if (access.users) void supabase.from("users").select("id,full_name,role").order("full_name").then(result => {
      if (live) { if (result.error) setError("Unable to load accounts. Reload to try again."); else setMembers(result.data || []) }
    })
    return () => { live = false }
  }, [access.users])
  return <div className="space-y-5"><h1 className="rj-heading-1">Roles and permissions</h1>
    <PageGuide guide="roles" />
    <section className="rj-card space-y-3 p-5"><h2 className="rj-heading-3">Care-team accounts</h2><p>Teachers, therapists, educators, assistants, aides, caregivers and staff provide care and document assigned sessions. Client care access requires an explicit assignment and a shared active branch. Session and note access follow their separate assignment rules.</p></section>
    <section className="rj-card space-y-3 p-5"><h2 className="rj-heading-3">Administrative accounts</h2><p>Administrators, managers and directors support organization workflows. Management actions require current permission grants; an Administrator role alone does not grant every management permission. Owners have organization authority. Owners and administrators can read organization session notes and perform protected note administration. Approving or returning notes requires Review session notes permission.</p><p>Only owners and administrators with account-management authority can manage administrator accounts. Owner accounts and your own grants remain protected.</p></section>
    <section className="rj-card space-y-3 p-5"><h2 className="rj-heading-3">Supported permissions</h2><p>These are per-person grants for the existing roles. Custom role definitions and role-wide permission templates are not available.</p><p>Manage users allows invitations and account management. Editing grants also requires May delegate permissions for other roles. Billing and delegation grants remain controlled by owners and authorized administrators.</p><dl className="space-y-3">{permissionDefinitions.map(permission => <div key={permission.key}><dt className="font-bold">{permission.label}</dt><dd className="rj-caption">{permission.description}</dd></div>)}</dl><p>Creating clients currently uses Manage clients. Existing creation access is retained.</p></section>
    <section className="rj-card space-y-3 p-5"><h2 className="rj-heading-3">Team access</h2>{access.error && <p role="alert">{access.error}</p>}{error && <p role="alert">{error}</p>}{access.loading ? <p>Checking access…</p> : !access.users ? <p>Manage users permission is required to manage accounts.</p> : <><Link href="/team-management/invite" className="rj-button rj-button-primary">Invite team member</Link><ul className="divide-y">{members.map(member => <li key={member.id} className="py-3"><Link className="underline" href={"/setup/roles/" + member.id}>{member.full_name || "Team member"}</Link><span className="ml-2 text-sm">{member.role}</span></li>)}</ul>{!members.length && !error && <p>No accounts available.</p>}</>}</section>
  </div>
}

