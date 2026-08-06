"use client"

import { useParams } from "next/navigation"

export default function SessionCompletePage() {
  const params = useParams<{ sessionId: string }>()

  return (
    <main className="rj-page rj-page-padding">
      <div className="rj-mobile-shell">
        <section className="rj-card p-6 text-center">
          <h1 className="rj-heading-1">
            Session complete
          </h1>

          <p className="rj-body mt-3 text-[var(--rj-text-secondary)]">
            Session ID: {params.sessionId}
          </p>

          <p className="rj-caption mt-4">
            The note review screen will be built next.
          </p>
        </section>
      </div>
    </main>
  )
}