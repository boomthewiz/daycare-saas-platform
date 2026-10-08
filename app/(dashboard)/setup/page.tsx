"use client"

import { usePortal } from "@/components/PortalProvider"
import PageGuide from "@/components/PageGuide"
import Link from "next/link"
import { useSetupAccess } from "@/lib/use-setup-access"
export default function SetupPage() {
  const { t } = usePortal()

  const access = useSetupAccess()
  return <div className="space-y-5"><h1 className="rj-heading-1">Setup</h1>
    <p>Configure your business and team. Available changes depend on your current permissions.</p>
    <PageGuide guide="setup" />
    {access.error && <p role="alert">{access.error}</p>}
    <div className="grid gap-4 md:grid-cols-2">
      <Link href="/setup/appearance" className="rj-card block p-5"><h2 className="rj-heading-3">Portal appearance and vocabulary</h2><p className="mt-2">Preview themes, choose a business preset, and customize the words your team sees.</p></Link>
      <Link href="/team-management/import" className="rj-card block p-5"><h2 className="rj-heading-3">Import people</h2><p className="mt-2">Get started faster with CSV lists of clients and staff.</p></Link>
      <Link href="/setup/preferences" className="rj-card block p-5"><h2 className="rj-heading-3">Business and location preferences</h2><p className="mt-2">{t("Branches, business terminology and target categories.")}</p><p className="rj-caption mt-2">{access.loading ? "Checking access…" : access.clients || access.sessions ? "Edit the settings your grants allow." : "View settings; management permission required to edit."}</p></Link>
      <Link href="/setup/preferences" className="rj-card block p-5"><h2 className="rj-heading-3">{t("Session types and durations")}</h2><p className="mt-2">{t("Reusable service types and default session lengths.")}</p><p className="rj-caption mt-2">{t("Manage sessions is required to edit.")}</p></Link>
      <Link href="/setup/roles" className="rj-card block p-5"><h2 className="rj-heading-3">Roles and permissions</h2><p className="mt-2">Account definitions, supported grants and team access.</p></Link>
      <Link href="/setup/care-teams" className="rj-card block p-5"><h2 className="rj-heading-3">Teams, groups and classes</h2><p className="mt-2">Staff branches and care-group membership.</p><p className="rj-caption mt-2">{t("Manage clients is required to edit.")}</p></Link>
    </div>
  </div>
}
