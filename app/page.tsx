import type { Metadata } from "next"
import Link from "next/link"

const url = "https://www.rejoyceapp.com"
const title = "ReJoyce | Daily Care Workflow Software"
const description =
  "ReJoyce helps childcare and child development teams organize daily routines, track care tasks, and stay coordinated across classrooms."

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: {
    type: "website",
    url,
    siteName: "ReJoyce",
    title,
    description,
  },
}

const website = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "ReJoyce",
  url: `${url}/`,
}

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 sm:px-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }}
      />
      <header className="flex items-center justify-between gap-4 py-6">
        <span className="text-2xl font-semibold">ReJoyce</span>
        <Link href="/login" className="font-semibold text-teal-800 underline-offset-4 hover:underline">
          Sign in
        </Link>
      </header>

      <section className="flex flex-1 flex-col items-start justify-center py-20">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
          Daily care workflows for childcare and child development teams
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--rj-text-secondary)]">
          Organize daily routines, track care tasks, and keep your team coordinated
          across classrooms. Built for daycares and child development centers,
          including teams that support children with disabilities.
        </p>
        <Link
          href="/dashboard"
          className="mt-8 rounded-xl bg-teal-800 px-5 py-3 font-semibold text-white hover:bg-teal-900"
        >
          Open ReJoyce
        </Link>
      </section>
    </main>
  )
}
