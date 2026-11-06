import PortalProvider from "@/components/PortalProvider"
import EffectiveCapabilitiesProvider from "@/components/EffectiveCapabilitiesProvider"
import ClinicalAccessBoundary from "@/components/ClinicalAccessBoundary"
export default function SessionLayout({ children }: { children: React.ReactNode }) {
  return <EffectiveCapabilitiesProvider><PortalProvider><ClinicalAccessBoundary>{children}</ClinicalAccessBoundary></PortalProvider></EffectiveCapabilitiesProvider>
}
