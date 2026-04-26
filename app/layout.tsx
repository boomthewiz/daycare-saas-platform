import Link from "next/link"
import "./globals.css"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {

  return (
    <html lang="en">
      <body>
        {/* 🧭 Navigation Bar */}
        <nav className="bg-white border-b p-4 flex flex-col sm:flex-row sm:justify-between gap-2">
  <h1 className="font-bold text-lg">Rejoyce</h1>
  
  <link rel="manifest" href="/manifest.json" />
  <meta name="theme-color" content="#111827" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  
  <div className="flex gap-4 text-sm">
    <Link href="/dashboard">Dashboard</Link>
    <Link href="/templates">Templates</Link>
  </div>
</nav>

        {/* 📦 Page Content */}
        <main>{children}</main>
      </body>
    </html>
  )
}
