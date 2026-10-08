import PortalProvider from "@/components/PortalProvider"
export default function SessionLayout({ children }: { children: React.ReactNode }) {
  return <PortalProvider>{children}</PortalProvider>
}
