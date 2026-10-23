"use client"
import ServiceModelSettings from "@/components/ServiceModelSettings"

import { usePortal } from "@/components/PortalProvider"
import SetupProgressChecklist from "@/components/SetupProgressChecklist"
import PageTour from "@/components/PageTour"
import Link from "next/link"
import { useEffectiveCapabilities } from "@/components/EffectiveCapabilitiesProvider"
import { useSetupAccess } from "@/lib/use-setup-access"
export default function SetupPage() {
  const { t } = usePortal()

  const access = useSetupAccess()
  const { data: capabilities } = useEffectiveCapabilities()
  return <div className="space-y-5"><h1 className="rj-heading-1" data-tour="setup-heading">Setup</h1>
    <p>Configure your business and team. Available changes depend on your current permissions.</p>
    <PageTour family="setup" />
    {access.error && <p role="alert">{access.error}</p>}
    <ServiceModelSettings /><div data-tour="setup-readiness"><SetupProgressChecklist /></div>
    <div className="grid gap-4 md:grid-cols-2">
      {(access.clients || access.sessions) && <Link data-tour="setup-people" href="/team-management?tab=clients" className="rj-card block p-5"><h2 className="rj-heading-3">People roster</h2><p className="mt-2">Current child profiles and branch membership.</p></Link>}
      {capabilities?.reports && <Link data-tour="setup-reports" href="/reports" className="rj-card block p-5"><h2 className="rj-heading-3">Operational reports</h2><p className="mt-2">Current roster, authorized staff readiness and recorded schedule activity.</p></Link>}
      <Link href="/setup/appearance" className="rj-card block p-5"><h2 className="rj-heading-3">Portal appearance and vocabulary</h2><p className="mt-2">Preview themes, choose a business preset, and customize the words your team sees.</p></Link>
      {(access.clients || access.users) && <Link href="/team-management/import" className="rj-card block p-5"><h2 className="rj-heading-3">Import people</h2><p className="mt-2">Get started faster with CSV lists of clients and staff.</p></Link>}
      <Link data-tour="setup-preferences" href="/setup/preferences?tab=locations" className="rj-card block p-5"><h2 className="rj-heading-3">Business and location preferences</h2><p className="mt-2">{t("Branches, business terminology and target categories.")}</p><p className="rj-caption mt-2">{access.loading ? "Checking access…" : access.clients || access.sessions ? "Edit the settings your grants allow." : "View settings; management permission required to edit."}</p></Link>
      <Link href="/setup/preferences?tab=session-types" className="rj-card block p-5"><h2 className="rj-heading-3">{t("Session types and durations")}</h2><p className="mt-2">{t("Reusable service types and default session lengths.")}</p><p className="rj-caption mt-2">{t("Manage sessions is required to edit.")}</p></Link>
      <Link data-tour="setup-roles" href="/setup/roles" className="rj-card block p-5"><h2 className="rj-heading-3">Roles and permissions</h2><p className="mt-2">Account definitions, supported grants and team access.</p></Link>
      {(access.clients || access.sessions) && <Link href="/classes" className="rj-card block p-5"><h2 className="rj-heading-3">Classes and activity groups</h2><p className="mt-2">Reusable child rosters and suggested staff for scheduling group activities.</p></Link>}
      <Link href="/setup/care-teams" className="rj-card block p-5"><h2 className="rj-heading-3">Staff care groups</h2><p className="mt-2">Staff branches and care-team selection shortcuts. Child activity rosters are managed in Classes.</p><p className="rj-caption mt-2">{t("Manage clients is required to edit.")}</p></Link>
    </div>
  </div>
}
