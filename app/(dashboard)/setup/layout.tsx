"use client"
import Link from "next/link"
import { usePortal } from "@/components/PortalProvider"
export default function SetupLayout({ children }: { children: React.ReactNode }) {
  const { t } = usePortal()
  return <div className="mx-auto max-w-7xl space-y-4">
    <nav aria-label="Setup navigation" className="flex flex-wrap gap-3 rounded-xl border bg-white p-3 text-sm font-semibold">
      <Link href="/setup">Setup home</Link><Link href="/setup/preferences">{t("Business, branches & sessions")}</Link><Link href="/setup/appearance">Appearance & vocabulary</Link><Link href="/setup/roles">Roles & permissions</Link><Link href="/setup/care-teams">Teams, groups & classes</Link>
    </nav>{children}
  </div>
}
