"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getPinStatus } from "@/lib/pin-status"
import WorkspaceNavigation from "@/components/WorkspaceNavigation"

import { BranchProvider } from "@/components/BranchProvider"
import { SubscriptionWriteProvider } from "@/components/SubscriptionWriteControls"
import PortalProvider from "@/components/PortalProvider"
import DailyScheduleProvider from "@/components/DailyScheduleProvider"
import AccessHelp from "@/components/AccessHelp"
import EffectiveCapabilitiesProvider from "@/components/EffectiveCapabilitiesProvider"

export default function WorkspaceLayout({
  children,
  stickySidebar = false,
}: {
  stickySidebar?: boolean
  children: React.ReactNode
}) {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [accountError, setAccountError] = useState<string | null>(null)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const status = await getPinStatus()
        if (!status) {
          router.replace("/login")
          return
        }
        if (!status.hasPin || status.resetRequired) {
          router.replace("/set-pin")
          return
        }
        setLoading(false)
      } catch (error) {
        setAccountError(error instanceof Error ? error.message : "Unable to check your account.")
      }
    }

    checkAuth()
  }, [router])

  if (accountError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 p-6">
        <p role="alert">{accountError}</p>
        <button onClick={() => window.location.reload()}>Try again</button>
        <a href="/login">Return to sign in</a>
      </div>
    )
  }

  // ⏳ Global loading screen
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">
          Loading your workspace...
        </p>
      </div>
    )
  }

  return (
    <EffectiveCapabilitiesProvider><PortalProvider><BranchProvider><DailyScheduleProvider>
    <div className="min-h-screen flex flex-col bg-gray-50">
      <WorkspaceNavigation sticky={stickySidebar}>
        <main className="min-w-0 flex-1 p-3 sm:p-6">
          <SubscriptionWriteProvider><AccessHelp />{children}</SubscriptionWriteProvider>
        </main>
      </WorkspaceNavigation>
    </div>
    </DailyScheduleProvider></BranchProvider></PortalProvider></EffectiveCapabilitiesProvider>
  )
}
