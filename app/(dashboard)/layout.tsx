import Sidebar from "@/components/Sidebar"
import Header from "@/components/Header"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex bg-gray-50">

      {/* Static Sidebar */}
      <Sidebar />

      {/* Right Side */}
      <div className="flex-1 flex flex-col">

        {/* Static Header */}
        <Header />

        {/* Page Content Changes */}
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  )
}