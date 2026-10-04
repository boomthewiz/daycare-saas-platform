import Link from "next/link"
export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl space-y-4">
    <nav aria-label="Setup navigation" className="flex flex-wrap gap-3 rounded-xl border bg-white p-3 text-sm font-semibold">
      <Link href="/setup">Setup home</Link><Link href="/setup/preferences">Business, branches & sessions</Link><Link href="/setup/roles">Roles & permissions</Link><Link href="/setup/care-teams">Teams, groups & classes</Link>
    </nav>{children}
  </div>
}
